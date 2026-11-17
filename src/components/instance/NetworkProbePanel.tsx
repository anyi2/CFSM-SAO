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
  getGlobalpingRateLimit,
  GlobalpingApiError,
  isPublicIpv4,
  parseGlobalpingMeasurement,
  type GlobalpingRateLimitSnapshot,
  type GlobalpingResultRow,
  type NetworkProbeProtocol,
  type ProbeCoverage,
} from "@/services/networkProbe";

const PROTOCOLS: NetworkProbeProtocol[] = ["ICMP", "TCP", "UDP"];

const LOCATION_ROWS = [
  { id: "asn:4134", name: "中国电信", meta: "AS4134" },
  { id: "asn:4837", name: "中国联通", meta: "AS4837" },
  { id: "asn:9808", name: "中国移动", meta: "AS9808" },
  { id: "country:JP", name: "日本", meta: "JP" },
  { id: "country:HK", name: "香港", meta: "HK" },
  { id: "country:US", name: "美国", meta: "US" },
] as const;

type ProtocolRunStatus = "idle" | "running" | "complete" | "error" | "timeout";

interface ProtocolResultState {
  rows: GlobalpingResultRow[];
  status: ProtocolRunStatus;
  error?: string;
}

type ProtocolResults = Record<NetworkProbeProtocol, ProtocolResultState>;

interface StartedMeasurement {
  protocol: NetworkProbeProtocol;
  id?: string;
  probesCount: number;
  state: ProtocolResultState;
  errorCause?: unknown;
}

