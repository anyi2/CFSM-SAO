import { fetchWithTimeout } from "@/utils/abort";

export type PortCheckProtocol = "tcp" | "udp";
export type PortCheckRegion = "ALL" | "CN" | "AS" | "EU" | "NA";

export interface PortCheckInput {
  target: string;
  port: number;
  protocol: PortCheckProtocol;
  region: PortCheckRegion;
  timeout: number;
}

export interface PortCheckResultRow {
  id: string;
  location: string;
  country: string;
  countryCode: string;
  city: string;
  isp: string;
  asn: string;
  targetIp: string;
  status: number | null;
  latencyMs: number | null;
  error: string;
}

export interface PortCheckReport {
  uuid: string;
  target: string;
  port: number;
  protocol: PortCheckProtocol;
  reportUrl: string;
  rows: PortCheckResultRow[];
  pending: boolean;
}

const API_ORIGIN = "https://api.check-host.cc";
const REPORT_POLL_INTERVAL_MS = 1_000;
const REPORT_POLL_ATTEMPTS = 15;

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function isPrivateIpv6(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (/^(fc|fd|fe[89ab])/.test(normalized)) return true;
  if (normalized.startsWith("ff")) return true;
  const mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return Boolean(mapped && isPrivateIpv4(mapped[1]!));
}

/**
 * Only public hostnames/IPs are accepted. This is a safety guard for the public
 * third-party probe network, not a replacement for the provider's own filtering.
 */
export function normalizePublicTarget(input: string): string {
  const raw = input.trim();
  if (!raw || raw.length > 253 || /[\s/@?#]/.test(raw)) {
    throw new Error("请输入公网 IP 或域名，不要包含协议、端口或路径");
  }

  const host = raw.replace(/^\[|\]$/g, "").toLowerCase();
  if (host.includes(":")) {
    let parsed: URL;
    try {
      parsed = new URL(`http://[${host}]/`);
    } catch {
      throw new Error("IPv6 地址格式不正确");
    }
    if (isPrivateIpv6(host)) throw new Error("不允许检测本地或内网 IPv6 地址");
    return parsed.hostname.replace(/^\[|\]$/g, "");
  }

  const ipv4Like = /^\d+(?:\.\d+){3}$/.test(host);
  if (ipv4Like) {
    const parts = host.split(".");
    if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
      throw new Error("IPv4 地址格式不正确");
    }
    if (isPrivateIpv4(host)) throw new Error("不允许检测本地、内网或保留 IPv4 地址");
    return host;
  }

  let parsed: URL;
  try {
    parsed = new URL(`http://${host}/`);
  } catch {
    throw new Error("域名格式不正确");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.port ||
    parsed.pathname !== "/" ||
    hostname.length > 253 ||
    !hostname.includes(".") ||
    /^[0-9.]+$/.test(hostname) ||
    hostname.endsWith(".") ||
    hostname.split(".").some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
    /\.(localhost|local|localdomain|internal|lan|home|test|invalid|example)$/.test(hostname)
  ) {
    throw new Error("请输入有效的公网域名，不支持内网主机名");
  }
  return hostname;
}

export function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("端口范围必须是 1–65535");
  }
  return port;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("检测已取消", "AbortError");
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("检测已取消", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${API_ORIGIN}${path}`,
      {
        ...init,
        mode: "cors",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
      },
      10_000,
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("连接端口检测服务超时或网络不可达，请稍后重试");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("端口检测服务返回了无法识别的数据");
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error ?? "")
        : "";
    throw new Error(message || `端口检测服务请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

interface ProviderDispatch {
  success?: boolean;
  uuid?: string;
  error?: string;
}

interface ProviderCheck {
  status?: number;
  connectiontime?: number | null;
  target_ip?: string;
  errortext?: string;
}

interface ProviderLocation {
  country?: string;
  countryCode?: string;
  city?: string;
  isp?: string;
  asn?: string;
  locationname?: string;
  checks?: ProviderCheck[];
}

interface ProviderReport {
  success?: boolean;
  error?: string;
  data?: Record<string, ProviderLocation>;
}

export function parsePortCheckRows(data: Record<string, ProviderLocation> | undefined): PortCheckResultRow[] {
  if (!data || typeof data !== "object") return [];
  const rows: PortCheckResultRow[] = [];
  for (const [locationKey, location] of Object.entries(data)) {
    const checks = Array.isArray(location.checks) ? location.checks : [];
    for (const [index, check] of checks.entries()) {
      rows.push({
        id: `${locationKey}-${index}`,
        location: location.locationname || locationKey,
        country: location.country || "",
        countryCode: location.countryCode || "",
        city: location.city || "",
        isp: location.isp || "",
        asn: location.asn || "",
        targetIp: check.target_ip || "",
        status: typeof check.status === "number" ? check.status : null,
        latencyMs:
          typeof check.connectiontime === "number" && Number.isFinite(check.connectiontime)
            ? check.connectiontime
            : null,
        error: check.errortext || "",
      });
    }
  }
  return rows;
}

export async function runPortCheck(
  input: PortCheckInput,
  signal?: AbortSignal,
): Promise<PortCheckReport> {
  const target = normalizePublicTarget(input.target);
  const port = validatePort(input.port);
  const protocol = input.protocol;
  const region = input.region === "ALL" ? undefined : [input.region];
  const dispatch = await requestJson<ProviderDispatch>(
    `/${protocol}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target,
        port,
        ...(region ? { region } : {}),
        repeatchecks: 0,
        timeout: input.timeout,
      }),
    },
    signal,
  );

  if (!dispatch.success || !dispatch.uuid || !/^[0-9a-f-]{36}$/i.test(dispatch.uuid)) {
    throw new Error(dispatch.error || "检测任务提交失败");
  }

  const reportUrl = `https://check-host.cc/report/${encodeURIComponent(dispatch.uuid)}`;
  let rows: PortCheckResultRow[] = [];
  let previousSignature = "";
  let stableSamples = 0;

  for (let attempt = 0; attempt < REPORT_POLL_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);
    if (attempt > 0) await delay(REPORT_POLL_INTERVAL_MS, signal);
    const report = await requestJson<ProviderReport>(
      `/report/${encodeURIComponent(dispatch.uuid)}`,
      { method: "GET" },
      signal,
    );
    if (report.error && !report.data) throw new Error(report.error);
    rows = parsePortCheckRows(report.data);
    if (rows.length > 0) {
      const signature = JSON.stringify(rows);
      if (signature === previousSignature) {
        stableSamples += 1;
      } else {
        previousSignature = signature;
        stableSamples = 0;
      }
      // Each location reports independently. Wait for a short quiet period so the
      // first fast probe does not make the worldwide result look prematurely complete.
      if (stableSamples >= 2) {
        return {
          uuid: dispatch.uuid,
          target,
          port,
          protocol,
          reportUrl,
          rows,
          pending: false,
        };
      }
    }
  }

  return {
    uuid: dispatch.uuid,
    target,
    port,
    protocol,
    reportUrl,
    rows,
    pending: true,
  };
}
