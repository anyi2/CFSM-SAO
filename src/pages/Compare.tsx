import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, X } from "lucide-react";
import { useVisibleNodes } from "@/hooks/useVisibleNodes";
import { useNodeMetrics } from "@/hooks/useNode";
import { formatBytes } from "@/utils/format";
import type { NodeInfo } from "@/types/cfsm";

function numberText(value: number | null | undefined, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) + suffix : "—";
}
function byteText(value: number | null | undefined, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? formatBytes(value) + suffix : "—";
}
function pingText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) + " ms" : "—";
}
function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-(--hairline) py-2 last:border-0">
      <span className="text-[12px] text-(--text-tertiary)">{label}</span>
      <strong className="text-right text-[12px] font-medium tabular-nums text-(--text-primary)">{value}</strong>
    </div>
  );
}
function CompareCard({ node, onRemove }: { node: NodeInfo; onRemove: () => void }) {
  const metrics = useNodeMetrics(node.uuid);
  const hasSample = Boolean(metrics && metrics.updatedAt > 0);
  const online = metrics?.online;
  const onlineLabel = online === true ? "在线" : online === false ? "离线" : "状态未知";
  const onlineColor = online === true ? "text-emerald-500" : online === false ? "text-red-500" : "text-(--text-tertiary)";
  return (
    <article className="min-w-0 rounded-2xl border border-(--hairline) bg-(--bg-card) p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold text-(--text-primary)" title={node.name}>{node.name || "未命名节点"}</h2>
          <p className="mt-1 truncate text-[11px] text-(--text-tertiary)">{node.region || node.group || node.uuid}</p>
        </div>
        <button type="button" onClick={onRemove} className="shrink-0 rounded-lg p-1.5 text-(--text-tertiary) hover:bg-(--hover-bg)" aria-label={"移除" + (node.name || node.uuid)} title="移除对比"><X size={15} /></button>
      </div>
      <div className={"mb-3 flex items-center gap-2 text-[12px] font-semibold " + onlineColor}>
        <span className="size-2 rounded-full bg-current" aria-hidden="true" />
        {onlineLabel}
        {metrics?.updatedAt ? <span className="ml-auto text-[10px] font-normal text-(--text-tertiary)">{new Date(metrics.updatedAt).toLocaleString()}</span> : null}
      </div>
      <MetricLine label="CPU" value={hasSample ? numberText(metrics?.cpuPct, "%") : "—"} />
      <MetricLine label="内存" value={hasSample ? byteText(metrics?.ramUsed) + " / " + byteText(metrics?.ramTotal) : "—"} />
      <MetricLine label="Swap" value={hasSample ? byteText(metrics?.swapUsed) + " / " + byteText(metrics?.swapTotal) : "—"} />
      <MetricLine label="磁盘" value={hasSample ? byteText(metrics?.diskUsed) + " / " + byteText(metrics?.diskTotal) : "—"} />
      <MetricLine label="上行" value={hasSample ? byteText(metrics?.netUp, "/s") : "—"} />
      <MetricLine label="下行" value={hasSample ? byteText(metrics?.netDown, "/s") : "—"} />
      <MetricLine label="系统负载" value={hasSample && metrics?.loadAvailable ? [metrics.load1, metrics.load5, metrics.load15].map((v) => v.toFixed(2)).join(" / ") : "—"} />
      <MetricLine label="TCP / UDP" value={hasSample ? String(metrics?.connectionsTcp) + " / " + String(metrics?.connectionsUdp) : "—"} />
      <MetricLine label="电信 Ping / 丢包" value={hasSample ? pingText(metrics?.ping.ct) + " / " + numberText(metrics?.ping.lossCt, "%") : "—"} />
    </article>
  );
}

export function Compare() {
  const nodes = useVisibleNodes();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const selectedNodes = useMemo(
    () => selected.map((uuid) => nodes.find((node) => node.uuid === uuid)).filter((node): node is NodeInfo => Boolean(node)),
    [nodes, selected],
  );
  const filteredNodes = useMemo(() => {
    const term = query.trim().toLowerCase();
    return nodes.filter((node) => !term || [node.name, node.region, node.group, node.uuid].some((value) => value.toLowerCase().includes(term))).slice(0, 250);
  }, [nodes, query]);
  const toggleNode = (uuid: string) => {
    setSelected((previous) => {
      if (previous.includes(uuid)) return previous.filter((item) => item !== uuid);
      return previous.length >= 5 ? previous : [...previous, uuid];
    });
  };
  return (
    <div className="flex flex-col gap-5 py-2">
      <Link to="/" className="instance-page-back"><ArrowLeft size={14} />返回首页</Link>
      <header className="flex flex-col gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-(--text-tertiary)">实时快照比较</p>
          <h1 className="mt-1 text-[22px] font-semibold text-(--text-primary)">多节点性能对比</h1>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-(--text-secondary)">最多选择 5 台可见服务器，比较同一时刻的资源使用、网络吞吐和电信线路质量。未上报的数据保持为空，不会补成 0。</p>
        </div>
      </header>
      <section className="rounded-2xl border border-(--hairline) bg-(--bg-card) p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
            <span className="text-[11px] text-(--text-tertiary)">搜索节点</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入主机名、地区或分组" className="w-full rounded-lg border border-(--hairline) bg-(--bg-surface) px-3 py-2 text-[13px] text-(--text-primary)" />
          </label>
          <div className="text-[12px] text-(--text-secondary)">已选择 {selected.length} / 5 台</div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filteredNodes.map((node) => {
            const checked = selected.includes(node.uuid);
            const disabled = !checked && selected.length >= 5;
            return (
              <label key={node.uuid} className={"flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-[12px] " + (checked ? "border-(--accent) bg-(--accent)/10" : "border-(--hairline)") + (disabled ? " opacity-50" : " cursor-pointer")}>
                <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleNode(node.uuid)} />
                <span className="min-w-0 flex-1 truncate text-(--text-primary)">{node.name || node.uuid}</span>
                <span className="shrink-0 text-[10px] text-(--text-tertiary)">{node.region || node.group}</span>
                {checked && <Check size={13} className="shrink-0 text-(--accent)" />}
              </label>
            );
          })}
        </div>
        {nodes.length > filteredNodes.length && <p className="mt-2 text-[10px] text-(--text-tertiary)">只列出前 250 个匹配节点，请通过搜索缩小范围。</p>}
      </section>
      {selectedNodes.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {selectedNodes.map((node) => <CompareCard key={node.uuid} node={node} onRemove={() => toggleNode(node.uuid)} />)}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-(--hairline) px-4 py-12 text-center text-[13px] text-(--text-tertiary)">选择上方服务器，即可并排查看实时指标。</div>
      )}
    </div>
  );
}