function createProtocolResults(status: ProtocolRunStatus = "idle"): ProtocolResults {
  return {
    ICMP: { rows: [], status },
    TCP: { rows: [], status },
    UDP: { rows: [], status },
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function statusLabel(status: GlobalpingResultRow["status"], protocol: NetworkProbeProtocol): string {
  if (status === "success") return protocol === "UDP" ? "路径有响应" : "有响应";
  if (status === "rejected") return protocol === "UDP" ? "收到不可达提示" : "拒绝 / 不可达";
  if (status === "failed") return "无响应";
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

function ProtocolResultCell({
  protocol,
  state,
  row,
}: {
  protocol: NetworkProbeProtocol;
  state: ProtocolResultState;
  row?: GlobalpingResultRow;
}) {
  if (!row) {
    const label = state.status === "running"
      ? "检测中…"
      : state.status === "error"
        ? "任务失败"
        : state.status === "timeout"
          ? "等待超时"
          : state.status === "complete"
            ? "该位置无结果"
            : "—";
    return (
      <td className="px-2.5 py-3 align-top">
        <div className="text-[10px] text-(--text-tertiary)" title={state.error}>
          {label}
        </div>
        {state.error && <div className="mt-1 max-w-[170px] text-[9px] text-(--status-offline)">{state.error}</div>}
      </td>
    );
  }

  return (
    <td className="px-2.5 py-3 align-top">
      <div className="flex items-center gap-1.5 whitespace-nowrap text-[10px] font-medium text-(--text-primary)">
        <StatusIcon status={row.status} />
        {statusLabel(row.status, protocol)}
      </div>
      <div className="mt-1 font-mono text-[11px] text-(--text-primary)">
        {row.latencyMs == null ? "—" : row.latencyMs.toFixed(1) + " ms"}
      </div>
      <div className="mt-1 max-w-[180px] truncate text-[9px] text-(--text-tertiary)" title={[row.probeType, row.network, row.city, row.detail].filter(Boolean).join(" · ")}>
        {[row.probeType, row.network || row.city].filter(Boolean).join(" · ") || "探针信息未知"}
      </div>
      {protocol === "UDP" && (
        <div className="mt-1 max-w-[180px] text-[9px] leading-relaxed text-(--text-tertiary)">
          {row.detail}
        </div>
      )}
    </td>
  );
}

function CompactProtocolResult({ protocol, state, row }: {
  protocol: NetworkProbeProtocol;
  state: ProtocolResultState;
  row?: GlobalpingResultRow;
}) {
  if (!row) {
    const label = state.status === "running" ? "检测中…" : state.status === "error" ? "任务失败" : state.status === "timeout" ? "等待超时" : state.status === "complete" ? "无结果" : "—";
    return (
      <div className="min-w-0 rounded-lg bg-(--surface-elev) p-2">
        <div className="text-[9px] font-bold text-(--text-secondary)">{protocol}</div>
        <div className="mt-1 text-[10px] text-(--text-tertiary)">{label}</div>
        {state.error && <div className="mt-1 break-words text-[9px] text-(--status-offline)">{state.error}</div>}
      </div>
    );
  }
  return (
    <div className="min-w-0 rounded-lg bg-(--surface-elev) p-2">
      <div className="text-[9px] font-bold text-(--text-secondary)">{protocol}</div>
      <div className="mt-1 flex items-center gap-1 text-[10px] font-medium text-(--text-primary)"><StatusIcon status={row.status} /><span className="truncate">{statusLabel(row.status, protocol)}</span></div>
      <div className="mt-1 font-mono text-[11px] text-(--text-primary)">{row.latencyMs == null ? "—" : row.latencyMs.toFixed(1) + " ms"}</div>
      <div className="mt-1 truncate text-[9px] text-(--text-tertiary)" title={[row.probeType, row.network, row.city].filter(Boolean).join(" · ")}>{[row.probeType, row.network || row.city].filter(Boolean).join(" · ") || "探针信息未知"}</div>
      {protocol === "UDP" && <div className="mt-1 text-[9px] leading-relaxed text-(--text-tertiary)">{row.detail}</div>}
    </div>
  );
}
export function NetworkProbePanel({ nodeName, nodeUuid }: { nodeName?: string; nodeUuid: string }) {
  const [target, setTarget] = useState("");
  const [targetStatus, setTargetStatus] = useState("正在读取当前实例公网 IPv4…");
  const [portText, setPortText] = useState("443");
  const [coverage, setCoverage] = useState<ProbeCoverage[] | null>(null);
  const [protocolResults, setProtocolResults] = useState<ProtocolResults>(() => createProtocolResults());
  const [probeCount, setProbeCount] = useState<number | null>(null);
  const [rateLimit, setRateLimit] = useState<GlobalpingRateLimitSnapshot | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [quotaError, setQuotaError] = useState("");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const targetTouchedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    getGlobalpingRateLimit()
      .then((snapshot) => {
        if (!active) return;
        setRateLimit(snapshot);
        setQuotaError("");
      })
      .catch(() => { if (active) setQuotaError("额度信息暂时无法读取，可手动刷新"); })
      .finally(() => { if (active) setQuotaLoading(false); });
    return () => { active = false; };
  }, []);

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
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("TCP / UDP 共用的目标端口必须是 1–65535 之间的整数。");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError("");
    setCoverage(null);
    setProtocolResults(createProtocolResults("running"));
    setProbeCount(null);
    setStatusText("正在读取 Globalping 当前在线探针…");
    const applyRateLimit = (snapshot?: GlobalpingRateLimitSnapshot) => {
      if (!snapshot) return;
      setRateLimit((previous) => ({ ...snapshot, type: previous?.type ?? snapshot.type }));
      setQuotaError("");
    };
    let probes: Awaited<ReturnType<typeof getGlobalpingProbes>> = [];
    const startMeasurement = async (protocol: NetworkProbeProtocol, reuseProbeMeasurementId?: string): Promise<StartedMeasurement> => {
      try {
        const request = buildGlobalpingMeasurementRequest(ip, port, probes, protocol, reuseProbeMeasurementId);
        const task = await createGlobalpingMeasurement(request, controller.signal);
        applyRateLimit(task.rateLimit);
        return { protocol, id: task.id, probesCount: task.probesCount, state: { rows: [], status: "running" } };
      } catch (caught) {
        if (caught instanceof GlobalpingApiError) applyRateLimit(caught.rateLimit);
        return { protocol, probesCount: 0, errorCause: caught, state: { rows: [], status: "error", error: caught instanceof Error ? caught.message : "任务提交失败" } };
      }
    };
    try {
      probes = await getGlobalpingProbes(controller.signal);
      if (controller.signal.aborted) return;
      setCoverage(getCarrierProbeCoverage(probes));
      setStatusText("正在建立基准探针组（ICMP）…");
      const baseline = await startMeasurement("ICMP");
      if (controller.signal.aborted) return;
      const started: StartedMeasurement[] = [baseline];
      if (baseline.id) {
        setStatusText("基准探针组已建立 · TCP / UDP 正在复用同一组探针…");
        const next = await Promise.all([startMeasurement("TCP", baseline.id), startMeasurement("UDP", baseline.id)]);
        started.push(...next);
      } else {
        const rateLimited = baseline.errorCause instanceof GlobalpingApiError && baseline.errorCause.status === 429;
        if (rateLimited) {
          for (const protocol of ["TCP", "UDP"] as const) {
            started.push({ protocol, probesCount: 0, state: { rows: [], status: "error", error: baseline.state.error } });
          }
        } else {
          setStatusText("ICMP 基准任务未建立 · TCP / UDP 将尝试独立选点…");
          const next = await Promise.all([startMeasurement("TCP"), startMeasurement("UDP")]);
          started.push(...next);
        }
      }
      if (controller.signal.aborted) return;
      const startedResults = createProtocolResults();
      for (const run of started) startedResults[run.protocol] = run.state;
      setProtocolResults(startedResults);
      void getGlobalpingRateLimit().then(applyRateLimit).catch(() => undefined);
      const activeRuns = started.filter((run) => run.id);
      const totalProbeCount = started.reduce((sum, run) => sum + run.probesCount, 0);
      setProbeCount(totalProbeCount);
      if (activeRuns.length === 0) {
        setStatusText("ICMP、TCP、UDP 三项任务均未能提交，请查看各列错误信息。");
        return;
      }
      const locationCount = buildGlobalpingMeasurementRequest(ip, port, probes, "ICMP").locations.length;
      setStatusText("三协议任务已提交 · 实际分配 " + totalProbeCount + " 个探针（计划最多 " + (locationCount * activeRuns.length) + " 次探针测试），正在汇总结果…");
      const currentRuns = new Map<NetworkProbeProtocol, StartedMeasurement>(started.map((run) => [run.protocol, run]));
      // A one-second wait between result requests stays below the API 2 req/s per-measurement ceiling.
      // 45 rounds allow the documented 30-second probe timeout plus final result delivery.
      for (let attempt = 0; attempt < 45; attempt += 1) {
        if (controller.signal.aborted) return;
        if (attempt > 0) await wait(1000);
        const pollingRuns = [...currentRuns.values()].filter((run) => run.id && run.state.status === "running");
        if (!pollingRuns.length) break;
        const updates = await Promise.all(pollingRuns.map(async (run) => {
          try {
            const measurement = await getGlobalpingMeasurement(run.id!, controller.signal);
            return { protocol: run.protocol, state: { rows: parseGlobalpingMeasurement(measurement, run.protocol), status: measurement.status === "in-progress" ? "running" as const : "complete" as const } };
          } catch (caught) {
            if (caught instanceof GlobalpingApiError) applyRateLimit(caught.rateLimit);
            return { protocol: run.protocol, state: { rows: run.state.rows, status: "error" as const, error: caught instanceof Error ? caught.message : "读取检测结果失败" } };
          }
        }));
        if (controller.signal.aborted) return;
        for (const update of updates) { const run = currentRuns.get(update.protocol); if (run) run.state = update.state; }
        setProtocolResults((previous) => { const next = { ...previous }; for (const update of updates) next[update.protocol] = update.state; return next; });
        const finishedCount = [...currentRuns.values()].filter((run) => run.state.status === "complete" || run.state.status === "error").length;
        const runningCount = 3 - finishedCount;
        setStatusText("结果汇总中 · 已完成 " + finishedCount + " / 3 项协议" + (runningCount > 0 ? " · 仍有 " + runningCount + " 项检测中" : ""));
      }
      if (controller.signal.aborted) return;
      for (const run of currentRuns.values()) { if (run.state.status === "running") run.state = { ...run.state, status: "timeout" }; }
      setProtocolResults(Object.fromEntries([...currentRuns.entries()].map(([protocol, run]) => [protocol, run.state])) as ProtocolResults);
      const finalRuns = [...currentRuns.values()];
      const completed = finalRuns.filter((run) => run.state.status === "complete").length;
      const failed = finalRuns.filter((run) => run.state.status === "error").length;
      const timedOut = finalRuns.filter((run) => run.state.status === "timeout").length;
      setStatusText("三协议检测结束 · 完成 " + completed + " 项" + (failed ? " · 失败 " + failed + " 项" : "") + (timedOut ? " · 等待超时 " + timedOut + " 项" : ""));
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (caught instanceof GlobalpingApiError) applyRateLimit(caught.rateLimit);
      setError(caught instanceof Error ? caught.message : "网络检测失败，请稍后重试。");
      setStatusText("");
    } finally {
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  const resultCount = PROTOCOLS.reduce((sum, protocol) => sum + protocolResults[protocol].rows.length, 0);

  return (
    <InstancePanel
      id="instance-network-probes"
      title="跨区域网络检测"
      kicker={<span className="inline-flex items-center gap-1.5"><Activity size={12} />管理员工具</span>}
      titleAction={<span className="rounded-full border border-(--hairline) px-2.5 py-1 text-[10px] font-semibold text-(--text-tertiary)">免费 API</span>}
      description={<>{nodeName ? "当前实例：" + nodeName + "。 " : ""}一次点击同时执行 ICMP、TCP、UDP 检测；电信、联通、移动各一个探针，日本、香港、美国各一个探针，三种协议结果合并显示，不重复列出地区。</>}
      className="instance-network-probe-panel"
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(120px,0.6fr)]">
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
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-(--text-secondary)">
            TCP / UDP 共用目标端口
            <input
              type="number"
              min={1}
              max={65535}
              value={portText}
              onChange={(event) => setPortText(event.target.value)}
              className="min-h-10 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 font-mono text-[12px] text-(--text-primary)"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[22, 53, 80, 443, 8443, 10443].map((port) => (
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
            disabled={running || !target.trim() || !portText.trim()}
            className="ml-auto inline-flex min-h-9 items-center gap-2 rounded-xl bg-(--accent-500) px-4 text-[11px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {running ? "正在进行三协议检测…" : "开始三协议检测"}
          </button>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 py-2.5 text-[10px] leading-relaxed text-(--text-tertiary)">
          <CircleHelp size={13} className="mt-0.5 shrink-0" />
          <span>先由 ICMP 建立基准探针组，TCP / UDP 复用同一组探针，便于横向比较；若基准任务失败，TCP / UDP 会独立尝试。每种协议最多覆盖电信、联通、移动、日本、香港、美国各一个探针，三项合计最多 18 次探针测试。仅手动触发，不进行后台巡检。</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold text-(--text-secondary)">Globalping API 检测额度</div>
            <div className={["mt-1 text-[10px]", rateLimit?.remaining === 0 ? "text-(--status-offline)" : "text-(--text-tertiary)"].join(" ")}>
              {rateLimit
                ? "剩余探针测试 " + rateLimit.remaining + " / " + rateLimit.limit + " 次 · " + (rateLimit.type === "ip" ? "按当前出口 IP 共享" : "账户额度") + " · 约 " + rateLimit.resetSeconds + " 秒后重置"
                : quotaLoading ? "正在读取当前额度…" : quotaError || "额度信息暂不可用"}
              {rateLimit?.creditsRemaining !== undefined ? " · 额外积分 " + rateLimit.creditsRemaining : ""}
            </div>
          </div>
          <button type="button" onClick={async () => {
            setQuotaLoading(true);
            setQuotaError("");
            try { setRateLimit(await getGlobalpingRateLimit()); }
            catch { setQuotaError("额度信息暂时无法读取"); }
            finally { setQuotaLoading(false); }
          }} disabled={quotaLoading} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-(--hairline) px-2.5 py-1.5 text-[10px] font-semibold text-(--text-secondary) disabled:opacity-50">
            <RefreshCw size={11} className={quotaLoading ? "animate-spin" : ""} />刷新额度
          </button>
        </div>

        {coverage && (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold text-(--text-primary)">大陆三网在线探针覆盖（可用数量，不是本次采样数量）</div>
            <CoverageText coverage={coverage} />
          </div>
        )}

        {statusText && (
          <div className="text-[10px] text-(--text-tertiary)" role="status" aria-live="polite">
            {statusText}{probeCount != null ? " · 合计探针 " + probeCount : ""}{resultCount > 0 ? " · 已收到 " + resultCount + " 条协议/地区结果" : ""}
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

        {(resultCount > 0 || running || PROTOCOLS.some((protocol) => protocolResults[protocol].status === "error" || protocolResults[protocol].status === "timeout")) && (
          <>
            <div className="flex flex-col gap-2 md:hidden">
              {LOCATION_ROWS.map((location) => (
                <section key={location.id} className="rounded-xl border border-(--hairline) p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-(--text-primary)">{location.name}</span>
                    <span className="text-[9px] text-(--text-tertiary)">{location.meta}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {PROTOCOLS.map((protocol) => (
                      <CompactProtocolResult key={protocol} protocol={protocol} state={protocolResults[protocol]} row={protocolResults[protocol].rows.find((item) => item.id === location.id)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-xl border border-(--hairline) md:block">
            <table className="w-full min-w-[760px] text-left text-[10px]">
              <thead className="bg-(--surface-elev) text-(--text-tertiary)">
                <tr>
                  <th className="w-[150px] px-3 py-2.5">运营商 / 区域</th>
                  <th className="px-2.5 py-2.5"><span className="font-bold text-(--text-primary)">ICMP</span><div className="text-[9px] font-normal">Ping</div></th>
                  <th className="px-2.5 py-2.5"><span className="font-bold text-(--text-primary)">TCP</span><div className="text-[9px] font-normal">端口 {portText}</div></th>
                  <th className="px-2.5 py-2.5"><span className="font-bold text-(--text-primary)">UDP</span><div className="text-[9px] font-normal">端口 {portText} · MTR</div></th>
                </tr>
              </thead>
              <tbody>
                {LOCATION_ROWS.map((location) => (
                  <tr key={location.id} className="border-t border-(--hairline)">
                    <td className="px-3 py-3 align-top">
                      <div className="font-semibold text-[11px] text-(--text-primary)">{location.name}</div>
                      <div className="mt-0.5 text-[9px] text-(--text-tertiary)">{location.meta}</div>
                    </td>
                    {PROTOCOLS.map((protocol) => (
                      <ProtocolResultCell
                        key={protocol}
                        protocol={protocol}
                        state={protocolResults[protocol]}
                        row={protocolResults[protocol].rows.find((item) => item.id === location.id)}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--hairline) pt-3">
          <p className="max-w-xl text-[10px] leading-relaxed text-(--text-tertiary)">
            ICMP 无响应不代表 TCP/UDP 端口不可用；TCP 拒绝/重置与超时含义不同；UDP 使用 MTR 路径探测，路径节点响应不等于目标 UDP 服务端口开放。单次超时不等同于封禁。探测结果及目标 IP 会由 Globalping 处理。
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
