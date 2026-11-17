import { useEffect, useRef, useState } from "react";
import {
  Activity, CheckCircle2, CircleHelp, ExternalLink, LoaderCircle,
  RefreshCw, ShieldAlert, XCircle,
} from "lucide-react";
import { InstancePanel } from "./InstancePanel";
import {
  buildGlobalpingMeasurementRequest,
  createGlobalpingMeasurement,
  getCarrierProbeCoverage,
  getCurrentNodePublicIpv4,
  getGlobalpingMeasurement,
  getGlobalpingProbes,
  isPublicIpv4,
  parseGlobalpingMeasurement,
  type GlobalpingResultRow,
  type NetworkProbeProtocol,
  type ProbeCoverage,
} from "@/services/networkProbe";

const PROTOCOL_OPTIONS: Array<{ value: NetworkProbeProtocol; label: string; hint: string }> = [
  { value: "ICMP", label: "ICMP", hint: "Ping 连通性" },
  { value: "TCP", label: "TCP", hint: "指定端口连通性" },
  { value: "UDP", label: "UDP", hint: "UDP 路径探测" },
];

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function statusLabel(status: GlobalpingResultRow["status"], protocol: NetworkProbeProtocol): string {
  if (status === "success") return protocol === "UDP" ? "UDP 路径有响应" : protocol + " 有响应";
  if (status === "rejected") return protocol === "UDP" ? "收到不可达提示" : "目标拒绝/不可达";
  if (status === "failed") return protocol === "UDP" ? "未收到 UDP 路径响应" : protocol + " 无响应";
  if (status === "pending") return "检测中";
  return "结果未知";
}

function StatusIcon({ status }: { status: GlobalpingResultRow["status"] }) {
  if (status === "success") return <CheckCircle2 size={13} className="text-(--status-online)" />;
  if (status === "rejected") return <ShieldAlert size={13} className="text-(--text-secondary)" />;
  if (status === "failed") return <XCircle size={13} className="text-(--status-offline)" />;
  return <Activity size={13} className="text-(--text-tertiary)" />;
}

