import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Network,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { InstancePanel } from "./InstancePanel";
import {
  runPortCheck,
  type PortCheckInput,
  type PortCheckProtocol,
  type PortCheckRegion,
  type PortCheckReport,
  type PortCheckResultRow,
} from "@/services/portCheck";

const REGION_OPTIONS: Array<{ value: PortCheckRegion; label: string }> = [
  { value: "ALL", label: "全球节点" },
  { value: "CN", label: "中国大陆" },
  { value: "AS", label: "亚洲" },
  { value: "EU", label: "欧洲" },
  { value: "NA", label: "北美" },
];

const TCP_PRESETS = [
  { port: 22, label: "SSH" },
  { port: 80, label: "HTTP" },
  { port: 443, label: "HTTPS" },
  { port: 3306, label: "MySQL" },
  { port: 5432, label: "PostgreSQL" },
  { port: 8443, label: "自定义服务" },
];

const UDP_PRESETS = [
  { port: 53, label: "DNS" },
  { port: 123, label: "NTP" },
  { port: 443, label: "QUIC" },
  { port: 51820, label: "WireGuard" },
];

function statusForRow(protocol: PortCheckProtocol, row: PortCheckResultRow) {
  if (row.status === 1) {
    return {
      label: protocol === "tcp" ? "连接成功" : "收到响应",
      tone: "success",
      icon: <CheckCircle2 size={13} aria-hidden="true" />,
    };
  }
  if (row.status == null) {
    return {
      label: "结果未知",
      tone: "neutral",
      icon: <AlertCircle size={13} aria-hidden="true" />,
    };
  }
  return {
    label: protocol === "tcp" ? "未连通" : "无响应 / 未确认",
    tone: "warning",
    icon: <XCircle size={13} aria-hidden="true" />,
  };
}

function formatLatency(value: number | null): string {
  if (value == null) return "—";
  return value < 1 ? "< 1 ms" : `${Math.round(value)} ms`;
}

function ResultRow({
  protocol,
  row,
}: {
  protocol: PortCheckProtocol;
  row: PortCheckResultRow;
}) {
  const status = statusForRow(protocol, row);
  const locationLabel = [row.city, row.country].filter(Boolean).join(", ") || row.location;

  return (
    <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] items-center gap-3 border-t border-(--hairline) px-3 py-3 text-[11px] sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="truncate font-semibold text-(--text-primary)" title={locationLabel}>
          {locationLabel}
        </div>
        <div className="mt-1 truncate text-(--text-tertiary)" title={row.isp || row.asn}>
          {[row.isp, row.asn].filter(Boolean).join(" · ") || row.location}
        </div>
      </div>
      <div className="hidden min-w-0 sm:block">
        <div className="text-(--text-secondary)">目标 IP</div>
        <div className="mt-1 truncate font-mono text-(--text-primary)">
          {row.targetIp || "—"}
        </div>
      </div>
      <div className="hidden min-w-0 sm:block">
        <div className="text-(--text-secondary)">响应时间</div>
        <div className="mt-1 font-mono font-semibold text-(--text-primary)">
          {formatLatency(row.latencyMs)}
        </div>
      </div>
      <div className={`inline-flex items-center gap-1.5 whitespace-nowrap font-semibold ${
        status.tone === "success"
          ? "text-(--status-online)"
          : status.tone === "warning"
            ? "text-(--status-offline)"
            : "text-(--text-tertiary)"
      }`} title={row.error || status.label}>
        {status.icon}
        {status.label}
      </div>
    </div>
  );
}

