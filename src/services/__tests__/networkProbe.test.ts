import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGlobalpingMeasurementRequest,
  findServerIpv4,
  getCarrierProbeCoverage,
  isPublicIpv4,
  parseGlobalpingMeasurement,
} from "@/services/networkProbe";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isPublicIpv4", () => {
  it("accepts ordinary public IPv4 addresses", () => {
    expect(isPublicIpv4("1.1.1.1")).toBe(true);
    expect(isPublicIpv4("8.8.8.8")).toBe(true);
  });

  it.each([
    "1", "0", "0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.1.1",
    "172.16.0.1", "192.168.1.1", "192.0.2.1", "198.18.0.1",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
    "100.64.0.1", "01.1.1.1", "256.1.1.1", "not-an-ip",
  ])("rejects non-public or malformed address %s", (ip) => {
    expect(isPublicIpv4(ip)).toBe(false);
  });
});

describe("findServerIpv4", () => {
  const selectedUuid = "node-selected";
  const otherUuid = "node-other";

  it("reads the public IP from the selected server record", () => {
    expect(findServerIpv4({
      servers: [
        { uuid: otherUuid, ip_v4: "8.8.8.8" },
        { uuid: selectedUuid, ip_v4: "1.1.1.1" },
      ],
    }, selectedUuid)).toBe("1.1.1.1");
  });

  it("reads a nested latest report without mistaking a reachability flag for an IP", () => {
    expect(findServerIpv4({
      servers: [{
        uuid: selectedUuid,
        ip_v4: "1",
        latest_report: { metrics: { ip_v4: "203.0.113.8" } },
      }],
    }, selectedUuid)).toBeNull();
  });

  it("finds a real public IP in a nested report for the selected server", () => {
    expect(findServerIpv4({
      servers: [{
        uuid: selectedUuid,
        ip_v4: "1",
        latest_report: { metrics: { ip_v4: "45.67.89.10" } },
      }],
    }, selectedUuid)).toBe("45.67.89.10");
  });

  it("does not fall back to another server when the selected server has no IP", () => {
    expect(findServerIpv4({
      servers: [
        { uuid: otherUuid, ip_v4: "8.8.8.8" },
        { uuid: selectedUuid, ip_v4: "1" },
      ],
    }, selectedUuid)).toBeNull();
  });

  it("returns null when the selected server is absent", () => {
    expect(findServerIpv4({ servers: [{ uuid: otherUuid, ip_v4: "8.8.8.8" }] }, selectedUuid)).toBeNull();
  });
});

describe("Globalping probe coverage", () => {
  const probes = [
    { location: { country: "CN", asn: 4134, city: "Guangzhou", network: "China Telecom" }, tags: ["eyeball-network"] },
    { location: { country: "CN", asn: 4134, city: "Beijing", network: "China Telecom DC" }, tags: ["datacenter-network"] },
    { location: { country: "CN", asn: 4837, city: "Wuhan", network: "China Unicom" }, tags: ["datacenter-network"] },
    { location: { country: "CN", asn: 9808, city: "Nanning", network: "China Mobile" }, tags: ["eyeball-network"] },
    { location: { country: "JP", asn: 2516, city: "Tokyo", network: "KDDI" }, tags: ["datacenter-network"] },
    { location: { country: "SG", asn: 45102, city: "Singapore", network: "Alibaba" }, tags: ["datacenter-network"] },
    { location: { country: "CN", asn: 9999, city: "Shenzhen", network: "Other" }, tags: ["datacenter-network"] },
  ];

  it("counts exact carrier ASN coverage and probe types", () => {
    expect(getCarrierProbeCoverage(probes)).toEqual([
      { id: "telecom", name: "中国电信", asn: 4134, total: 2, eyeball: 1, datacenter: 1 },
      { id: "unicom", name: "中国联通", asn: 4837, total: 1, eyeball: 0, datacenter: 1 },
      { id: "mobile", name: "中国移动", asn: 9808, total: 1, eyeball: 1, datacenter: 0 },
    ]);
  });

  it("prioritizes eyeball probes and falls back to datacenter probes per carrier", () => {
    const request = buildGlobalpingMeasurementRequest("45.67.89.10", 443, probes);
    expect(request.type).toBe("ping");
    expect(request.measurementOptions).toEqual({ protocol: "TCP", port: 443, packets: 3 });
    expect(request.locations).toEqual([
      { country: "CN", asn: 4134, tags: ["eyeball-network"], limit: 1 },
      { country: "CN", asn: 4837, limit: 1 },
      { country: "CN", asn: 9808, tags: ["eyeball-network"], limit: 1 },
      { country: "JP", tags: ["datacenter-network"], limit: 1 },
      { country: "SG", tags: ["datacenter-network"], limit: 1 },
    ]);
  });

  it("does not start a measurement when no target carrier probes are online", () => {
    expect(() => buildGlobalpingMeasurementRequest("45.67.89.10", 443, [
      { location: { country: "JP", asn: 2516 }, tags: ["datacenter-network"] },
    ])).toThrow(/没有中国电信、联通或移动 ASN/);
  });

  it("rejects unsafe targets and invalid ports", () => {
    expect(() => buildGlobalpingMeasurementRequest("192.168.1.1", 443, probes)).toThrow(/公网 IPv4/);
    expect(() => buildGlobalpingMeasurementRequest("45.67.89.10", 0, probes)).toThrow(/端口/);
  });
});

describe("parseGlobalpingMeasurement", () => {
  it("maps carrier, probe type, TCP response timing and closed-port details", () => {
    const rows = parseGlobalpingMeasurement({
      results: [
        {
          probe: {
            country: "CN", city: "Guangzhou", asn: 4134, network: "China Telecom",
            tags: ["eyeball-network"],
          },
          result: {
            status: "finished",
            rawOutput: "TCP ping: success",
            timings: [{ rtt: 28.4 }],
            stats: { avg: 28.4 },
          },
        },
        {
          probe: {
            country: "CN", city: "Wuhan", asn: 4837, network: "China Unicom",
            tags: ["datacenter-network"],
          },
          result: {
            status: "finished",
            rawOutput: "Connection refused",
            timings: [],
            stats: { avg: null },
          },
        },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      carrier: "中国电信", status: "success", latencyMs: 28.4, probeType: "家庭/企业宽带",
    });
    expect(rows[1]).toMatchObject({
      carrier: "中国联通", status: "rejected", probeType: "数据中心",
    });
  });

  it("keeps in-progress results distinct from failures", () => {
    const rows = parseGlobalpingMeasurement({
      results: [{
        probe: { country: "CN", city: "Shanghai", asn: 9808, tags: [] },
        result: { status: "in-progress", rawOutput: "" },
      }],
    });
    expect(rows[0]?.status).toBe("pending");
  });
});
