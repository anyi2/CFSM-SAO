import { z } from "zod";
import { getServerApiBase } from "@/services/api";
import { cfsmPost } from "@/services/cfsm/http";

export type ProbeProviderId = "tcptest" | "boce" | "check-host";
export type ProbeMode = "ping" | "tcp";

export interface ProbeProviderInfo {
  id: ProbeProviderId;
  configured: boolean;
  requiresApiKey: boolean;
  billing: "public_api" | "metered_per_successful_node" | "metered_wave_points";
  usageNote: string;
}

export interface ProbeProxyConfig {
  baseUrl: string;
  token: string;
}

export interface ProbeNode {
  id: string;
  name: string;
  countryCode: string;
  country: string;
  city: string;
  carrier: string;
  asn: string;
  ip: string;
}

export interface ProbeTask {
  provider: ProbeProviderId;
  mode: ProbeMode;
  target: string;
  port?: number;
  taskId: string;
  reportUrl: string;
  nodes: Record<string, unknown>;
  createdAt: number;
}

export interface ProbeResult {
  provider: ProbeProviderId;
  taskId: string;
  pending: boolean;
  raw: unknown;
  [key: string]: unknown;
}

const BASE_KEY = "cfsm_network_probe_proxy_url";
const TOKEN_KEY = "cfsm_network_probe_proxy_token";

export function getProbeProxyConfig(): ProbeProxyConfig {
  if (typeof window === "undefined") return { baseUrl: "", token: "" };
  // Keep the proxy URL across visits, but keep its bearer secret only for the
  // current browser session. Remove the legacy localStorage copy on upgrade.
  const legacyToken = window.localStorage.getItem(TOKEN_KEY);
  if (legacyToken) {
    window.sessionStorage.setItem(TOKEN_KEY, legacyToken);
    window.localStorage.removeItem(TOKEN_KEY);
  }
  return {
    baseUrl: window.localStorage.getItem(BASE_KEY) || "",
    token: window.sessionStorage.getItem(TOKEN_KEY) || "",
  };
}

export function saveProbeProxyConfig(config: ProbeProxyConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BASE_KEY, config.baseUrl.trim().replace(/\/+$/, ""));
  window.sessionStorage.setItem(TOKEN_KEY, config.token.trim());
  window.localStorage.removeItem(TOKEN_KEY);
}

function proxyUrl(config: ProbeProxyConfig, path: string): string {
  const base = config.baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) throw new Error("代理地址必须使用 HTTPS");
  if (!config.token.trim()) throw new Error("请填写代理访问令牌");
  return `${base}${path}`;
}

async function proxyRequest<T>(
  config: ProbeProxyConfig,
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(proxyUrl(config, path), {
      ...init,
      signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token.trim()}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      credentials: "omit",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("无法连接网络检测代理，请检查代理地址、HTTPS 和网络连接");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("检测代理返回了无法识别的数据");
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: unknown }).error || "")
      : "";
    throw new Error(message || `检测代理请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

export async function getProbeProviders(
  config: ProbeProxyConfig,
  signal?: AbortSignal,
): Promise<{ providers: ProbeProviderInfo[] }> {
  return proxyRequest<{ providers: ProbeProviderInfo[] }>(
    config, "/v1/providers", {}, signal,
  );
}

export async function getProbeQuota(
  config: ProbeProxyConfig,
  provider: ProbeProviderId,
  signal?: AbortSignal,
): Promise<{ quota: unknown }> {
  return proxyRequest<{ quota: unknown }>(
    config, `/v1/providers/${provider}/quota`, {}, signal,
  );
}

export async function getProbeNodes(
  config: ProbeProxyConfig,
  provider: ProbeProviderId,
  signal?: AbortSignal,
): Promise<ProbeNode[]> {
  const result = await proxyRequest<{ nodes: ProbeNode[] }>(
    config, `/v1/providers/${provider}/nodes`, {}, signal,
  );
  return Array.isArray(result.nodes) ? result.nodes : [];
}

export async function createProbeTask(
  config: ProbeProxyConfig,
  input: {
    provider: ProbeProviderId;
    mode: ProbeMode;
    target: string;
    port?: number;
    nodeIds: string[];
    count?: number;
  },
  signal?: AbortSignal,
): Promise<ProbeTask> {
  return proxyRequest<ProbeTask>(config, "/v1/checks", {
    method: "POST",
    body: JSON.stringify(input),
  }, signal);
}

export async function getProbeResult(
  config: ProbeProxyConfig,
  provider: ProbeProviderId,
  taskId: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  return proxyRequest<ProbeResult>(
    config, `/v1/checks/${provider}/${encodeURIComponent(taskId)}`, {}, signal,
  );
}

function isPublicIpv4(value: unknown): value is string {
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

function findServerIpv4(payload: unknown, uuid: string, depth = 0): string | null {
  if (depth > 10 || payload == null || typeof payload !== "object") return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findServerIpv4(item, uuid, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = payload as Record<string, unknown>;
  const recordUuid = record.uuid ?? record.server_uuid ?? record.id;
  if (String(recordUuid ?? "") === uuid) {
    // Admin list may expose the latest metrics directly or inside a nested
    // metrics/report object. Search only this matched server subtree.
    return findPublicIpv4InRecord(record);
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === "ip_v4") continue;
    const found = findServerIpv4(value, uuid, depth + 1);
    if (found) return found;
  }
  return null;
}
/**
 * Read the selected CFSM server's own public IPv4 from the authenticated admin
 * server list. Never substitute the panel host IP, browser IP, or an unrelated node.
 */
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
