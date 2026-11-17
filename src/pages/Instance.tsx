import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft, Download } from "lucide-react";
import "uplot/dist/uPlot.min.css";
import { InstanceDetails } from "@/components/instance/InstanceDetails";
import { PortCheckPanel } from "@/components/instance/PortCheckPanel";
import { PingChart } from "@/components/instance/PingChart";
import { LoadChart } from "@/components/instance/LoadChart";
import { Spinner } from "@/components/ui/Spinner";
import {
  buildLoadTimeRangeOptions,
  buildPingTimeRangeOptions,
} from "@/components/instance/chartShared";
import { useAuth } from "@/hooks/useAuth";
import {
  useAllNodeMeta,
  useNodeMeta,
  useNodeStoreStatus,
  useRealtimeFocus,
} from "@/hooks/useNode";
import { findNodesBySlug } from "@/utils/nodeSlug";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { ANONYMOUS_MAX_HISTORY_HOURS } from "@/services/api";
import { useLoadRecords, usePingRecords } from "@/hooks/useRecords";
import { useCarrierNames } from "@/hooks/usePublicConfig";
import { carrierTaskName } from "@/services/cfsm/mappers";
import { buildLoadRecordsCsv, buildPingRecordsCsv, downloadCsv } from "@/utils/csvExport";

// 0.167（10 分钟）：官方规范铁律要求详情页默认 10 分钟历史曲线，大幅降低 D1 行读取。
const DEFAULT_PING_HOURS = 0.167;
const DEFAULT_LOAD_HOURS = 0.167;
/** `/api/history/all` 的 hours 上限。 */
const MAX_HISTORY_HOURS = 168;
type TimeRangeOption = ReturnType<typeof buildLoadTimeRangeOptions>[number];

