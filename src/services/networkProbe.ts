import { z } from "zod";
import { getServerApiBase } from "@/services/api";
import { cfsmPost } from "@/services/cfsm/http";

export const GLOBALPING_API_BASE = "https://api.globalping.io/v1";

export const CARRIER_ASNS = [
  { id: "telecom", name: "中国电信", asn: 4134 },
  { id: "unicom", name: "中国联通", asn: 4837 },
  { id: "mobile", name: "中国移动", asn: 9808 },
] as const;

const OVERSEAS_COUNTRY_PRIORITY = ["JP", "SG", "US", "DE"] as const;

export interface GlobalpingProbe {
  location?: {
    country?: string;
    city?: string;
    asn?: number;
    network?: string;
  };
  tags?: string[];
}

export interface ProbeCoverage {
  id: typeof CARRIER_ASNS[number]["id"];
  name: string;
  asn: number;
  total: number;
  eyeball: number;
  datacenter: number;
}

export interface GlobalpingLocation {
  country: string;
  asn?: number;
  tags?: string[];
  limit: number;
}

export interface GlobalpingMeasurementRequest {
  type: "ping";
  target: string;
  locations: GlobalpingLocation[];
  measurementOptions: {
    protocol: "TCP";
    port: number;
    packets: number;
  };
}

export interface GlobalpingResultRow {
  id: string;
  carrier: string;
  asn: number;
  country: string;
  city: string;
  network: string;
  probeType: string;
  status: "success" | "rejected" | "failed" | "pending" | "unknown";
  latencyMs: number | null;
  detail: string;
}

