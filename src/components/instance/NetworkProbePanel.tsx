import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, CheckCircle2, ChevronDown, CircleHelp, LoaderCircle,
  Network, RefreshCw, Save, ShieldCheck, XCircle,
} from "lucide-react";
import { InstancePanel } from "./InstancePanel";
import {
  createProbeTask, getCurrentNodePublicIpv4, getProbeNodes, getProbeProviders, getProbeProxyConfig, getProbeQuota,
  getProbeResult, saveProbeProxyConfig,
  type ProbeMode, type ProbeNode, type ProbeProviderId, type ProbeProviderInfo, type ProbeProxyConfig,
  type ProbeResult, type ProbeTask,
} from "@/services/networkProbe";

const PROVIDERS: Array<{
  id: ProbeProviderId;
  label: string;
  note: string;
  paid: boolean;
  pingUrl: string;
  tcpUrl: string;
}> = [
  {
    id: "check-host",
    label: "Check-Host.net",
    note: "公开 API · 无需 API Key · 当前节点列表无中国大陆节点",
    paid: false,
    pingUrl: "https://check-host.net/check-ping",
    tcpUrl: "https://check-host.net/check-tcp",
  },
  {
    id: "tcptest",
    label: "TCPTest",
    note: "大陆多运营商网页工具；API 按成功节点扣额度",
    paid: true,
    pingUrl: "https://www.tcptest.cn/ping",
    tcpUrl: "https://www.tcptest.cn/tcping",
  },
  {
    id: "boce",
    label: "BOCE",
    note: "大陆多运营商网页工具；API 按节点及接口单价扣波点",
    paid: true,
    pingUrl: "https://www.boce.com/ping",
    tcpUrl: "https://www.boce.com/tcping",
  },
];

