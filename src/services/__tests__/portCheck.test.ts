import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizePublicTarget,
  parsePortCheckRows,
  runPortCheck,
  validatePort,
} from "@/services/portCheck";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizePublicTarget", () => {
  it("accepts public IPv4 and hostname targets", () => {
    expect(normalizePublicTarget(" 1.1.1.1 ")).toBe("1.1.1.1");
    expect(normalizePublicTarget("Example.COM")).toBe("example.com");
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.1.1",
    "localhost",
    "router.local",
    "https://example.com",
    "example.com:443",
    "example.com/path",
    "0177.0.0.1",
    "001.1.1.1",
    "0x7f.0.0.1",
    "2130706433",
    "0x7f000001",
    "2001:db8::1",
    "2001:2::1",
    "2002::1",
    "3fff::1",
  ])("rejects non-public or malformed target %s", (target) => {
    expect(() => normalizePublicTarget(target)).toThrow();
  });

  it("normalizes a bracketed IPv6 address", () => {
    expect(normalizePublicTarget("[2606:4700:4700::1111]")).toBe("2606:4700:4700::1111");
  });

  it("rejects private and loopback IPv6 addresses", () => {
    expect(() => normalizePublicTarget("::1")).toThrow();
    expect(() => normalizePublicTarget("fc00::1")).toThrow();
  });

  it("accepts a globally routable IPv6 address", () => {
    expect(normalizePublicTarget("2606:4700:4700::1111")).toBe("2606:4700:4700::1111");
  });
});

describe("validatePort", () => {
  it("accepts only integer TCP/UDP port numbers", () => {
    expect(validatePort(443)).toBe(443);
    expect(() => validatePort(0)).toThrow("1–65535");
    expect(() => validatePort(65_536)).toThrow("1–65535");
    expect(() => validatePort(80.5)).toThrow("1–65535");
  });
});

describe("parsePortCheckRows", () => {
  it("maps provider location and check data into stable rows", () => {
    expect(
      parsePortCheckRows({
        "JP-TYO-Test": {
          country: "Japan",
          countryCode: "JP",
          city: "Tokyo",
          isp: "Example ISP",
          asn: "AS64500",
          checks: [
            {
              status: 1,
              connectiontime: 18,
              target_ip: "1.1.1.1",
              errortext: "",
            },
          ],
        },
      }),
    ).toEqual([
      {
        id: "JP-TYO-Test-0",
        location: "JP-TYO-Test",
        country: "Japan",
        countryCode: "JP",
        city: "Tokyo",
        isp: "Example ISP",
        asn: "AS64500",
        targetIp: "1.1.1.1",
        status: 1,
        latencyMs: 18,
        error: "",
      },
    ]);
  });

  it("returns an empty list for an unfinished or empty report", () => {
    expect(parsePortCheckRows(undefined)).toEqual([]);
    expect(parsePortCheckRows({})).toEqual([]);
    expect(parsePortCheckRows({ node: { checks: [] } })).toEqual([]);
  });
});

describe("runPortCheck", () => {
  it("submits a single manual check and polls its report", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () =>
        jsonResponse({
          success: true,
          uuid: "ca9f3340-1071-4e6d-9717-5fe16072741d",
        }),
      )
      .mockImplementation(async () =>
        jsonResponse({
          success: true,
          data: {
            "JP-TYO-Test": {
              country: "Japan",
              countryCode: "JP",
              city: "Tokyo",
              isp: "Example ISP",
              asn: "AS64500",
              checks: [{ status: 1, connectiontime: 12, target_ip: "1.1.1.1" }],
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const report = await runPortCheck({
      target: "1.1.1.1",
      port: 443,
      protocol: "tcp",
      region: "ALL",
      timeout: 2_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.check-host.cc/tcp");
    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      target: "1.1.1.1",
      port: 443,
      repeatchecks: 0,
      timeout: 2_000,
    });
    expect(report.rows).toHaveLength(1);
    expect(report.pending).toBe(false);
    expect(report.reportUrl).toContain(report.uuid);
  });

  it("rejects a private target before making an external request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      runPortCheck({
        target: "192.168.1.1",
        port: 22,
        protocol: "tcp",
        region: "ALL",
        timeout: 1_000,
      }),
    ).rejects.toThrow("不允许检测");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
