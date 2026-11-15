import { describe, expect, it } from "vitest";
import { buildLoadRecordsCsv, buildPingRecordsCsv } from "@/utils/csvExport";
import type { LoadRecord, PingRecord, PingTask } from "@/types/cfsm";

const sampleLoad: LoadRecord = {
  cpu: 0, gpu: 0, ram: 0, ram_total: 0, swap: 0, swap_total: 0,
  load: 0, temp: 0, disk: 0, disk_total: 0,
  disk_read: null, disk_write: null, disk_read_iops: null, disk_write_iops: null,
  disk_await_ms: null, disk_util: null, net_in: 0, net_out: 0,
  net_total_up: 0, net_total_down: 0, process: 0, connections: 0,
  connections_udp: 0, time: 1_800_000_000_000, client: "node",
};

describe("CSV export", () => {
  it("keeps absent disk IO counters empty rather than fabricating zeros", () => {
    const lines = buildLoadRecordsCsv([sampleLoad]).split("\r\n");
    const cells = lines[1]?.split(",") ?? [];
    expect(cells.slice(12, 16)).toEqual(["", "", "", ""]);
  });

  it("protects spreadsheet cells that begin with formula characters", () => {
    const csv = buildLoadRecordsCsv([{ ...sampleLoad, client: '=HYPERLINK("https://evil.test","open")' }]);
    expect(csv).toContain("'=HYPERLINK(""https://evil.test"",""open"")");
  });

  it("exports a timed-out ping as timeout with an empty latency cell", () => {
    const sample: PingRecord = {
      task_id: 1, time: 1_800_000_000_000, value: -1, client: "node", loss: 100,
    };
    const task = { id: 1, name: "电信" } as PingTask;
    const csv = buildPingRecordsCsv([sample], [task]);
    expect(csv).toContain("超时");
    expect(csv).toContain("100");
    expect(csv).not.toContain(",-1,");
  });

  it("quotes commas and escapes double quotes", () => {
    const csv = buildLoadRecordsCsv([{ ...sampleLoad, client: 'node,"one"' }]);
    expect(csv).toContain('"node,""one"""');
  });
});