export function isPublicIpv4(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.trim().split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return false;
  const [a, b, c] = parts.map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

function findPublicIpv4InRecord(payload: unknown, depth = 0): string | null {
  if (depth > 10 || payload == null || typeof payload !== "object") return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findPublicIpv4InRecord(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (isPublicIpv4(record.ip_v4)) return record.ip_v4.trim();

  for (const [key, value] of Object.entries(record)) {
    if (key === "ip_v4") continue;
    const found = findPublicIpv4InRecord(value, depth + 1);
    if (found) return found;
  }
  return null;
}

export function findServerIpv4(payload: unknown, uuid: string, depth = 0): string | null {
  if (depth > 10 || payload == null || typeof payload !== "object") return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findServerIpv4(item, uuid, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = payload as Record<string, unknown>;
  const matchesServer = [record.uuid, record.server_uuid, record.id]
    .some((candidate) => String(candidate ?? "") === uuid);
  if (matchesServer) return findPublicIpv4InRecord(record);

  for (const [key, value] of Object.entries(record)) {
    if (key === "ip_v4") continue;
    const found = findServerIpv4(value, uuid, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Read only the selected CFSM server's public IPv4 from its admin server list. */
export async function getCurrentNodePublicIpv4(uuid: string, signal?: AbortSignal): Promise<string | null> {
  if (!uuid) return null;
  const response = await cfsmPost(
    "/admin/api",
    { action: "list", refresh: true },
    z.unknown(),
    { signal, timeout: 15_000, base: getServerApiBase(uuid) },
  );
  return findServerIpv4(response, uuid);
}

export function getCarrierProbeCoverage(probes: GlobalpingProbe[]): ProbeCoverage[] {
  return CARRIER_ASNS.map((carrier) => {
    const matches = probes.filter((probe) =>
      probe.location?.country === "CN" && Number(probe.location?.asn) === carrier.asn
    );
    return {
      ...carrier,
      total: matches.length,
      eyeball: matches.filter((probe) => (probe.tags || []).includes("eyeball-network")).length,
      datacenter: matches.filter((probe) => (probe.tags || []).includes("datacenter-network")).length,
    };
  });
}

/**
 * Prefer eyeball ISP probes for mainland tests; fall back to other probes
 * in the same carrier ASN when no eyeball probe is online.
 */
export function buildGlobalpingMeasurementRequest(
  target: string,
  port: number,
  probes: GlobalpingProbe[],
): GlobalpingMeasurementRequest {
  if (!isPublicIpv4(target)) throw new Error("请输入有效的公网 IPv4 地址");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须在 1–65535 之间");

  const locations: GlobalpingLocation[] = [];
  for (const carrier of CARRIER_ASNS) {
    const matches = probes.filter((probe) =>
      probe.location?.country === "CN" && Number(probe.location?.asn) === carrier.asn
    );
    if (!matches.length) continue;
    const eyeball = matches.filter((probe) => (probe.tags || []).includes("eyeball-network"));
    const useEyeball = eyeball.length > 0;
    const candidates = useEyeball ? eyeball : matches;
    locations.push({
      country: "CN",
      asn: carrier.asn,
      ...(useEyeball ? { tags: ["eyeball-network"] } : {}),
      limit: Math.min(2, candidates.length),
    });
  }

  const availableCountries = new Set(
    probes.map((probe) => probe.location?.country).filter((country): country is string => Boolean(country) && country !== "CN"),
  );
  let overseasCount = 0;
  for (const country of OVERSEAS_COUNTRY_PRIORITY) {
    if (!availableCountries.has(country)) continue;
    const countryProbes = probes.filter((probe) => probe.location?.country === country);
    const datacenter = countryProbes.filter((probe) => (probe.tags || []).includes("datacenter-network"));
    locations.push({
      country,
      ...(datacenter.length > 0 ? { tags: ["datacenter-network"] } : {}),
      limit: 1,
    });
    overseasCount += 1;
    if (overseasCount >= 2) break;
  }

  if (!locations.some((location) => typeof location.asn === "number")) {
    throw new Error("Globalping 当前没有中国电信、联通或移动 ASN 的在线探针。请使用 AntPing 进行大陆三网复核。");
  }

  return {
    type: "ping",
    target,
    locations,
    measurementOptions: { protocol: "TCP", port, packets: 3 },
  };
}

async function globalpingRequest<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(GLOBALPING_API_BASE + path, {
      ...init,
      signal,
      credentials: "omit",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("无法连接 Globalping API，请检查浏览器网络后重试。");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Globalping API 返回了无法识别的数据。");
  }

  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const nestedError = body.error && typeof body.error === "object"
      ? (body.error as Record<string, unknown>).message
      : body.error;
    const message = String(nestedError || body.message || "");
    if (response.status === 429) {
      throw new Error("Globalping 免费检测额度暂时达到限制（HTTP 429）。请稍后再试，或在 Globalping 官网查看额度。");
    }
    if (response.status === 422 && /no matching|no probes|probe/i.test(message)) {
      throw new Error("当前筛选条件没有匹配到在线探针。请稍后重试，或使用 AntPing 人工检测。");
    }
    throw new Error(message || "Globalping 请求失败（HTTP " + response.status + "）。");
  }

  return payload as T;
}

export async function getGlobalpingProbes(signal?: AbortSignal): Promise<GlobalpingProbe[]> {
  const payload = await globalpingRequest<unknown>("/probes", {}, signal);
  if (!Array.isArray(payload)) throw new Error("Globalping 在线探针列表格式不正确。");
  return payload as GlobalpingProbe[];
}

export async function createGlobalpingMeasurement(
  request: GlobalpingMeasurementRequest,
  signal?: AbortSignal,
): Promise<{ id: string; probesCount: number }> {
  const payload = await globalpingRequest<{ id?: unknown; probesCount?: unknown }>(
    "/measurements",
    { method: "POST", body: JSON.stringify(request) },
    signal,
  );
  if (typeof payload.id !== "string" || !payload.id) {
    throw new Error("Globalping 没有返回检测任务编号。");
  }
  return {
    id: payload.id,
    probesCount: Number(payload.probesCount) || 0,
  };
}

export async function getGlobalpingMeasurement(
  id: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return globalpingRequest<Record<string, unknown>>(
    "/measurements/" + encodeURIComponent(id),
    {},
    signal,
  );
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function probeCarrier(asn: number): string {
  return CARRIER_ASNS.find((carrier) => carrier.asn === asn)?.name || (asn ? "其他网络" : "未知运营商");
}

function rawOutputSummary(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const lines = value.trim().split("\n").map((line) => line.trim()).filter(Boolean);
  return (lines.at(-1) || lines[0] || "").slice(0, 180);
}

export function parseGlobalpingMeasurement(payload: Record<string, unknown>): GlobalpingResultRow[] {
  const results = Array.isArray(payload.results) ? payload.results : [];
  return results.map((entry, index) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const probe = item.probe && typeof item.probe === "object" ? item.probe as Record<string, unknown> : {};
    const result = item.result && typeof item.result === "object" ? item.result as Record<string, unknown> : {};
    const asn = Number(probe.asn) || 0;
    const tags = Array.isArray(probe.tags) ? probe.tags.map(String) : [];
    const timings = Array.isArray(result.timings) ? result.timings : [];
    const samples = timings
      .map((timing) => timing && typeof timing === "object" ? numeric((timing as Record<string, unknown>).rtt) : null)
      .filter((sample): sample is number => sample !== null);
    const stats = result.stats && typeof result.stats === "object" ? result.stats as Record<string, unknown> : {};
    const latency = numeric(stats.avg) ?? (samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null);
    const rawOutput = String(result.rawOutput || "");
    const rejected = /connection refused|connection reset|actively refused|port is closed/i.test(rawOutput);
    const resultStatus = String(result.status || "");
    const pending = resultStatus === "in-progress";
    const status: GlobalpingResultRow["status"] = pending
      ? "pending"
      : samples.length > 0 || latency !== null
        ? rejected ? "rejected" : "success"
        : resultStatus === "finished" || resultStatus === "failed" || resultStatus === "offline"
          ? "failed"
          : "unknown";
    const city = String(probe.city || "");
    const country = String(probe.country || "");
    const network = String(probe.network || "");
    const probeType = tags.includes("eyeball-network")
      ? "家庭/企业宽带"
      : tags.includes("datacenter-network")
        ? "数据中心"
        : "未分类";

    let detail = rawOutputSummary(result.rawOutput);
    if (!detail) {
      detail = status === "success" ? "TCP 探测收到响应"
        : status === "rejected" ? "目标返回拒绝或重置"
          : status === "failed" ? "没有收到 TCP 响应"
            : status === "pending" ? "检测进行中" : "结果暂不可用";
    }

    return {
      id: String(probe.asn || "probe") + "-" + country + "-" + city + "-" + index,
      carrier: probeCarrier(asn),
      asn,
      country,
      city,
      network,
      probeType,
      status,
      latencyMs: latency,
      detail,
    };
  });
}
