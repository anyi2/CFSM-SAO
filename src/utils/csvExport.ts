import type { LoadRecord, PingRecord, PingTask } from "@/types/cfsm";

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function csvRow(values: unknown[]): string {
  return values.map(escapeCsvCell).join(",");
}

function isoTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function buildLoadRecordsCsv(records: LoadRecord[]): string {
  const header = [
    "时间(UTC)", "节点标识", "CPU(%)", "GPU(%)", "内存使用(bytes)", "内存总量(bytes)",
    "Swap使用(bytes)", "Swap总量(bytes)", "磁盘使用(bytes)", "磁盘总量(bytes)",
    "磁盘读取(bytes/s)", "磁盘写入(bytes/s)", "读取IOPS", "写入IOPS",
    "磁盘await(ms)", "磁盘忙碌率(%)", "网络下行(bytes/s)", "网络上行(bytes/s)",
    "TCP连接数", "UDP连接数", "进程数",
  ];
  const rows = records.map((record) => csvRow([
    isoTime(record.time), record.client, record.cpu, record.gpu, record.ram, record.ram_total,
    record.swap, record.swap_total, record.disk, record.disk_total,
    record.disk_read, record.disk_write, record.disk_read_iops, record.disk_write_iops,
    record.disk_await_ms, record.disk_util, record.net_in, record.net_out,
    record.connections, record.connections_udp, record.process,
  ]));
  return "\uFEFF" + [csvRow(header), ...rows].join("\r\n") + "\r\n";
}

export function buildPingRecordsCsv(records: PingRecord[], tasks: PingTask[]): string {
  const names = new Map(tasks.map((task) => [task.id, task.name || "线路 #" + task.id]));
  const header = ["时间(UTC)", "节点标识", "线路", "线路ID", "延迟(ms)", "状态", "丢包率(%)"];
  const rows = records.map((record) => csvRow([
    isoTime(record.time),
    record.client,
    names.get(record.task_id) ?? "线路 #" + record.task_id,
    record.task_id,
    record.value >= 0 ? record.value : "",
    record.value >= 0 ? "有效" : "超时",
    record.loss,
  ]));
  return "\uFEFF" + [csvRow(header), ...rows].join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