type ResultRow = {
  id: string;
  provider: ProbeProviderId;
  node: string;
  city: string;
  carrier: string;
  status: "success" | "failed" | "pending" | "unknown";
  latencyMs: number | null;
  lossPercent: number | null;
  detail: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const normalized = typeof value === "string" ? value.trim().replace(/%$/, "") : value;
  const n = typeof normalized === "number" ? normalized : Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function carrierLabel(value: string): string {
  const text = value.toLowerCase();
  if (/电信|telecom|chinanet|ctcc/.test(text)) return "电信";
  if (/联通|unicom|china169|cucc/.test(text)) return "联通";
  if (/移动|mobile|cmnet|cmcc/.test(text)) return "移动";
  return value || "未识别运营商";
}

function isMainlandNode(node: ProbeNode): boolean {
  return node.countryCode.toUpperCase() === "CN" ||
    ["中国", "china", "cn"].includes(node.country.trim().toLowerCase());
}

function rowsFromResult(task: ProbeTask, result: ProbeResult): ResultRow[] {
  const rows: ResultRow[] = [];
  const raw = asRecord(result.raw);
  if (task.provider === "check-host") {
    const nodeMeta = asRecord(task.nodes);
    for (const [nodeId, value] of Object.entries(raw)) {
      const meta = nodeMeta[nodeId];
      const location = Array.isArray(meta) ? meta : [];
      const country = String(location[1] || "");
      const city = String(location[2] || "");
      const resultValue = Array.isArray(value) ? value : [];
      if (task.mode === "ping") {
        const first = Array.isArray(resultValue[0]) ? resultValue[0] as unknown[] : resultValue;
        const checks = first.filter(Array.isArray) as unknown[][];
        const successful = checks.filter((item) => String(item[0]).toUpperCase() === "OK");
        const times = successful.map((item) => finiteNumber(item[1])).filter((n): n is number => n != null);
        const loss = checks.length ? (checks.length - successful.length) / checks.length * 100 : null;
        rows.push({
          id: `${task.provider}-${nodeId}`, provider: task.provider, node: nodeId,
          city: [city, country].filter(Boolean).join(" · "), carrier: "",
          status: resultValue.length === 0 ? "pending" : successful.length ? "success" : "failed",
          latencyMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length * 1000 : null,
          lossPercent: loss, detail: successful.length ? `${successful.length}/${checks.length} 次响应` : "ICMP 无响应或节点未完成",
        });
      } else {
        const tcp = asRecord(resultValue[0]);
        const time = finiteNumber(tcp.time);
        const error = String(tcp.error || "");
        rows.push({
          id: `${task.provider}-${nodeId}`, provider: task.provider, node: nodeId,
          city: [city, country].filter(Boolean).join(" · "), carrier: "",
          status: time != null ? "success" : value == null ? "pending" : "failed",
          latencyMs: time == null ? null : time * 1000, lossPercent: null,
          detail: error || (time != null ? "TCP 连接成功" : "TCP 连接失败"),
        });
      }
    }
    return rows;
  }

  if (task.provider === "boce") {
    const list = Array.isArray(raw.list) ? raw.list : [];
    return list.map((entry, index) => {
      const item = asRecord(entry);
      const loss = finiteNumber(item.packet_loss);
      const latency = finiteNumber(item.round_trip_avg);
      const error = String(item.error || "");
      const isFailure = Number(item.error_code) !== 0 && Boolean(error);
      return {
        id: `boce-${String(item.node_id ?? index)}`, provider: task.provider,
        node: String(item.node_name || item.node_id || `节点 ${index + 1}`),
        city: String(item.ip_region || ""), carrier: carrierLabel(String(item.ip_isp || "")),
        status: isFailure ? "failed" : latency != null || (loss != null && loss < 100) ? "success" : "unknown",
        latencyMs: latency, lossPercent: loss,
        detail: error || (loss != null ? `丢包 ${loss}%` : "等待节点数据"),
      };
    });
  }

  const resultsContainer = asRecord(raw.results);
  const nestedResults = asRecord(resultsContainer.data);
  const candidateSource = Array.isArray(raw.results) ? raw.results
    : Array.isArray(resultsContainer.results) ? resultsContainer.results
    : Array.isArray(resultsContainer.data) ? resultsContainer.data
    : Array.isArray(resultsContainer.nodes) ? resultsContainer.nodes
    : Array.isArray(resultsContainer.items) ? resultsContainer.items
    : Array.isArray(nestedResults.results) ? nestedResults.results
    : Array.isArray(raw.data) ? raw.data
    : [];
  const candidates = candidateSource.length ? candidateSource : Object.entries(resultsContainer).filter(([, value]) => value && typeof value === "object").map(([nodeId, value]) => ({ node_id: nodeId, ...asRecord(value) }));
  return candidates.map((entry, index) => {
    const item = asRecord(entry);
    const latency = finiteNumber(item.avg_ms ?? item.average_ms ?? item.avg_rtt_ms ?? item.rtt_avg_ms ?? item.latency_ms ?? item.rtt_ms ?? item.avg ?? item.average ?? item.time_ms);
    const loss = finiteNumber(item.packet_loss ?? item.loss_percent ?? item.packet_loss_percent ?? item.loss_rate ?? item.loss);
    const nodeName = String(item.node_name || item.name || item.node_id || `节点 ${index + 1}`);
    const failed = item.success === false || item.status === "failed" || item.status === "error";
    return {
      id: `tcptest-${String(item.node_id ?? index)}`, provider: task.provider,
      node: nodeName, city: String(item.city || item.province || item.region || asRecord(task.nodes[String(item.node_id)]).city || ""),
      carrier: carrierLabel(String(item.isp || item.carrier || asRecord(task.nodes[String(item.node_id)]).carrier || "")),
      status: failed ? "failed" : latency != null || item.success === true ? "success" : "unknown",
      latencyMs: latency, lossPercent: loss, detail: String(item.error || item.message || ""),
    };
  });
}

function Summary({ rows }: { rows: ResultRow[] }) {
  const success = rows.filter((row) => row.status === "success").length;
  const latency = rows.map((row) => row.latencyMs).filter((value): value is number => value != null);
  const loss = rows.map((row) => row.lossPercent).filter((value): value is number => value != null);
  const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const averageLatency = avg(latency);
  const averageLoss = avg(loss);
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-xl bg-(--surface-elev) p-3">
        <div className="text-[10px] text-(--text-tertiary)">成功节点</div>
        <div className="mt-1 text-lg font-bold tabular-nums text-(--text-primary)">{success}/{rows.length}</div>
      </div>
      <div className="rounded-xl bg-(--surface-elev) p-3">
        <div className="text-[10px] text-(--text-tertiary)">平均延迟</div>
        <div className="mt-1 text-lg font-bold tabular-nums text-(--text-primary)">{averageLatency == null ? "—" : `${averageLatency.toFixed(1)} ms`}</div>
      </div>
      <div className="rounded-xl bg-(--surface-elev) p-3">
        <div className="text-[10px] text-(--text-tertiary)">平均丢包</div>
        <div className="mt-1 text-lg font-bold tabular-nums text-(--text-primary)">{averageLoss == null ? "—" : `${averageLoss.toFixed(1)}%`}</div>
      </div>
    </div>
  );
}

