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
  type ProbeCoverage,
} from "@/services/networkProbe";

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function statusLabel(status: GlobalpingResultRow["status"]): string {
  if (status === "success") return "TCP 有响应";
  if (status === "rejected") return "目标拒绝/重置";
  if (status === "failed") return "无 TCP 响应";
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
            宽带探针 {item.eyeball} · 数据中心 {item.datacenter}
          </div>
        </div>
      ))}
    </div>
  );
}

export function NetworkProbePanel({ nodeName, nodeUuid }: { nodeName?: string; nodeUuid: string }) {
  const [target, setTarget] = useState("");
  const [targetStatus, setTargetStatus] = useState("正在读取当前实例公网 IPv4…");
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
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("TCP 端口必须是 1–65535 之间的整数。");
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

      const request = buildGlobalpingMeasurementRequest(ip, port, probes);
      const plannedCount = request.locations.reduce((sum, location) => sum + location.limit, 0);
      setStatusText("正在向 " + request.locations.length + " 组探测区域提交任务…");
      const task = await createGlobalpingMeasurement(request, controller.signal);
      if (controller.signal.aborted) return;
      setProbeCount(task.probesCount);
      setStatusText("任务已提交，实际分配 " + task.probesCount + " 个探针（计划最多 " + plannedCount + " 个），正在等待结果…");

      let latestRows: GlobalpingResultRow[] = [];
      let finished = false;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        if (controller.signal.aborted) return;
        if (attempt > 0) await wait(2000);
        const measurement = await getGlobalpingMeasurement(task.id, controller.signal);
        latestRows = parseGlobalpingMeasurement(measurement);
        setRows(latestRows);
        if (measurement.status === "finished") {
          finished = true;
          break;
        }
        setStatusText("检测进行中…已收到 " + latestRows.length + " 条节点结果");
      }
      if (controller.signal.aborted) return;
      setStatusText(finished
        ? "检测完成 · " + latestRows.length + " 条结果"
        : "检测仍在进行，当前已返回 " + latestRows.length + " 条结果；可稍后重新检测");
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "网络检测失败，请稍后重试。");
      setStatusText("");
    } finally {
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  return (
    <InstancePanel
      id="instance-network-probes"
      title="大陆 TCP 端口检测"
      kicker={<span className="inline-flex items-center gap-1.5"><Activity size={12} />管理员工具</span>}
      titleAction={<span className="rounded-full border border-(--hairline) px-2.5 py-1 text-[10px] font-semibold text-(--text-tertiary)">免费 API</span>}
      description={<>{nodeName ? "当前实例：" + nodeName + "。 " : ""}从中国电信、联通、移动网络探测指定 TCP 端口，并用海外节点作对照。检测由 Globalping 社区在线探针执行，不代表运营商官方测量。</>}
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
            TCP 端口
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
          {[22, 80, 443, 8443, 10443].map((port) => (
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
            {running ? "正在检测…" : "开始 TCP 检测"}
          </button>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 py-2.5 text-[10px] leading-relaxed text-(--text-tertiary)">
          <CircleHelp size={13} className="mt-0.5 shrink-0" />
          <span>每次点击才发起一次检测，不进行后台巡检。优先选择 ISP 的家庭/企业宽带探针；没有时使用该运营商 ASN 下其他在线探针。在线节点数量会随社区设备状态变化。</span>
        </div>

        {coverage && (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold text-(--text-primary)">当前大陆运营商探针覆盖</div>
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
                  <th className="px-3 py-2">TCP 响应</th>
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
                        {statusLabel(row.status)}
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
            超时不等同于封禁。大陆节点失败而海外成功，说明大陆方向存在连通异常，应结合防火墙、端口监听及其他运营商复测。探测结果及目标 IP 会由 Globalping 处理。
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
