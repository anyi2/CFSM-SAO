import { describe, expect, it } from "vitest";
import { findServerIpv4, isPublicIpv4 } from "@/services/networkProbe";

describe("isPublicIpv4", () => {
  it("accepts ordinary public IPv4 addresses", () => {
    expect(isPublicIpv4("1.1.1.1")).toBe(true);
    expect(isPublicIpv4("8.8.8.8")).toBe(true);
  });

  it.each([
    "1",
    "0",
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "01.1.1.1",
    "256.1.1.1",
    "not-an-ip",
  ])("rejects non-public or malformed address %s", (ip) => {
    expect(isPublicIpv4(ip)).toBe(false);
  });
});

describe("findServerIpv4", () => {
  const selectedUuid = "node-selected";
  const otherUuid = "node-other";

  it("reads the public IP from the selected server record", () => {
    const response = {
      servers: [
        { uuid: otherUuid, ip_v4: "8.8.8.8" },
        { uuid: selectedUuid, ip_v4: "1.1.1.1" },
      ],
    };
    expect(findServerIpv4(response, selectedUuid)).toBe("1.1.1.1");
  });

  it("reads a nested latest report without mistaking a reachability flag for an IP", () => {
    const response = {
      servers: [{
        uuid: selectedUuid,
        ip_v4: "1",
        latest_report: { metrics: { ip_v4: "203.0.113.8" } },
      }],
    };
    // Documentation-only TEST-NET addresses are not accepted as public.
    expect(findServerIpv4(response, selectedUuid)).toBeNull();
  });

  it("finds a real public IP in a nested report for the selected server", () => {
    const response = {
      servers: [{
        uuid: selectedUuid,
        ip_v4: "1",
        latest_report: { metrics: { ip_v4: "45.67.89.10" } },
      }],
    };
    expect(findServerIpv4(response, selectedUuid)).toBe("45.67.89.10");
  });

  it("does not fall back to another server when the selected server has no IP", () => {
    const response = {
      servers: [
        { uuid: otherUuid, ip_v4: "8.8.8.8" },
        { uuid: selectedUuid, ip_v4: "1" },
      ],
    };
    expect(findServerIpv4(response, selectedUuid)).toBeNull();
  });

  it("returns null when the selected server is absent", () => {
    expect(findServerIpv4({ servers: [{ uuid: otherUuid, ip_v4: "8.8.8.8" }] }, selectedUuid)).toBeNull();
  });
});