export function NetworkProbePanel({ nodeName, nodeUuid }: { nodeName?: string; nodeUuid: string }) {
  const [config, setConfig] = useState<ProbeProxyConfig>(() => getProbeProxyConfig());
  const [proxyUrl, setProxyUrl] = useState(config.baseUrl);
  const [proxyToken, setProxyToken] = useState(config.token);
  const [target, setTarget] = useState("");
  const targetTouchedRef = useRef(false);
  const [targetStatus, setTargetStatus] = useState("正在读取当前实例公网 IPv4…");
  const [mode, setMode] = useState<ProbeMode>("ping");
  const [portText, setPortText] = useState("443");
  const [nodes, setNodes] = useState<Partial<Record<ProbeProviderId, ProbeNode[]>>>({});
  const [quotaStatus, setQuotaStatus] = useState<Partial<Record<ProbeProviderId, string>>>({});
  const [selected, setSelected] = useState<Partial<Record<ProbeProviderId, string[]>>>({});
  const [providerStatus, setProviderStatus] = useState<Partial<Record<ProbeProviderId, ProbeProviderInfo>>>({});
  const [enabled, setEnabled] = useState<Record<ProbeProviderId, boolean>>({
    tcptest: false, boce: false, "check-host": true,
  });
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [tasks, setTasks] = useState<ProbeTask[]>([]);
  const [results, setResults] = useState<Partial<Record<ProbeProviderId, ProbeResult>>>({});
  const [providerErrors, setProviderErrors] = useState<Partial<Record<ProbeProviderId, string>>>({});

  useEffect(() => {
    let active = true;
    setTargetStatus("正在读取当前实例公网 IPv4…");
    getCurrentNodePublicIpv4(nodeUuid)
      .then((ip) => {
        if (!active) return;
        if (ip) {
          if (!targetTouchedRef.current) setTarget(ip);
          setTargetStatus("已从当前实例的 CFSM 管理端记录读取公网 IPv4");
        } else {
          setTargetStatus("管理端未提供该实例的公网 IPv4，请手动填写");
        }
      })
      .catch(() => {
        if (active) setTargetStatus("自动识别失败，请手动填写公网 IPv4");
      });
    return () => { active = false; };
  }, [nodeUuid]);

  const selectedCount = useMemo(
    () => PROVIDERS.reduce((total, provider) => total + (enabled[provider.id] ? (selected[provider.id]?.length || 0) : 0), 0),
    [enabled, selected],
  );

  function persistConfig() {
    const next = { baseUrl: proxyUrl.trim(), token: proxyToken.trim() };
    saveProbeProxyConfig(next);
    setConfig(next);
    setError("");
  }

  async function loadNodes() {
    const nextConfig = { baseUrl: proxyUrl.trim(), token: proxyToken.trim() };
    setConfig(nextConfig);
    setLoadingNodes(true);
    setError("");
    setProviderErrors({});
    setQuotaStatus({});
    try {
      const response = await getProbeProviders(nextConfig);
      const statusMap = Object.fromEntries(response.providers.map((provider) => [provider.id, provider]));
      setProviderStatus(statusMap);

      const entries = await Promise.all(PROVIDERS.map(async (provider) => {
        const status = statusMap[provider.id];
        if (!status?.configured) return [provider.id, [] as ProbeNode[]] as const;
        try {
          const [list, quota] = await Promise.all([
            getProbeNodes(nextConfig, provider.id),
            provider.paid ? getProbeQuota(nextConfig, provider.id).catch(() => null) : Promise.resolve(null),
          ]);
          if (!provider.paid) {
            setQuotaStatus((current) => ({
              ...current,
              [provider.id]: "公开 API，无需 API Key；请遵守平台调用频率限制。",
            }));
          } else if (quota) {
            const payload = asRecord(quota.quota);
            const nested = asRecord(payload.data);
            const remaining = payload.remaining ?? payload.available ?? payload.quota ?? nested.remaining ?? nested.available ?? nested.quota;
            const message = typeof payload.message === "string" ? payload.message : "";
            setQuotaStatus((current) => ({
              ...current,
              [provider.id]: remaining != null
                ? `可用额度：${String(remaining)}`
                : message || status.usageNote,
            }));
          } else {
            setQuotaStatus((current) => ({ ...current, [provider.id]: status.usageNote }));
          }
          return [provider.id, list] as const;
        } catch (caught) {
          setProviderErrors((current) => ({
            ...current,
            [provider.id]: caught instanceof Error ? caught.message : "节点获取失败",
          }));
          return [provider.id, [] as ProbeNode[]] as const;
        }
      }));

      const nextNodes: Partial<Record<ProbeProviderId, ProbeNode[]>> = {};
      for (const [provider, list] of entries) nextNodes[provider] = list;
      setNodes(nextNodes);

      // The no-key public Check-Host node list currently contains nearby Asian
      // locations (for example Hong Kong, Japan and Singapore), but no mainland
      // carrier nodes. Preselect at most three of those real nodes for a modest
      // first run. Paid providers remain unselected until the administrator
      // explicitly chooses their nodes.
      const checkHostNodes = nextNodes["check-host"] ?? [];
      const priority = ["HK", "JP", "SG", "VN", "ID", "IN"];
      const defaultNodes = [...checkHostNodes]
        .sort((a, b) => {
          const ai = priority.indexOf(a.countryCode.toUpperCase());
          const bi = priority.indexOf(b.countryCode.toUpperCase());
          return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
        })
        .slice(0, 3)
        .map((node) => node.id);
      setSelected({ "check-host": defaultNodes });

      if (!checkHostNodes.length && !entries.some(([provider, list]) => provider !== "check-host" && list.length > 0)) {
        setError("没有获取到可用节点。请检查代理地址和令牌；未配置付费 API 的平台不会请求其节点接口。");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取检测平台信息失败，请检查代理配置。");
    } finally {
      setLoadingNodes(false);
    }
  }

  function selectNodes(provider: ProbeProviderId, all: boolean) {
    const list: ProbeNode[] = nodes[provider] ?? [];
    const mainland = list.filter(isMainlandNode);
    const candidates = mainland.length ? mainland : list;
    const balanced = ["电信", "联通", "移动"].flatMap((carrier) =>
      candidates.filter((node) => carrierLabel(node.carrier) === carrier).slice(0, 2),
    );
    const balancedIds = new Set(balanced.map((node) => node.id));
    const ordered = [...balanced, ...candidates.filter((node) => !balancedIds.has(node.id))];
    setSelected((current) => ({
      ...current,
      [provider]: all ? ordered.slice(0, 6).map((node) => node.id) : [],
    }));
  }

  async function runChecks() {
    if (running) return;
    if (!target.trim()) { setError("请填写目标公网 IPv4"); return; }
    const port = Number(portText);
    if (mode === "tcp" && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      setError("TCP 端口范围必须是 1–65535");
      return;
    }
    const chosen = PROVIDERS.filter((provider) => enabled[provider.id] && (selected[provider.id]?.length || 0) > 0);
    if (!chosen.length) { setError("请至少选择一个平台及其探测节点"); return; }

    const metered = chosen.filter((provider) => provider.paid);
    if (metered.length > 0) {
      const meteredSummary = metered.map((provider) =>
        `${provider.label}：${selected[provider.id]?.length || 0} 个节点`,
      ).join("\n");
      const confirmed = window.confirm(
        `本次将调用可能扣费的 API：\n${meteredSummary}\n\nTCPTest 按成功节点扣额度；BOCE 按接口单价和节点数量扣波点。当前界面无法保证这两家账户的实时单价。请确认已在平台控制台核对余额和费用。\n\n仍要提交吗？`,
      );
      if (!confirmed) return;
    }

    setRunning(true);
    setError("");
    setTasks([]);
    setResults({});
    setProviderErrors({});
    const created = await Promise.all(chosen.map(async (provider) => {
      try {
        return await createProbeTask(config, {
          provider: provider.id, mode, target: target.trim(),
          ...(mode === "tcp" ? { port } : {}),
          nodeIds: selected[provider.id] || [], count: 4,
        });
      } catch (caught) {
        setProviderErrors((current) => ({ ...current, [provider.id]: caught instanceof Error ? caught.message : "任务提交失败" }));
        return null;
      }
    }));
    const activeTasks = created.filter((task): task is ProbeTask => task !== null);
    setTasks(activeTasks);
    if (!activeTasks.length) { setRunning(false); setError("所有平台任务提交失败，请检查 API 配置与额度。"); return; }

    const latest: Partial<Record<ProbeProviderId, ProbeResult>> = {};
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const settled = await Promise.all(activeTasks.map(async (task) => {
        try { return await getProbeResult(config, task.provider, task.taskId); }
        catch (caught) {
          setProviderErrors((current) => ({ ...current, [task.provider]: caught instanceof Error ? caught.message : "结果查询失败" }));
          return null;
        }
      }));
      settled.forEach((result) => { if (result) latest[result.provider] = result; });
      setResults({ ...latest });
      if (activeTasks.every((task) => latest[task.provider] && !latest[task.provider]?.pending)) break;
      if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    setRunning(false);
  }

  return (
    <InstancePanel
      id="instance-network-probes"
      title="网络连通性检测"
      kicker={<span className="inline-flex items-center gap-1.5"><ShieldCheck size={12} />管理员工具</span>}
      titleAction={<span className="rounded-full border border-(--hairline) px-2.5 py-1 text-[10px] font-semibold text-(--text-tertiary)">手动检测</span>}
      description={<>{nodeName ? `当前实例：${nodeName}。 ` : ""}ICMP Ping 与 TCP 端口同等重要。免费公开 API 用于国际节点对照；大陆三网需使用已配置的 TCPTest / BOCE 账户 API，或打开其官方网页手动检测。</>}
      className="instance-network-probe-panel"
    >
      <div className="flex flex-col gap-3">
        <details className="rounded-xl border border-(--hairline) bg-(--surface-elev) p-3" open={!config.baseUrl || !config.token}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-semibold text-(--text-primary)">
            <span>代理连接配置</span><ChevronDown size={14} />
          </summary>
          <div className="mt-3 grid gap-2">
            <label className="flex flex-col gap-1 text-[10px] font-semibold text-(--text-secondary)">
              HTTPS 代理地址
              <input value={proxyUrl} onChange={(event) => setProxyUrl(event.target.value)} placeholder="https://probe-api.example.com" className="min-h-9 rounded-lg border border-(--hairline) bg-(--bg-card) px-3 text-[11px] font-normal text-(--text-primary)" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-semibold text-(--text-secondary)">
              代理访问令牌
              <input type="password" autoComplete="new-password" value={proxyToken} onChange={(event) => setProxyToken(event.target.value)} placeholder="PROBE_PROXY_TOKEN" className="min-h-9 rounded-lg border border-(--hairline) bg-(--bg-card) px-3 text-[11px] font-normal text-(--text-primary)" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={persistConfig} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-(--hairline) px-3 text-[10px] font-semibold text-(--text-secondary)"><Save size={12} />保存本次会话</button>
              <button type="button" onClick={loadNodes} disabled={loadingNodes || !proxyUrl || !proxyToken} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-(--accent-500) px-3 text-[10px] font-bold text-white disabled:opacity-40"><RefreshCw size={12} className={loadingNodes ? "animate-spin" : ""} />{loadingNodes ? "正在读取节点…" : "读取免费节点与已配置平台"}</button>
            </div>
            <p className="text-[10px] leading-relaxed text-(--text-tertiary)">代理地址保存在本浏览器；令牌只保存在当前会话，关闭浏览器后需重新填写。Check-Host.net 无需平台 API Key；TCPTest 和 BOCE 的 API Key 只保存在代理服务器，且调用时可能扣除额度或波点。未配置密钥时不会请求这两家的 API。</p>
          </div>
        </details>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(120px,0.6fr)]">
          <label className="flex min-w-0 flex-col gap-1.5 text-[11px] font-semibold text-(--text-secondary)">
            目标公网 IPv4
            <input autoComplete="off" spellCheck={false} inputMode="decimal" value={target} onChange={(event) => { targetTouchedRef.current = true; setTarget(event.target.value); }} placeholder="自动读取当前实例，也可手动填写" className="min-h-10 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 text-[12px] font-mono font-normal text-(--text-primary)" />
            <span className="text-[10px] font-normal text-(--text-tertiary)">{targetStatus}</span>
          </label>
          {mode === "tcp" && (
            <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-(--text-secondary)">
              TCP 端口
              <input type="number" min={1} max={65535} value={portText} onChange={(event) => setPortText(event.target.value)} className="min-h-10 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 font-mono text-[12px] text-(--text-primary)" />
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-(--hairline) bg-(--surface-elev) p-1">
            <button type="button" onClick={() => setMode("ping")} aria-pressed={mode === "ping"} className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-bold ${mode === "ping" ? "bg-(--bg-card) text-(--text-primary) shadow-sm" : "text-(--text-tertiary)"}`}><Activity size={13} />ICMP Ping</button>
            <button type="button" onClick={() => setMode("tcp")} aria-pressed={mode === "tcp"} className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-bold ${mode === "tcp" ? "bg-(--bg-card) text-(--text-primary) shadow-sm" : "text-(--text-tertiary)"}`}><Network size={13} />TCP 端口</button>
          </div>
          {mode === "tcp" && [22, 80, 443, 8443, 10443].map((port) => (
            <button key={port} type="button" onClick={() => setPortText(String(port))} className="rounded-full border border-(--hairline) px-2.5 py-1 text-[10px] text-(--text-secondary)">{port}</button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {PROVIDERS.map((provider) => {
            const list = nodes[provider.id] || [];
            const count = selected[provider.id]?.length || 0;
            const status = providerStatus[provider.id];
            const mainlandCount = list.filter(isMainlandNode).length;
            const overseasCount = list.length - mainlandCount;
            const canUseApi = Boolean(status?.configured);
            return (
              <div key={provider.id} className="rounded-xl border border-(--hairline) p-3">
                <label className="flex items-center gap-2 text-[11px] font-semibold text-(--text-primary)">
                  <input
                    type="checkbox"
                    checked={enabled[provider.id]}
                    disabled={!canUseApi}
                    onChange={(event) => setEnabled((current) => ({ ...current, [provider.id]: event.target.checked }))}
                  />
                  {provider.label}
                  {provider.paid
                    ? <span className="rounded-full border border-(--hairline) px-1.5 py-0.5 text-[9px] font-medium text-(--text-tertiary)">按量计费</span>
                    : <span className="rounded-full border border-(--hairline) px-1.5 py-0.5 text-[9px] font-medium text-(--status-online)">无需 Key</span>}
                </label>
                <p className="mt-1 text-[10px] text-(--text-tertiary)">{provider.note}</p>
                <div className="mt-2 text-[10px] text-(--text-secondary)">大陆节点 {mainlandCount} · 海外节点 {overseasCount} · 已选 {count}</div>
                {quotaStatus[provider.id] && <div className="mt-1 text-[9px] text-(--text-tertiary)">{quotaStatus[provider.id]}</div>}
                {provider.paid && !canUseApi && (
                  <p className="mt-1 text-[9px] text-(--text-tertiary)">API 未配置，系统不会发起计费请求。</p>
                )}
                {provider.paid && !canUseApi && (
                  <a
                    href={mode === "ping" ? provider.pingUrl : provider.tcpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-[10px] font-semibold text-(--accent-500) hover:underline"
                  >
                    打开官方网页手动检测
                  </a>
                )}
                {provider.paid && canUseApi && !quotaStatus[provider.id] && (
                  <p className="mt-1 text-[9px] text-(--text-tertiary)">{status?.usageNote || "可能产生平台额度费用"}</p>
                )}
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={!list.length} onClick={() => selectNodes(provider.id, true)} className="text-[10px] font-semibold text-(--accent-500) disabled:opacity-40">选前 6 个</button>
                  <button type="button" disabled={!count} onClick={() => selectNodes(provider.id, false)} className="text-[10px] text-(--text-tertiary) disabled:opacity-40">清空</button>
                </div>
                {providerErrors[provider.id] && <p className="mt-2 text-[10px] text-(--status-offline)">{providerErrors[provider.id]}</p>}
                {list.length > 0 && (
                  <div className="mt-2 max-h-36 overflow-auto border-t border-(--hairline) pt-2">
                    {list.slice(0, 50).map((node) => (
                      <label key={node.id} className="flex items-center gap-2 py-1 text-[10px] text-(--text-secondary)">
                        <input type="checkbox" checked={(selected[provider.id] || []).includes(node.id)} onChange={(event) => setSelected((current) => {
                          const previous = current[provider.id] || [];
                          return { ...current, [provider.id]: event.target.checked ? [...previous, node.id].slice(0, 6) : previous.filter((id) => id !== node.id) };
                        })} />
                        <span className="min-w-0 truncate">{node.name || node.id} {node.city ? `· ${node.city}` : ""} {node.carrier ? `· ${carrierLabel(node.carrier)}` : ""}</span>
                      </label>
                    ))}
                    {list.length > 50 && <p className="pt-1 text-[9px] text-(--text-tertiary)">仅显示前 50 个节点；单次最多选择 6 个。</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--hairline) pt-3">
          <div className="flex max-w-xl items-start gap-2 text-[10px] leading-relaxed text-(--text-tertiary)">
            <CircleHelp size={13} className="mt-0.5 shrink-0" />
            <span>{mode === "ping" ? "ICMP 无响应可能是目标防火墙屏蔽 Ping，不代表 TCP 不通。" : "TCP 超时可能由防火墙或线路过滤造成，不等于服务一定停止。"}Check-Host.net 当前公开节点列表未包含中国大陆节点；TCPTest / BOCE 才能提供大陆多运营商节点，但 API 可能扣费。未配置付费 API 时可打开官网手动测试。每次仅在点击时提交检测。</span>
          </div>
          <button type="button" onClick={() => void runChecks()} disabled={running || !target.trim() || selectedCount === 0} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-(--accent-500) px-4 text-[11px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
            {running ? <LoaderCircle size={14} className="animate-spin" /> : <Activity size={14} />}
            {running ? "正在检测…" : `开始对比（${selectedCount} 个节点）`}
          </button>
        </div>

        {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 py-2.5 text-[11px] text-(--text-primary)"><AlertCircle size={14} className="mt-0.5 text-(--status-offline)" />{error}</div>}
        {tasks.length > 0 && (
          <div className="mt-2 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-bold text-(--text-primary)">检测结果对比</h3>
              {running && <span className="inline-flex items-center gap-1 text-[10px] text-(--text-tertiary)"><LoaderCircle size={12} className="animate-spin" />等待节点返回</span>}
            </div>
            {tasks.map((task) => {
              const rows = results[task.provider] ? rowsFromResult(task, results[task.provider]!) : [];
              return (
                <section key={task.provider} className="rounded-xl border border-(--hairline) p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <strong className="text-[11px] text-(--text-primary)">{PROVIDERS.find((provider) => provider.id === task.provider)?.label}</strong>
                    <span className="text-[10px] text-(--text-tertiary)">{results[task.provider] && !results[task.provider]?.pending ? "已完成" : "检测中"}</span>
                  </div>
                  {rows.length > 0 ? (
                    <>
                      <Summary rows={rows} />
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[520px] text-left text-[10px]">
                          <thead className="text-(--text-tertiary)"><tr><th className="py-2">节点</th><th>运营商</th><th>状态</th><th>延迟</th><th>丢包</th></tr></thead>
                          <tbody>{rows.map((row) => (
                            <tr key={row.id} className="border-t border-(--hairline) text-(--text-secondary)">
                              <td className="py-2"><div className="font-semibold text-(--text-primary)">{row.node}</div><div className="text-[9px]">{row.city}</div></td>
                              <td>{row.carrier || "—"}</td>
                              <td><span className="inline-flex items-center gap-1">{row.status === "success" ? <CheckCircle2 size={11} className="text-(--status-online)" /> : row.status === "failed" ? <XCircle size={11} className="text-(--status-offline)" /> : <AlertCircle size={11} />}{row.status === "success" ? "成功" : row.status === "failed" ? "失败/无响应" : row.status === "pending" ? "等待中" : "未知"}</span></td>
                              <td className="font-mono">{row.latencyMs == null ? "—" : `${row.latencyMs.toFixed(1)} ms`}</td>
                              <td className="font-mono">{row.lossPercent == null ? "—" : `${row.lossPercent.toFixed(1)}%`}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    </>
                  ) : <p className="text-[10px] text-(--text-tertiary)">任务已提交，等待平台返回结果。</p>}
                  {providerErrors[task.provider] && <p className="mt-2 text-[10px] text-(--status-offline)">{providerErrors[task.provider]}</p>}
                  {task.reportUrl && <a href={task.reportUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[10px] text-(--accent-500)">查看平台原始报告</a>}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </InstancePanel>
  );
}