function CoverageText({ coverage }: { coverage: ProbeCoverage[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {coverage.map((item) => (
        <div key={item.id} className="rounded-xl border border-(--hairline) bg-(--surface-elev) p-3">
          <div className="text-[11px] font-semibold text-(--text-primary)">{item.name}</div>
          <div className="mt-1 text-[10px] text-(--text-tertiary)">AS{item.asn} · 在线探针 {item.total}</div>
          <div className="mt-1 text-[10px] text-(--text-secondary)">
            宽带 {item.eyeball} · 数据中心 {item.datacenter}
          </div>
        </div>
      ))}
    </div>
  );
}

export function NetworkProbePanel({ nodeName, nodeUuid }: { nodeName?: string; nodeUuid: string }) {
  const [target, setTarget] = useState("");
  const [targetStatus, setTargetStatus] = useState("正在读取当前实例公网 IPv4…");
  const [protocol, setProtocol] = useState<NetworkProbeProtocol>("TCP");
  const [portText, setPortText] = useState("443");
  const [coverage, setCoverage] = useState<ProbeCoverage[] | null>(null);
  const [rows, setRows] = useState<GlobalpingResultRow[]>([]);
  const [probeCount, setProbeCount] = useState<number | null>(null);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const targetTouchedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

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
          setTargetStatus("管理端未提供该实例公网 IPv4，请手动填写");
        }
      })
      .catch(() => {
        if (active) setTargetStatus("自动识别失败，请手动填写公网 IPv4");
      });
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, [nodeUuid]);

  async function runCheck() {
    if (running) return;
    const ip = target.trim();
    const port = Number(portText);
    if (!isPublicIpv4(ip)) {
      setError("请填写当前服务器真实的公网 IPv4 地址。不要填写经过 Cloudflare 代理的域名。");
      return;
    }
    if (protocol !== "ICMP" && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      setError("TCP / UDP 目标端口必须是 1–65535 之间的整数。");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError("");
    setRows([]);
    setCoverage(null);
    setProbeCount(null);
    setStatusText("正在读取 Globalping 当前在线探针…");

    try {
      const probes = await getGlobalpingProbes(controller.signal);
      if (controller.signal.aborted) return;
      const currentCoverage = getCarrierProbeCoverage(probes);
      setCoverage(currentCoverage);

      const request = buildGlobalpingMeasurementRequest(ip, port, probes, protocol);
      const plannedCount = request.locations.length;
      setStatusText("正在向 " + plannedCount + " 个目标位置提交 " + protocol + " 任务…");
      const task = await createGlobalpingMeasurement(request, controller.signal);
      if (controller.signal.aborted) return;
      setProbeCount(task.probesCount);
      setStatusText("任务已提交，实际分配 " + task.probesCount + " 个探针（最多 " + plannedCount + " 个），正在等待结果…");

      let latestRows: GlobalpingResultRow[] = [];
      let finished = false;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        if (controller.signal.aborted) return;
        if (attempt > 0) await wait(2000);
        const measurement = await getGlobalpingMeasurement(task.id, controller.signal);
        latestRows = parseGlobalpingMeasurement(measurement, protocol);
        setRows(latestRows);
        if (measurement.status === "finished") {
          finished = true;
          break;
        }
        setStatusText("检测进行中…已收到 " + latestRows.length + " 个不同运营商/地区的结果");
      }
      if (controller.signal.aborted) return;
      setStatusText(finished
        ? "检测完成 · " + latestRows.length + " 个唯一位置"
        : "检测仍在进行，当前已返回 " + latestRows.length + " 个唯一位置；可稍后重新检测");
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "网络检测失败，请稍后重试。");
      setStatusText("");
    } finally {
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  const needsPort = protocol !== "ICMP";

  return (
    <InstancePanel
      id="instance-network-probes"
      title="跨区域网络检测"
      kicker={<span className="inline-flex items-center gap-1.5"><Activity size={12} />管理员工具</span>}
      titleAction={<span className="rounded-full border border-(--hairline) px-2.5 py-1 text-[10px] font-semibold text-(--text-tertiary)">免费 API</span>}
      description={<>{nodeName ? "当前实例：" + nodeName + "。 " : ""}支持 ICMP、TCP、UDP 三种检测；大陆电信、联通、移动各选一个探针，海外只选日本、香港、美国各一个，不重复展示同一运营商或地区。</>}
      className="instance-network-probe-panel"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-semibold text-(--text-secondary)">检测协议</div>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="检测协议">
            {PROTOCOL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={protocol === option.value}
                onClick={() => {
                  setProtocol(option.value);
                  setError("");
                  setRows([]);
                  setStatusText("");
                }}
                className={[
                  "flex min-h-10 flex-col items-center justify-center rounded-xl border px-2 py-1.5 text-[11px] transition-colors",
                  protocol === option.value
                    ? "border-(--accent-500) bg-(--accent-500)/10 text-(--accent-500)"
                    : "border-(--hairline) bg-(--surface-elev) text-(--text-secondary) hover:border-(--accent-500)",
                ].join(" ")}
              >
                <span className="font-bold">{option.label}</span>
                <span className="text-[9px] opacity-75">{option.hint}</span>
              </button>
            ))}
          </div>
          {protocol === "UDP" && (
            <p className="text-[10px] leading-relaxed text-(--text-tertiary)">
              UDP 使用 Globalping MTR 路径探测。路由节点有响应不等于目标 UDP 服务端口已开放；中间路由器也可能不返回探测包。
            </p>
          )}
        </div>

        <div className={["grid gap-3", needsPort ? "sm:grid-cols-[minmax(0,1.4fr)_minmax(120px,0.6fr)]" : "grid-cols-1"].join(" ")}>
          <label className="flex min-w-0 flex-col gap-1.5 text-[11px] font-semibold text-(--text-secondary)">
            目标公网 IPv4
            <input
              autoComplete="off"
              spellCheck={false}
              inputMode="decimal"
              value={target}
              onChange={(event) => {
                targetTouchedRef.current = true;
                setTarget(event.target.value);
              }}
              placeholder="自动读取当前实例，也可手动填写"
              className="min-h-10 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 text-[12px] font-mono font-normal text-(--text-primary)"
            />
            <span className="text-[10px] font-normal text-(--text-tertiary)">{targetStatus}</span>
          </label>
          {needsPort && (
            <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-(--text-secondary)">
              {protocol} 目标端口
              <input
                type="number"
                min={1}
                max={65535}
                value={portText}
                onChange={(event) => setPortText(event.target.value)}
                className="min-h-10 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 font-mono text-[12px] text-(--text-primary)"
              />
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {needsPort && [22, 53, 80, 443, 8443, 10443].map((port) => (
            <button
              key={port}
              type="button"
              onClick={() => setPortText(String(port))}
              className="rounded-full border border-(--hairline) px-2.5 py-1 text-[10px] text-(--text-secondary) hover:border-(--accent-500)"
            >
              {port}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void runCheck()}
            disabled={running || !target.trim() || (needsPort && !portText.trim())}
            className="ml-auto inline-flex min-h-9 items-center gap-2 rounded-xl bg-(--accent-500) px-4 text-[11px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {running ? "正在检测…" : "开始 " + protocol + " 检测"}
          </button>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 py-2.5 text-[10px] leading-relaxed text-(--text-tertiary)">
          <CircleHelp size={13} className="mt-0.5 shrink-0" />
          <span>每次点击才发起一次检测，不进行后台巡检。每个大陆运营商和海外地区最多选一个在线探针；大陆优先家庭/企业宽带，没有时回退同 ASN 其他探针并标注类型。最多六个探针，实际数量取决于在线情况。</span>
        </div>

        {coverage && (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold text-(--text-primary)">大陆三网在线探针覆盖（可用数量，不是本次采样数量）</div>
            <CoverageText coverage={coverage} />
          </div>
        )}

        {statusText && (
          <div className="text-[10px] text-(--text-tertiary)" role="status" aria-live="polite">
            {statusText}{probeCount != null ? " · 实际探针 " + probeCount : ""}
          </div>
        )}

        {error && (
          <div role="alert" className="flex flex-col gap-2 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 py-2.5 text-[11px] text-(--text-primary)">
            <div className="flex items-start gap-2">
              <ShieldAlert size={14} className="mt-0.5 shrink-0 text-(--status-offline)" />
              <span>{error}</span>
            </div>
            <a
              href="https://api.globalping.io/v1/probes"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 pl-5 text-[10px] font-semibold text-(--accent-500) hover:underline"
            >
              测试 Globalping 接口 <ExternalLink size={11} />
            </a>
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-(--hairline)">
            <table className="w-full min-w-[650px] text-left text-[10px]">
              <thead className="bg-(--surface-elev) text-(--text-tertiary)">
                <tr>
                  <th className="px-3 py-2">运营商 / 区域</th>
                  <th className="px-3 py-2">探针网络</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">响应 / RTT</th>
                  <th className="px-3 py-2">说明</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-(--hairline) text-(--text-secondary)">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-(--text-primary)">{row.carrier}</div>
                      <div className="text-[9px] text-(--text-tertiary)">
                        {row.country}{row.city ? " · " + row.city : ""}{row.asn ? " · AS" + row.asn : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{row.probeType}</div>
                      <div className="text-[9px] text-(--text-tertiary)">{row.network || "网络名称未知"}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <StatusIcon status={row.status} />
                        {statusLabel(row.status, protocol)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {row.latencyMs == null ? "—" : row.latencyMs.toFixed(1) + " ms"}
                    </td>
                    <td className="max-w-[220px] px-3 py-2 text-[9px]">{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--hairline) pt-3">
          <p className="max-w-xl text-[10px] leading-relaxed text-(--text-tertiary)">
            超时不等同于封禁。ICMP 无响应不代表 TCP/UDP 端口不可用；TCP 拒绝/重置与超时含义不同；UDP 路径响应也不等于服务端口开放。请结合服务器监听、防火墙和不同线路复测。探测结果及目标 IP 会由 Globalping 处理。
          </p>
          <a
            href="https://antping.com/tcp"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-(--accent-500) hover:underline"
          >
            AntPing 人工复核 <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </InstancePanel>
  );
}
