import { z } from "zod";
import { getServerApiBase } from "@/services/api";
import { cfsmPost } from "@/services/cfsm/http";

export const GLOBALPING_API_BASE = "https://api.globalping.io/v1";

export const CARRIER_ASNS = [
  { id: "telecom", name: "中国电信", asn: 4134 },
  { id: "unicom", name: "中国联通", asn: 4837 },
  { id: "mobile", name: "中国移动", asn: 9808 },
] as const;

export const OVERSEAS_COUNTRIES = [
  { code: "JP", name: "日本" },
  { code: "HK", name: "香港" },
  { code: "US", name: "美国" },
] as const;

export type NetworkProbeProtocol = "ICMP" | "TCP" | "UDP";

export interface GlobalpingRateLimitSnapshot {
  type: "ip" | "user";
  limit: number;
  remaining: number;
  resetSeconds: number;
  creditsRemaining?: number;
  checkedAt: number;
}

export class GlobalpingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rateLimit?: GlobalpingRateLimitSnapshot,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GlobalpingApiError";
  }
}

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
  limit: 1;
}

export interface GlobalpingMeasurementRequest {
  type: "ping" | "mtr";
  target: string;
  locations: GlobalpingLocation[] | string;
  inProgressUpdates: boolean;
  measurementOptions: {
    protocol: NetworkProbeProtocol;
    port?: number;
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
 * Select exactly one probe for each available mainland carrier and overseas
 * control country. The API may return fewer results if a probe goes offline
 * between discovery and measurement.
 */
export function buildGlobalpingMeasurementRequest(
  target: string,
  port: number,
  probes: GlobalpingProbe[],
  protocol: NetworkProbeProtocol = "TCP",
  reuseProbeMeasurementId?: string,
): GlobalpingMeasurementRequest {
  if (!isPublicIpv4(target)) throw new Error("请输入有效的公网 IPv4 地址");
  if (!["ICMP", "TCP", "UDP"].includes(protocol)) throw new Error("请选择 ICMP、TCP 或 UDP 检测协议");
  if (protocol !== "ICMP" && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("目标端口必须在 1–65535 之间");
  }

  const locations: GlobalpingLocation[] = [];
  for (const carrier of CARRIER_ASNS) {
    const matches = probes.filter((probe) =>
      probe.location?.country === "CN" && Number(probe.location?.asn) === carrier.asn
    );
    if (!matches.length) continue;

    const eyeball = matches.filter((probe) => (probe.tags || []).includes("eyeball-network"));
    const useEyeball = eyeball.length > 0;
    locations.push({
      country: "CN",
      asn: carrier.asn,
      ...(useEyeball ? { tags: ["eyeball-network"] } : {}),
      limit: 1,
    });
  }

  const availableCountries = new Set(
    probes
      .map((probe) => probe.location?.country)
      .filter((country): country is string => Boolean(country)),
  );
  for (const country of OVERSEAS_COUNTRIES) {
    if (!availableCountries.has(country.code)) continue;
    const countryProbes = probes.filter((probe) => probe.location?.country === country.code);
    const datacenter = countryProbes.some((probe) => (probe.tags || []).includes("datacenter-network"));
    locations.push({
      country: country.code,
      ...(datacenter ? { tags: ["datacenter-network"] } : {}),
      limit: 1,
    });
  }

  if (!locations.some((location) => typeof location.asn === "number")) {
    throw new Error("Globalping 当前没有中国电信、联通或移动 ASN 的在线探针。请稍后重试，或使用 AntPing 人工复核。");
  }

  return {
    // Globalping ping supports ICMP and TCP. UDP is supported by MTR instead.
    type: protocol === "UDP" ? "mtr" : "ping",
    target,
    // A previous measurement ID makes Globalping reuse the selected probes.
    locations: reuseProbeMeasurementId || locations,
    inProgressUpdates: true,
    measurementOptions: {
      protocol,
      ...(protocol === "ICMP" ? {} : { port }),
      packets: 3,
    },
  };
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseGlobalpingRateLimit(payload: unknown): GlobalpingRateLimitSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const rateLimit = root.rateLimit && typeof root.rateLimit === "object" ? root.rateLimit as Record<string, unknown> : {};
  const measurements = rateLimit.measurements && typeof rateLimit.measurements === "object" ? rateLimit.measurements as Record<string, unknown> : {};
  const create = measurements.create && typeof measurements.create === "object" ? measurements.create as Record<string, unknown> : {};
  const limit = finiteNumber(create.limit);
  const remaining = finiteNumber(create.remaining);
  const resetSeconds = finiteNumber(create.reset);
  if (limit === null || remaining === null || resetSeconds === null) return null;
  const credits = root.credits && typeof root.credits === "object" ? finiteNumber((root.credits as Record<string, unknown>).remaining) : null;
  return {
    type: create.type === "user" ? "user" : "ip",
    limit, remaining, resetSeconds,
    ...(credits === null ? {} : { creditsRemaining: credits }),
    checkedAt: Date.now(),
  };
}

function parseGlobalpingRateLimitHeaders(headers: Headers): GlobalpingRateLimitSnapshot | null {
  const limit = finiteNumber(headers.get("X-RateLimit-Limit"));
  const remaining = finiteNumber(headers.get("X-RateLimit-Remaining"));
  const resetSeconds = finiteNumber(headers.get("X-RateLimit-Reset"));
  if (limit === null || remaining === null || resetSeconds === null) return null;
  const credits = finiteNumber(headers.get("X-Credits-Remaining"));
  return { type: "ip", limit, remaining, resetSeconds, ...(credits === null ? {} : { creditsRemaining: credits }), checkedAt: Date.now() };
}

function secondsLabel(seconds: number): string {
  const value = Math.max(0, Math.ceil(seconds));
  return value < 60 ? value + " 秒" : Math.ceil(value / 60) + " 分钟";
}

async function globalpingRequest<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
  onResponse?: (response: Response) => void,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(GLOBALPING_API_BASE + path, {
      ...init, signal, credentials: "omit",
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const method = (init.method || "GET").toUpperCase();
    const endpoint = GLOBALPING_API_BASE + path;
    const reason = error instanceof Error && error.message ? "（浏览器信息：" + error.message + "）" : "";
    throw new Error("浏览器无法完成 Globalping 请求：" + method + " " + endpoint + "。可能是当前网络/DNS 无法访问，或页面 CSP、浏览器扩展拦截。" + reason + " 可打开下方“测试 Globalping 接口”链接检查基础连通性。");
  }
  onResponse?.(response);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error("Globalping API 返回了无法识别的数据。"); }
  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const nestedError = body.error && typeof body.error === "object" ? (body.error as Record<string, unknown>).message : body.error;
    const message = String(nestedError || body.message || "");
    const rateLimit = parseGlobalpingRateLimitHeaders(response.headers);
    const retryAfterSeconds = finiteNumber(response.headers.get("Retry-After")) ?? undefined;
    if (response.status === 429) {
      const details = [
        rateLimit ? "额度剩余 " + rateLimit.remaining + " / " + rateLimit.limit + " 次探针测试" : "",
        rateLimit ? "额度窗口约 " + secondsLabel(rateLimit.resetSeconds) + " 后重置" : "",
        retryAfterSeconds !== undefined ? "建议等待约 " + secondsLabel(retryAfterSeconds) + " 后重试" : "",
      ].filter(Boolean).join("；");
      throw new GlobalpingApiError("Globalping 请求触发频率/额度限制（HTTP 429）。" + (details ? details + "。" : "请稍后再试，并刷新当前额度信息。"), response.status, rateLimit || undefined, retryAfterSeconds);
    }
    if (response.status === 422 && /no matching|no probes|probe/i.test(message)) {
      throw new GlobalpingApiError("当前筛选条件没有匹配到在线探针。请稍后重试，或使用 AntPing 人工检测。", response.status, rateLimit || undefined);
    }
    throw new GlobalpingApiError(message || "Globalping 请求失败（HTTP " + response.status + "）。", response.status, rateLimit || undefined, retryAfterSeconds);
  }
  return payload as T;
}
export async function getGlobalpingRateLimit(signal?: AbortSignal): Promise<GlobalpingRateLimitSnapshot> {
  const payload = await globalpingRequest<unknown>("/limits", {}, signal);
  const snapshot = parseGlobalpingRateLimit(payload);
  if (!snapshot) throw new Error("Globalping 额度接口返回的数据格式不正确。");
  return snapshot;
}

