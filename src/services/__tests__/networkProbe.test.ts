import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGlobalpingMeasurementRequest,
  createGlobalpingMeasurement,
  findServerIpv4,
  parseGlobalpingRateLimit,
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

describe("Globalping probe coverage and location selection", () => {
  const probes = [
    { location: { country: "CN", asn: 4134, city: "Guangzhou", network: "China Telecom" }, tags: ["eyeball-network"] },
    { location: { country: "CN", asn: 4134, city: "Beijing", network: "China Telecom DC" }, tags: ["datacenter-network"] },
    { location: { country: "CN", asn: 4837, city: "Wuhan", network: "China Unicom" }, tags: ["datacenter-network"] },
    { location: { country: "CN", asn: 9808, city: "Nanning", network: "China Mobile" }, tags: ["eyeball-network"] },
    { location: { country: "JP", asn: 2516, city: "Tokyo", network: "KDDI" }, tags: ["datacenter-network"] },
    { location: { country: "HK", asn: 45102, city: "Hong Kong", network: "Alibaba" }, tags: ["datacenter-network"] },
    { location: { country: "US", asn: 13335, city: "Los Angeles", network: "Cloudflare" }, tags: ["datacenter-network"] },
    { location: { country: "SG", asn: 45102, city: "Singapore", network: "Alibaba" }, tags: ["datacenter-network"] },
    { location: { country: "DE", asn: 3320, city: "Berlin", network: "Deutsche Telekom" }, tags: ["eyeball-network"] },
    { location: { country: "CN", asn: 9999, city: "Shenzhen", network: "Other" }, tags: ["datacenter-network"] },
  ];

  it("counts exact carrier ASN coverage and probe types", () => {
    expect(getCarrierProbeCoverage(probes)).toEqual([
      { id: "telecom", name: "中国电信", asn: 4134, total: 2, eyeball: 1, datacenter: 1 },
      { id: "unicom", name: "中国联通", asn: 4837, total: 1, eyeball: 0, datacenter: 1 },
      { id: "mobile", name: "中国移动", asn: 9808, total: 1, eyeball: 1, datacenter: 0 },
    ]);
  });

  it("selects one probe per mainland carrier and only Japan, Hong Kong and US overseas", () => {
    const request = buildGlobalpingMeasurementRequest("45.67.89.10", 443, probes);
    expect(request.inProgressUpdates).toBe(true);
    expect(request.type).toBe("ping");
    expect(request.measurementOptions).toEqual({ protocol: "TCP", port: 443, packets: 3 });
    expect(request.locations).toEqual([
      { country: "CN", asn: 4134, tags: ["eyeball-network"], limit: 1 },
      { country: "CN", asn: 4837, limit: 1 },
      { country: "CN", asn: 9808, tags: ["eyeball-network"], limit: 1 },
      { country: "JP", tags: ["datacenter-network"], limit: 1 },
      { country: "HK", tags: ["datacenter-network"], limit: 1 },
      { country: "US", tags: ["datacenter-network"], limit: 1 },
    ]);
    expect(request.locations).toHaveLength(6);
  });

  it("reuses the baseline measurement ID to keep the exact probe group across protocols", () => {
    const request = buildGlobalpingMeasurementRequest("45.67.89.10", 443, probes, "UDP", "baseline-measurement-id");
    expect(request.type).toBe("mtr");
    expect(request.locations).toBe("baseline-measurement-id");
    expect(request.inProgressUpdates).toBe(true);
    expect(request.measurementOptions).toEqual({ protocol: "UDP", port: 443, packets: 3 });
  });

  it("builds ICMP ping without requiring or sending a destination port", () => {
    const request = buildGlobalpingMeasurementRequest("45.67.89.10", 0, probes, "ICMP");
    expect(request.type).toBe("ping");
    expect(request.measurementOptions).toEqual({ protocol: "ICMP", packets: 3 });
  });

  it("uses Globalping MTR for UDP because ping only supports ICMP and TCP", () => {
    const request = buildGlobalpingMeasurementRequest("45.67.89.10", 53, probes, "UDP");
    expect(request.type).toBe("mtr");
    expect(request.measurementOptions).toEqual({ protocol: "UDP", port: 53, packets: 3 });
  });

  it("does not start a measurement when no mainland carrier probes are online", () => {
    expect(() => buildGlobalpingMeasurementRequest("45.67.89.10", 443, [
      { location: { country: "JP", asn: 2516 }, tags: ["datacenter-network"] },
    ])).toThrow(/没有中国电信、联通或移动 ASN/);
  });

  it("rejects unsafe targets and invalid TCP/UDP ports", () => {
    expect(() => buildGlobalpingMeasurementRequest("192.168.1.1", 443, probes)).toThrow(/公网 IPv4/);
    expect(() => buildGlobalpingMeasurementRequest("45.67.89.10", 0, probes, "TCP")).toThrow(/端口/);
    expect(() => buildGlobalpingMeasurementRequest("45.67.89.10", 65536, probes, "UDP")).toThrow(/端口/);
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
    }, "TCP");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      carrier: "中国电信", status: "success", latencyMs: 28.4, probeType: "家庭/企业宽带",
    });
    expect(rows[1]).toMatchObject({
      carrier: "中国联通", status: "rejected", probeType: "数据中心",
    });
  });

  it("parses ICMP timings and labels overseas countries by region", () => {
    const rows = parseGlobalpingMeasurement({
      results: [{
        probe: { country: "JP", city: "Tokyo", asn: 2516, network: "Example ISP", tags: ["datacenter-network"] },
        result: { status: "finished", rawOutput: "3 packets transmitted, 3 received", timings: [{ rtt: 18.2 }], stats: { avg: 18.2 } },
      }],
    }, "ICMP");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ carrier: "日本", id: "country:JP", status: "success", latencyMs: 18.2 });
  });

  it("parses UDP MTR output without claiming the UDP service is open", () => {
    const rows = parseGlobalpingMeasurement({
      results: [{
        probe: { country: "HK", city: "Hong Kong", asn: 45102, network: "Example ISP", tags: ["datacenter-network"] },
        result: {
          status: "finished",
          rawOutput: "mtr: complete",
          resolvedAddress: "45.67.89.10",
          hops: [
            { resolvedAddress: "192.0.2.1", stats: { avg: 8, rcv: 3 }, timings: [{ rtt: 8 }] },
            { resolvedAddress: "45.67.89.10", stats: { avg: 22.5, rcv: 3 }, timings: [{ rtt: 22.5 }] },
          ],
        },
      }],
    }, "UDP");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      carrier: "香港",
      status: "success",
      latencyMs: 22.5,
      detail: expect.stringContaining("不代表服务端口已开放"),
    });
  });

  it("deduplicates multiple results for the same carrier and country", () => {
    const rows = parseGlobalpingMeasurement({
      results: [
        {
          probe: { country: "CN", city: "Beijing", asn: 4134, network: "Telecom DC", tags: ["datacenter-network"] },
          result: { status: "finished", rawOutput: "no response", timings: [], stats: { avg: null } },
        },
        {
          probe: { country: "CN", city: "Guangzhou", asn: 4134, network: "Telecom Home", tags: ["eyeball-network"] },
          result: { status: "finished", rawOutput: "reply", timings: [{ rtt: 30 }], stats: { avg: 30 } },
        },
        {
          probe: { country: "US", city: "Los Angeles", asn: 13335, network: "Cloudflare", tags: ["datacenter-network"] },
          result: { status: "finished", rawOutput: "reply", timings: [{ rtt: 90 }], stats: { avg: 90 } },
        },
        {
          probe: { country: "US", city: "New York", asn: 7922, network: "Comcast", tags: ["eyeball-network"] },
          result: { status: "finished", rawOutput: "reply", timings: [{ rtt: 100 }], stats: { avg: 100 } },
        },
      ],
    }, "TCP");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).toEqual(["asn:4134", "country:US"]);
    expect(rows[0]).toMatchObject({ city: "Guangzhou", status: "success" });
    expect(rows[1]).toMatchObject({ city: "New York", probeType: "家庭/企业宽带" });
  });

  it("keeps in-progress results distinct from failures", () => {
    const rows = parseGlobalpingMeasurement({
      results: [{
        probe: { country: "CN", city: "Shanghai", asn: 9808, tags: [] },
        result: { status: "in-progress", rawOutput: "" },
      }],
    }, "ICMP");
    expect(rows[0]?.status).toBe("pending");
  });
});