export function PortCheckPanel({ nodeName }: { nodeName?: string }) {
  const [target, setTarget] = useState("");
  const [portText, setPortText] = useState("443");
  const [protocol, setProtocol] = useState<PortCheckProtocol>("tcp");
  const [region, setRegion] = useState<PortCheckRegion>("ALL");
  const [timeout, setTimeoutValue] = useState(2_000);
  const [report, setReport] = useState<PortCheckReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const presets = protocol === "tcp" ? TCP_PRESETS : UDP_PRESETS;
  const successCount = report?.rows.filter((row) => row.status === 1).length ?? 0;
  const failedCount = report?.rows.filter((row) => row.status !== 1).length ?? 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const parsedPort = Number(portText);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
      setError("端口范围必须是 1–65535");
      return;
    }

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setError("");
    setReport(null);
    setLoading(true);

    try {
      const input: PortCheckInput = {
        target,
        port: parsedPort,
        protocol,
        region,
        timeout,
      };
      const nextReport = await runPortCheck(input, controller.signal);
      if (!controller.signal.aborted) setReport(nextReport);
    } catch (caught) {
      if (!controller.signal.aborted && !(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught.message : "检测失败，请稍后重试");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <InstancePanel
      id="instance-port-check"
      title="TCP / UDP 端口检测"
      kicker={
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck size={12} aria-hidden="true" />
          管理员工具
        </span>
      }
      titleAction={
        <span className="rounded-full border border-(--hairline) px-2.5 py-1 text-[10px] font-semibold text-(--text-tertiary)">
          手动检测
        </span>
      }
      description={
        <>
          {nodeName ? `当前详情：${nodeName}。 ` : ""}
          输入公网 IP 或域名，选择协议和端口后手动发起全球探测。
        </>
      }
      className="instance-port-check-panel"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(120px,0.6fr)]">
          <label className="flex min-w-0 flex-col gap-1.5 text-[11px] font-semibold text-(--text-secondary)">
            目标公网 IP / 域名
            <input
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              maxLength={253}
              placeholder="例如：203.0.113.10 或 server.example.com"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="min-h-10 w-full rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 text-[12px] font-normal text-(--text-primary) outline-none transition-colors placeholder:text-(--text-tertiary) focus:border-(--accent-500)"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-(--text-secondary)">
            端口
            <input
              inputMode="numeric"
              type="number"
              min={1}
              max={65_535}
              step={1}
              value={portText}
              onChange={(event) => setPortText(event.target.value)}
              className="min-h-10 w-full rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 font-mono text-[12px] font-semibold text-(--text-primary) outline-none transition-colors focus:border-(--accent-500)"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <fieldset className="flex min-w-0 flex-1 flex-col gap-1.5">
            <legend className="mb-1.5 text-[11px] font-semibold text-(--text-secondary)">协议</legend>
            <div className="inline-flex w-fit rounded-xl border border-(--hairline) bg-(--surface-elev) p-1">
              {(["tcp", "udp"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={protocol === item}
                  onClick={() => setProtocol(item)}
                  className={`min-h-8 min-w-20 rounded-lg px-4 text-[11px] font-bold uppercase transition-colors ${
                    protocol === item
                      ? "bg-(--bg-card) text-(--text-primary) shadow-sm"
                      : "text-(--text-tertiary) hover:text-(--text-primary)"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex min-w-32 flex-1 flex-col gap-1.5 text-[11px] font-semibold text-(--text-secondary)">
            探测地区
            <select
              value={region}
              onChange={(event) => setRegion(event.target.value as PortCheckRegion)}
              className="min-h-10 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 text-[11px] font-medium text-(--text-primary) outline-none focus:border-(--accent-500)"
            >
              {REGION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="flex min-w-28 flex-1 flex-col gap-1.5 text-[11px] font-semibold text-(--text-secondary)">
            超时
            <select
              value={timeout}
              onChange={(event) => setTimeoutValue(Number(event.target.value))}
              className="min-h-10 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 text-[11px] font-medium text-(--text-primary) outline-none focus:border-(--accent-500)"
            >
              <option value={1_000}>1 秒</option>
              <option value={2_000}>2 秒</option>
              <option value={3_000}>3 秒</option>
              <option value={5_000}>5 秒</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-(--text-tertiary)">常用端口</span>
          {presets.map((preset) => (
            <button
              key={preset.port}
              type="button"
              onClick={() => setPortText(String(preset.port))}
              className="rounded-full border border-(--hairline) px-2.5 py-1 text-[10px] font-medium text-(--text-secondary) transition-colors hover:border-(--accent-500) hover:text-(--text-primary)"
              aria-label={`选择 ${preset.label} 端口 ${preset.port}`}
            >
              {preset.label} · {preset.port}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--hairline) pt-3">
          <div className="flex max-w-xl items-start gap-2 text-[10px] leading-relaxed text-(--text-tertiary)">
            <Globe2 size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              由 Check-Host.cc 全球探测节点执行。只在点击按钮时提交一次检测，不会定时自动扫描。
              {protocol === "udp" ? " UDP 无响应不代表端口一定关闭。" : " TCP 未连通也可能由防火墙或线路过滤导致。"}
            </span>
          </div>
          <button
            type="submit"
            disabled={loading || !target.trim()}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-(--accent-500) px-4 text-[11px] font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {loading ? <LoaderCircle size={14} className="animate-spin" /> : <Network size={14} />}
            {loading ? "正在探测…" : "开始检测"}
          </button>
        </div>
      </form>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-(--status-offline)/25 bg-(--status-offline)/5 px-3 py-2.5 text-[11px] text-(--text-primary)">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-(--status-offline)" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-(--hairline) bg-(--surface-elev) px-3 py-3 text-[11px] text-(--text-secondary)" role="status" aria-live="polite">
          <LoaderCircle size={14} className="animate-spin" />
          正在等待全球探测节点返回结果…
        </div>
      )}

      {report && (
        <div className="mt-5 overflow-hidden rounded-xl border border-(--hairline)">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-(--surface-elev) px-3 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold text-(--text-primary)">
                <span className="uppercase">{report.protocol}</span>
                <span className="font-mono">{report.target}:{report.port}</span>
                {report.pending && (
                  <span className="rounded-full bg-(--surface) px-2 py-0.5 text-[10px] font-medium text-(--text-tertiary)">
                    节点仍在返回结果
                  </span>
                )}
              </div>
              <div className="mt-1 text-[10px] text-(--text-tertiary)">
                {report.rows.length} 个探测节点 · 单次检测
              </div>
            </div>
            <a
              href={report.reportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-(--accent-500) hover:underline"
            >
              查看完整报告 <ExternalLink size={12} />
            </a>
          </div>

          {report.rows.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-3 px-3 py-2.5 text-[10px]">
                <span className="inline-flex items-center gap-1.5 font-semibold text-(--status-online)">
                  <CheckCircle2 size={12} /> 成功 {successCount}
                </span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-(--text-tertiary)">
                  <AlertCircle size={12} /> 未成功 / 未确认 {failedCount}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] gap-3 bg-(--surface-elev) px-3 py-2 text-[10px] font-semibold text-(--text-tertiary) sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <span>探测节点 / 运营商</span>
                <span className="hidden sm:block">目标 IP</span>
                <span className="hidden sm:block">响应时间</span>
                <span>状态</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {report.rows.map((row) => (
                  <ResultRow key={row.id} protocol={report.protocol} row={row} />
                ))}
              </div>
            </>
          ) : (
            <div className="px-3 py-5 text-center text-[11px] text-(--text-tertiary)">
              <Clock3 size={18} className="mx-auto mb-2" />
              暂未收到节点结果。可以打开完整报告查看后续状态，或稍后手动重新检测。
            </div>
          )}
        </div>
      )}
    </InstancePanel>
  );
}