export async function getGlobalpingProbes(signal?: AbortSignal): Promise<GlobalpingProbe[]> {
  const payload = await globalpingRequest<unknown>("/probes", {}, signal);
  if (!Array.isArray(payload)) throw new Error("Globalping 在线探针列表格式不正确。");
  return payload as GlobalpingProbe[];
}

export async function createGlobalpingMeasurement(
  request: GlobalpingMeasurementRequest,
  signal?: AbortSignal,
): Promise<{ id: string; probesCount: number; rateLimit?: GlobalpingRateLimitSnapshot }> {
  let rateLimit: GlobalpingRateLimitSnapshot | null = null;
  const payload = await globalpingRequest<{ id?: unknown; probesCount?: unknown }>(
    "/measurements",
    { method: "POST", body: JSON.stringify(request) },
    signal,
    (response) => { rateLimit = parseGlobalpingRateLimitHeaders(response.headers); },
  );
  if (typeof payload.id !== "string" || !payload.id) {
    throw new Error("Globalping 没有返回检测任务编号。");
  }
  return {
    id: payload.id,
    probesCount: Number(payload.probesCount) || 0,
    ...(rateLimit ? { rateLimit } : {}),
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

function resultCarrier(asn: number, country: string): string | null {
  const carrier = CARRIER_ASNS.find((item) => item.asn === asn);
  if (country === "CN") return carrier?.name || null;
  return OVERSEAS_COUNTRIES.find((item) => item.code === country)?.name || null;
}

function resultKey(asn: number, country: string): string | null {
  if (country === "CN") return CARRIER_ASNS.some((item) => item.asn === asn) ? "asn:" + asn : null;
  return OVERSEAS_COUNTRIES.some((item) => item.code === country) ? "country:" + country : null;
}

function rawOutputSummary(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const lines = value.trim().split("\n").map((line) => line.trim()).filter(Boolean);
  return (lines.at(-1) || lines[0] || "").slice(0, 180);
}

function rowPriority(row: GlobalpingResultRow): number {
  const status = { success: 5, rejected: 4, pending: 3, failed: 2, unknown: 1 }[row.status];
  const probe = row.probeType === "家庭/企业宽带" ? 2 : row.probeType === "数据中心" ? 1 : 0;
  const latency = row.latencyMs == null ? 0 : Math.max(0, 1000 - Math.min(row.latencyMs, 1000)) / 1000;
  return status * 10 + probe + latency;
}

function orderResultRows(rows: GlobalpingResultRow[]): GlobalpingResultRow[] {
  const order = [
    ...CARRIER_ASNS.map((carrier) => "asn:" + carrier.asn),
    ...OVERSEAS_COUNTRIES.map((country) => "country:" + country.code),
  ];
  return [...rows].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/**
 * Normalize results to one row per requested carrier/country, even if an API
 * response unexpectedly contains more than one result for a location.
 */
export function parseGlobalpingMeasurement(
  payload: Record<string, unknown>,
  protocol: NetworkProbeProtocol = "TCP",
): GlobalpingResultRow[] {
  const results = Array.isArray(payload.results) ? payload.results : [];
  const uniqueRows = new Map<string, GlobalpingResultRow>();

  results.forEach((entry) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const probe = item.probe && typeof item.probe === "object" ? item.probe as Record<string, unknown> : {};
    const result = item.result && typeof item.result === "object" ? item.result as Record<string, unknown> : {};
    const asn = Number(probe.asn) || 0;
    const country = String(probe.country || "");
    const key = resultKey(asn, country);
    const carrier = resultCarrier(asn, country);
    if (!key || !carrier) return;

    const tags = Array.isArray(probe.tags) ? probe.tags.map(String) : [];
    const timings = Array.isArray(result.timings) ? result.timings : [];
    const samples = timings
      .map((timing) => timing && typeof timing === "object" ? numeric((timing as Record<string, unknown>).rtt) : null)
      .filter((sample): sample is number => sample !== null);
    const stats = result.stats && typeof result.stats === "object" ? result.stats as Record<string, unknown> : {};
    const hops = Array.isArray(result.hops) ? result.hops : [];
    const respondingHops = hops.filter((hop) => {
      if (!hop || typeof hop !== "object") return false;
      const hopRecord = hop as Record<string, unknown>;
      const hopStats = hopRecord.stats && typeof hopRecord.stats === "object"
        ? hopRecord.stats as Record<string, unknown>
        : {};
      const hopTimings = Array.isArray(hopRecord.timings) ? hopRecord.timings : [];
      return (numeric(hopStats.rcv) || 0) > 0 || hopTimings.some((timing) =>
        Boolean(timing && typeof timing === "object" && numeric((timing as Record<string, unknown>).rtt) !== null)
      );
    });
    const targetAddress = String(result.resolvedAddress || "");
    const targetHop = respondingHops.find((hop) =>
      hop && typeof hop === "object" && String((hop as Record<string, unknown>).resolvedAddress || "") === targetAddress
    );
    const lastRespondingHop = respondingHops.at(-1);
    const targetHopStats = targetHop && typeof targetHop === "object" && (targetHop as Record<string, unknown>).stats
      ? (targetHop as Record<string, unknown>).stats as Record<string, unknown>
      : null;
    const lastHopStats = lastRespondingHop && typeof lastRespondingHop === "object" && (lastRespondingHop as Record<string, unknown>).stats
      ? (lastRespondingHop as Record<string, unknown>).stats as Record<string, unknown>
      : null;
    const latency = protocol === "UDP"
      ? numeric(targetHopStats?.avg) ?? numeric(lastHopStats?.avg)
      : numeric(stats.avg) ?? (samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null);

    const rawOutput = String(result.rawOutput || "");
    const unreachable = /port unreachable|destination (?:host|network) unreachable|host unreachable|network unreachable|administratively prohibited|!X|!H|!N/i.test(rawOutput);
    const resultStatus = String(result.status || "");
    const pending = resultStatus === "in-progress";
    const hasResponse = protocol === "UDP" ? respondingHops.length > 0 : samples.length > 0 || latency !== null;
    const rejected = protocol === "TCP"
      ? /connection refused|connection reset|actively refused|port is closed/i.test(rawOutput)
      : unreachable;
    const status: GlobalpingResultRow["status"] = pending
      ? "pending"
      : rejected
        ? "rejected"
        : hasResponse
          ? "success"
          : resultStatus === "finished" || resultStatus === "failed" || resultStatus === "offline"
            ? "failed"
            : "unknown";

    const city = String(probe.city || "");
    const network = String(probe.network || "");
    const probeType = tags.includes("eyeball-network")
      ? "家庭/企业宽带"
      : tags.includes("datacenter-network")
        ? "数据中心"
        : "未分类";

    let detail = rawOutputSummary(result.rawOutput);
    if (protocol === "UDP" && status === "success") {
      detail = "UDP 路径收到 " + respondingHops.length + " 个响应节点；不代表服务端口已开放";
    } else if (!detail) {
      detail = status === "success"
        ? protocol + " 收到响应"
        : status === "rejected"
          ? protocol + " 探测收到拒绝/不可达响应"
          : status === "failed"
            ? protocol + " 未收到响应"
            : status === "pending" ? "检测进行中" : "结果暂不可用";
    }

    const row: GlobalpingResultRow = {
      id: key,
      carrier,
      asn,
      country,
      city,
      network,
      probeType,
      status,
      latencyMs: latency,
      detail,
    };
    const previous = uniqueRows.get(key);
    if (!previous || rowPriority(row) > rowPriority(previous)) uniqueRows.set(key, row);
  });

  return orderResultRows([...uniqueRows.values()]);
}
