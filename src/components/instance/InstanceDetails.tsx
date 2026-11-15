import { useEffect, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock3,
  Cpu,
  HardDrive,
  Layers,
  MemoryStick,
} from "lucide-react";
import { useNodeMeta, useNodeMetrics } from "@/hooks/useNode";
import { InstanceSwitcher } from "./InstanceSwitcher";
import { formatBytes, formatUptimeDays } from "@/utils/format";
import { resolveTrafficUsage, trafficTypeLabel } from "@/utils/traffic";
import { InstancePanel } from "./InstancePanel";
import "@/styles/instance-details-refined.css";

// Intl.DateTimeFormat 构造开销大，复用一个实例，避免每次 metrics 更新都重建。
const TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function MetricCard({
  title,
  icon,
  percent,
  detail,
  tone,
}: {
  title: string;
  icon: ReactNode;
  percent: number | null;
  detail: string;
  tone: "cpu" | "memory" | "swap" | "disk";
}) {
  const safePercent =
    percent != null && Number.isFinite(percent) ? clampPercent(percent) : null;

  return (
    <div className={\`instance-metric-card is-\${tone}\`}>
      <div className="instance-metric-head">
        <span>{title}</span>
        <span className="instance-metric-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="instance-metric-value">
        {safePercent == null ? "—" : \`\${safePercent.toFixed(1)}%\`}
      </div>
      <div className="instance-metric-detail">{detail}</div>
      {safePercent != null && (
        <div
          className="instance-metric-track"
          role="progressbar"
          aria-label={\`\${title}使用率\`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={safePercent}
        >
          <span
            className="instance-metric-fill"
            style={{ width: \`\${safePercent}%\` }}
          />
        </div>
      )}
    </div>
  );
}

function NetworkSpeedCard({
  direction,
  value,
}: {
  direction: "up" | "down";
  value: string;
}) {
  const isUp = direction === "up";

  return (
    <div className="instance-network-speed">
      <div className={\`instance-network-speed-head is-\${direction}\`}>
        {isUp ? (
          <ArrowUpFromLine size={14} aria-hidden="true" />
        ) : (
          <ArrowDownToLine size={14} aria-hidden="true" />
        )}
        <span>{isUp ? "上行速度" : "下行速度"}</span>
      </div>
      <div className="instance-network-speed-value">{value}</div>
    </div>
  );
}

export function InstanceDetails({
  uuid,
  onNodeReady,
}: {
  uuid: string;
  onNodeReady?: () => (() => void) | void;
}) {
  const meta = useNodeMeta(uuid);
  const metrics = useNodeMetrics(uuid);
  const isReady = Boolean(meta && metrics);

  useEffect(() => {
    if (!isReady) return;
    return onNodeReady?.();
  }, [isReady, onNodeReady, uuid]);

  if (!meta || !metrics) return null;

  const isOnline = metrics.online === true;
  const uptime = formatUptimeDays(metrics.uptime);
  const trafficUsage = resolveTrafficUsage(
    meta.traffic_limit_type,
    metrics.trafficUpMonthly,
    metrics.trafficDownMonthly,
    meta.traffic_limit,
  );
  const lastUpdated =
    metrics.updatedAt > 0 ? TIME_FORMATTER.format(metrics.updatedAt) : "—";
  const trimmedName = meta.name?.trim();
  const panelTitle = trimmedName ? \`\${trimmedName} 信息\` : "实例信息";

  const ramPercent = metrics.ramTotal > 0 ? metrics.ramPct : null;
  const swapPercent =
    metrics.swapTotal > 0
      ? (metrics.swapUsed / metrics.swapTotal) * 100
      : null;
  const diskPercent = metrics.diskTotal > 0 ? metrics.diskPct : null;

  return (
    <InstancePanel
      title={panelTitle}
      titleAction={<InstanceSwitcher currentUuid={uuid} />}
      description={
        isOnline ? undefined : "节点当前离线，以下展示最近一次上报的缓存数据。"
      }
    >
      <div className="instance-info-groups instance-info-groups--refined">
        <section className="instance-info-group" aria-label="系统信息">
          <div className="instance-info-group-title">系统</div>
          <InfoRow
            label="状态"
            value={
              <span
                className={\`instance-status-pill\${isOnline ? "" : " is-offline"}\`}
              >
                <span className="instance-status-dot" aria-hidden="true" />
                {isOnline ? "在线" : "离线"}
              </span>
            }
          />
          <InfoRow
            label="CPU 型号"
            value={\`\${meta.cpu_name || "—"}\${meta.cpu_cores > 0 ? \` (x\${meta.cpu_cores})\` : ""}\`}
          />
          <InfoRow label="架构" value={meta.arch || "—"} />
          <InfoRow label="显卡" value={meta.gpu_name || "—"} />
          <InfoRow label="操作系统" value={meta.os || "—"} />
          <InfoRow label="内核版本" value={meta.kernel_version || "—"} />
        </section>

        <section className="instance-info-group" aria-label="资源使用情况">
          <div className="instance-info-group-title">资源使用</div>
          <div className="instance-resource-grid">
            <MetricCard
              title="CPU"
              icon={<Cpu size={15} />}
              percent={Number.isFinite(metrics.cpuPct) ? metrics.cpuPct : null}
              detail="处理器使用率"
              tone="cpu"
            />
            <MetricCard
              title="内存"
              icon={<MemoryStick size={15} />}
              percent={ramPercent}
              detail={
                metrics.ramTotal > 0
                  ? \`\${formatBytes(metrics.ramUsed)} / \${formatBytes(metrics.ramTotal)}\`
                  : "容量数据暂不可用"
              }
              tone="memory"
            />
            <MetricCard
              title="Swap"
              icon={<Layers size={15} />}
              percent={swapPercent}
              detail={
                metrics.swapTotal > 0
                  ? \`\${formatBytes(metrics.swapUsed)} / \${formatBytes(metrics.swapTotal)}\`
                  : "未配置 Swap"
              }
              tone="swap"
            />
            <MetricCard
              title="磁盘"
              icon={<HardDrive size={15} />}
              percent={diskPercent}
              detail={
                metrics.diskTotal > 0
                  ? \`\${formatBytes(metrics.diskUsed)} / \${formatBytes(metrics.diskTotal)}\`
                  : "容量数据暂不可用"
              }
              tone="disk"
            />
          </div>
          <InfoRow
            label="系统负载"
            value={\`\${metrics.load1.toFixed(2)} · \${metrics.load5.toFixed(2)} · \${metrics.load15.toFixed(2)}\`}
          />
          <InfoRow
            label="运行时长"
            value={uptime.unit ? \`\${uptime.value} \${uptime.unit}\` : uptime.value}
          />
        </section>

        <section className="instance-info-group" aria-label="网络与流量">
          <div className="instance-info-group-title">
            网络{isOnline ? " · 实时" : " · 缓存"}
          </div>
          <div className="instance-network-speeds">
            <NetworkSpeedCard
              direction="up"
              value={\`\${formatBytes(metrics.netUp)}/s\`}
            />
            <NetworkSpeedCard
              direction="down"
              value={\`\${formatBytes(metrics.netDown)}/s\`}
            />
          </div>
          <InfoRow
            label={isOnline ? "最近更新" : "最后上报"}
            value={
              <span className="instance-info-inline-value">
                <Clock3 size={12} aria-hidden="true" />
                {lastUpdated}
              </span>
            }
          />
          <div className="instance-traffic-block">
            <div className="instance-traffic-heading">
              <span>周期流量</span>
              <span className="instance-traffic-type">
                {trafficTypeLabel(meta.traffic_limit_type)}
              </span>
            </div>
            <div className="instance-traffic-directions">
              <div className="instance-traffic-direction">
                <span className="instance-traffic-direction-label">上行累计</span>
                <strong className="instance-traffic-direction-value">
                  {formatBytes(metrics.trafficUpMonthly)}
                </strong>
              </div>
              <div className="instance-traffic-direction">
                <span className="instance-traffic-direction-label">下行累计</span>
                <strong className="instance-traffic-direction-value">
                  {formatBytes(metrics.trafficDownMonthly)}
                </strong>
              </div>
            </div>
            <div className="instance-traffic-quota">
              {meta.traffic_limit > 0 ? (
                <>
                  <div
                    className="instance-progress-track"
                    role="progressbar"
                    aria-label="周期流量配额使用率"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={trafficUsage.fraction * 100}
                  >
                    <span
                      className="instance-progress-fill"
                      style={{ width: \`\${trafficUsage.fraction * 100}%\` }}
                    />
                  </div>
                  <div className="instance-traffic-quota-meta">
                    <strong>
                      {formatBytes(trafficUsage.used)} /{" "}
                      {formatBytes(meta.traffic_limit)}
                    </strong>
                    <span>剩余 {formatBytes(trafficUsage.remaining)}</span>
                  </div>
                </>
              ) : (
                <div className="instance-traffic-quota-meta">
                  <strong>不限流量</strong>
                  <span>未设置周期配额</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </InstancePanel>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="instance-info-item">
      <span className="instance-info-label">{label}</span>
      <div className="instance-info-value">{value}</div>
    </div>
  );
}