function RangeSelector({
  ranges,
  value,
  onChange,
}: {
  ranges: TimeRangeOption[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="instance-segmented is-scrollable">
      {ranges.map((range) => (
        <button
          key={range.value}
          type="button"
          data-active={value === range.value ? "true" : "false"}
          aria-pressed={value === range.value}
          onClick={() => onChange(range.value)}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

export function Instance() {
  const { uuid, slug } = useParams<{ uuid: string; slug: string }>();
  const allNodes = useAllNodeMeta();
  const slugMatches = slug ? findNodesBySlug(allNodes, slug) : [];
  const isAmbiguousSlug = slugMatches.length > 1;
  const resolvedUuid = slug
    ? slugMatches.length === 1
      ? slugMatches[0].uuid
      : undefined
    : uuid;
  const auth = useAuth();
  const { data: me } = auth;

  // Do not trust a JWT-derived initial snapshot for access to admin-only tools.
  // Revalidate the actual CFSM session before rendering the port-check module.
  useEffect(() => {
    if (!auth.isFetched) void auth.refetch();
  }, [auth.isFetched, auth.refetch]);
  const themeSettings = useThemeSettings();
  const carrierNames = useCarrierNames();
  const meta = useNodeMeta(resolvedUuid ?? "");
  const storeStatus = useNodeStoreStatus(Boolean(uuid || slug));
  // 详情页和实时数据始终使用后端原始 UUID；URL 中的主机名只负责定位节点。
  useRealtimeFocus(resolvedUuid);
  const [loadHours, setLoadHours] = useState(DEFAULT_LOAD_HOURS);
  const [pingHours, setPingHours] = useState(DEFAULT_PING_HOURS);
  const chartControlsRef = useRef<HTMLDivElement | null>(null);

  // 后端最长支持 7 天；未登录访客查询超过 24 小时会被拒绝，所以直接不显示更长的档位。
  const maxHistoryHours = me?.logged_in
    ? MAX_HISTORY_HOURS
    : ANONYMOUS_MAX_HISTORY_HOURS;

  const loadRanges = useMemo(
    () => buildLoadTimeRangeOptions(maxHistoryHours),
    [maxHistoryHours],
  );
  const pingRanges = useMemo(
    () => buildPingTimeRangeOptions(maxHistoryHours),
    [maxHistoryHours],
  );
  const showPingChart = themeSettings.isReady && themeSettings.showPingChart;
  const visibleDetailModuleOrder = themeSettings.instanceDetailModuleOrder.filter(
    (id) =>
      !themeSettings.instanceDetailModuleHidden.includes(id) &&
      (id !== "pingChart" || showPingChart),
  );
  // The charts and export buttons share the same React Query keys, avoiding duplicate history requests.
  const loadRecordsQuery = useLoadRecords(
    resolvedUuid ?? "",
    loadHours,
    Boolean(resolvedUuid) && visibleDetailModuleOrder.includes("loadChart"),
  );
  const pingRecordsQuery = usePingRecords(
    resolvedUuid ?? "",
    pingHours,
    Boolean(resolvedUuid) && visibleDetailModuleOrder.includes("pingChart") && showPingChart,
  );
  const exportBaseName = (meta?.name?.trim() || resolvedUuid || "node")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "node";

  const alignCharts = useCallback(() => {
    const frame = window.requestAnimationFrame(() => {
      const element = chartControlsRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight) return;
      element.scrollIntoView({ behavior: "auto", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!loadRanges.some((range) => range.value === loadHours)) {
      setLoadHours(
        loadRanges.find((range) => range.value === DEFAULT_LOAD_HOURS)?.value ??
          loadRanges[0]?.value ??
          DEFAULT_LOAD_HOURS,
      );
    }
  }, [loadHours, loadRanges]);

  useEffect(() => {
    if (!pingRanges.some((range) => range.value === pingHours)) {
      setPingHours(
        pingRanges.find((range) => range.value === DEFAULT_PING_HOURS)?.value ??
          pingRanges[0]?.value ??
          DEFAULT_PING_HOURS,
      );
    }
  }, [pingHours, pingRanges]);

  if (!uuid && !slug) return null;

  if (isAmbiguousSlug) {
    return (
      <div className="flex flex-col gap-5 py-2">
        <Link to="/" className="instance-page-back">
          <ChevronLeft size={14} />
          返回
        </Link>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <div className="text-[15px] font-semibold text-(--text-primary)">
            主机名重复，无法唯一定位实例
          </div>
          <p className="max-w-xl text-[13px] leading-relaxed text-(--text-secondary)">
            多台服务器使用了相同主机名。为避免打开错误的机器，请从下方选择目标服务器；后续建议为它们设置不同的主机名。
          </p>
          <div className="flex w-full max-w-xl flex-col gap-2">
            {slugMatches.map((node) => (
              <Link
                key={node.uuid}
                to={`/server/${encodeURIComponent(node.uuid)}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-(--hairline) bg-(--bg-card) px-4 py-3 text-left transition-colors hover:border-(--accent-500)"
              >
                <span className="min-w-0 truncate text-[13px] font-medium text-(--text-primary)">
                  {node.name || "未命名节点"}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-(--text-tertiary)">
                  UUID {node.uuid.slice(0, 8)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!resolvedUuid || !meta) {
    const message = storeStatus.hydrated
      ? "找不到这个实例，它可能已被删除或链接无效。"
      : storeStatus.nodeInfoError
        ? "节点列表加载失败，系统正在自动重试。"
        : null;
    return (
      <div className="flex flex-col gap-5 py-2">
        <Link to="/" className="instance-page-back">
          <ChevronLeft size={14} />
          返回
        </Link>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          {message ? (
            <>
              <div className="text-[15px] font-semibold text-(--text-primary)">
                {storeStatus.hydrated ? "实例不存在" : "暂时无法加载实例"}
              </div>
              <p className="text-[13px] text-(--text-secondary)">{message}</p>
            </>
          ) : (
            <Spinner size={24} label="正在加载实例" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 py-2">
      <Link
        to="/"
        className="instance-page-back"
      >
        <ChevronLeft size={14} />
        返回
      </Link>
      <InstanceDetails
        uuid={resolvedUuid}
        moduleOrder={visibleDetailModuleOrder}
        resourceOrder={themeSettings.instanceResourceCardOrder}
        chartControlsRef={chartControlsRef}
        onNodeReady={alignCharts}
        portCheck={auth.isFetched && auth.isSuccess && me?.logged_in ? <PortCheckPanel nodeName={meta.name} /> : null}
        loadChart={
          visibleDetailModuleOrder.includes("loadChart") ? (
          <>
            <div className="instance-chart-controls flex flex-wrap items-center justify-between gap-2">
              <RangeSelector
                ranges={loadRanges}
                value={loadHours}
                onChange={setLoadHours}
              />
              <button
                type="button"
                disabled={!loadRecordsQuery.data?.records.length}
                onClick={() => {
                  const records = loadRecordsQuery.data?.records;
                  if (records?.length) {
                    downloadCsv("cfsm-load-" + exportBaseName + "-" + loadHours + "h.csv", buildLoadRecordsCsv(records));
                  }
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-(--hairline) px-3 py-2 text-[11px] font-medium text-(--text-secondary) disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download size={13} />
                导出 CSV
              </button>
            </div>
            <LoadChart uuid={resolvedUuid} hours={loadHours} active />
          </>
          ) : null
        }
        pingChart={
          visibleDetailModuleOrder.includes("pingChart") && showPingChart ? (
            <>
              <div className="instance-chart-controls flex flex-wrap items-center justify-between gap-2">
                <RangeSelector
                  ranges={pingRanges}
                  value={pingHours}
                  onChange={setPingHours}
                />
                <button
                  type="button"
                  disabled={!pingRecordsQuery.data?.records.length}
                  onClick={() => {
                    const data = pingRecordsQuery.data;
                    if (data?.records.length) {
                      downloadCsv("cfsm-ping-" + exportBaseName + "-" + pingHours + "h.csv", buildPingRecordsCsv(data.records, data.tasks.map((task) => ({
                        ...task,
                        name: carrierTaskName(task.id, carrierNames),
                      }))));
                    }
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-(--hairline) px-3 py-2 text-[11px] font-medium text-(--text-secondary) disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Download size={13} />
                  导出 CSV
                </button>
              </div>
              <PingChart uuid={resolvedUuid} hours={pingHours} active />
            </>
          ) : null
        }
      />
    </div>
  );
}