describe("Globalping rate-limit parsing", () => {
  it("parses the live quota and optional remaining credits", () => {
    expect(parseGlobalpingRateLimit({
      rateLimit: { measurements: { create: { type: "ip", limit: 250, remaining: 214, reset: 137 } } },
      credits: { remaining: 9 },
    })).toMatchObject({ type: "ip", limit: 250, remaining: 214, resetSeconds: 137, creditsRemaining: 9 });
  });

  it("returns null for incomplete limits responses", () => {
    expect(parseGlobalpingRateLimit({ rateLimit: {} })).toBeNull();
    expect(parseGlobalpingRateLimit(null)).toBeNull();
  });

  it("captures quota headers on a rate-limited measurement create", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { type: "rate_limit_exceeded", message: "Hourly limit exceeded" } }), {
      status: 429,
      headers: { "Content-Type": "application/json", "X-RateLimit-Limit": "250", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "90" },
    }));
    await expect(createGlobalpingMeasurement({
      type: "ping", target: "45.67.89.10", locations: [{ country: "CN", asn: 4134, limit: 1 }], inProgressUpdates: true,
      measurementOptions: { protocol: "ICMP", packets: 3 },
    })).rejects.toMatchObject({ name: "GlobalpingApiError", status: 429, rateLimit: { limit: 250, remaining: 0, resetSeconds: 90 } });
  });
});