import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const TOKEN = (process.env.PROBE_PROXY_TOKEN || "").trim();
const ORIGINS = new Set((process.env.PROBE_ALLOWED_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean));
const MAX_NODES = Math.max(1, Math.min(100, Number(process.env.PROBE_MAX_NODES || 30)));
const REQUEST_TIMEOUT = Math.max(3000, Math.min(60000, Number(process.env.PROBE_REQUEST_TIMEOUT_MS || 15000)));
const RESULT_TTL = Math.max(60000, Number(process.env.PROBE_RESULT_TTL_MS || 900000));

const PROVIDERS = ["tcptest", "boce", "check-host"];
const jobs = new Map();

class HttpError extends Error {\n  constructor(message, status) { super(message); this.status = status; }\n}\n\nfunction json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!ORIGINS.has(origin)) return false;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-headers", "Authorization, Content-Type");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  return true;
}

function isPublicIpv4(host) {
  const p = host.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b,c] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

function normalizeTarget(value) {
  const target = String(value || "").trim().toLowerCase();
  if (!target || target.length > 253 || /[\s/@?#]/.test(target)) throw new Error("请输入公网 IP 或域名");
  if (/^\d+(?:\.\d+){3}$/.test(target)) {
    if (!isPublicIpv4(target) || target.split(".").some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) {
      throw new Error("仅允许规范的公网 IPv4 地址");
    }
    return target;
  }
  if (target.includes(":")) throw new Error("当前代理版本仅接受公网 IPv4 或域名，IPv6 暂不支持");
  const labels = target.split(".");
  if (labels.length < 2 || target.endsWith(".") || labels.some((label) =>
    !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new Error("域名格式不正确");
  }
  if (/\.(localhost|local|internal|lan|home|test|invalid|example)$/.test(target)) throw new Error("不允许检测内网域名");
  return target;
}

function safePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须在 1–65535 之间");
  return port;
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 16_384) throw new Error("请求体过大");
  }
  return data ? JSON.parse(data) : {};
}

async function upstream(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, headers: { accept: "application/json", ...(init.headers || {}) } });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error("第三方服务返回非 JSON 数据"); }
    if (!response.ok) throw new HttpError(payload?.error || payload?.message || `第三方服务 HTTP ${response.status}`, 502);
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new HttpError("第三方服务请求超时", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function providerReady(provider) {
  if (provider === "tcptest") return Boolean(process.env.TCPTEST_API_KEY);
  if (provider === "boce") return Boolean(process.env.BOCE_API_KEY);
  return provider === "check-host";
}

function requireProvider(provider) {
  if (!PROVIDERS.includes(provider)) throw new Error("未知检测平台");
  if (!providerReady(provider)) throw new HttpError(`${provider} 尚未配置服务端 API Key`, 503);
}

function tcptestHeaders() {
  return { authorization: `Bearer ${process.env.TCPTEST_API_KEY}`, "content-type": "application/json" };
}

async function getNodes(provider) {
  requireProvider(provider);
  if (provider === "check-host") {
    const data = await upstream("https://check-host.net/nodes/hosts");
    return Object.entries(data.nodes || {}).map(([id, node]) => ({
      id, name: id, countryCode: node.location?.[0]?.toUpperCase() || "",
      country: node.location?.[1] || "", city: node.location?.[2] || "",
      ip: node.ip || "", asn: node.asn || "", carrier: "",
    }));
  }
  if (provider === "boce") {
    const url = new URL("https://api.boce.com/v3/node/list");
    url.searchParams.set("key", process.env.BOCE_API_KEY);
    // Omit area: BOCE documents mainland as the default area.
    const data = await upstream(url);
    const source = data.data?.list ?? data.data?.nodes ?? data.data;
    const rows = Array.isArray(source) ? source : source && typeof source === "object" ? Object.entries(source).filter(([, value]) => value && typeof value === "object").map(([id, value]) => ({ id, ...value })) : [];
    return rows.map((node) => ({
      id: String(node.node_id ?? node.id ?? ""), name: String(node.node_name ?? node.name ?? ""),
      countryCode: "CN", country: "中国", city: String(node.city ?? node.ip_region ?? ""),
      ip: "", asn: "", carrier: String(node.isp ?? node.carrier ?? node.operator ?? ""),
      raw: node,
    })).filter((node) => node.id);
  }
  const data = await upstream("https://www.tcptest.cn/api/open/v1/nodes", { headers: tcptestHeaders() });
  const source = data.nodes ?? data.data?.nodes ?? data.data?.list ?? data.data;
  const rows = Array.isArray(source) ? source : source && typeof source === "object" ? Object.entries(source).filter(([, value]) => value && typeof value === "object").map(([id, value]) => ({ id, ...value })) : [];
  return rows.map((node) => ({
    id: String(node.id ?? node.node_id ?? ""), name: String(node.name ?? node.node_name ?? ""),
    countryCode: String(node.country_code ?? node.countryCode ?? ""),
    country: String(node.country ?? ""), city: String(node.city ?? node.province ?? node.region ?? ""),
    ip: "", asn: String(node.asn ?? ""), carrier: String(node.isp ?? node.carrier ?? ""),
    raw: node,
  })).filter((node) => node.id);
}

async function getQuota(provider) {
  requireProvider(provider);
  if (provider === "tcptest") {
    return await upstream("https://www.tcptest.cn/api/open/v1/quota", { headers: tcptestHeaders() });
  }
  if (provider === "boce") {
    return { available: false, message: "当前公开 API 文档未列出额度查询接口，请在 BOCE 控制台确认波点余额。" };
  }
  return { available: false, message: "Check-Host.net 公开 API 未提供可用额度接口，请遵守其公开 API 限流规则。" };
}

async function createCheck(provider, input) {
  requireProvider(provider);
  const target = normalizeTarget(input.target);
  const mode = input.mode;
  if (mode !== "ping" && mode !== "tcp") throw new Error("检测类型仅支持 ping 或 tcp");
  const port = mode === "tcp" ? safePort(input.port) : undefined;
  const count = Math.max(1, Math.min(10, Number(input.count || 4)));
  const nodeIds = Array.isArray(input.nodeIds) ? input.nodeIds.map(String).slice(0, MAX_NODES) : [];

  if (provider === "check-host") {
    const nodes = await getNodes("check-host");
    const allowed = new Set(nodes.map((n) => n.id));
    const selected = nodeIds.length ? nodeIds.filter((id) => allowed.has(id)) : nodes.filter((n) => n.countryCode === "CN").slice(0, MAX_NODES).map((n) => n.id);
    if (!selected.length) throw new Error("没有可用的探测节点");
    const url = new URL(`https://check-host.net/check-${mode === "ping" ? "ping" : "tcp"}`);
    url.searchParams.set("host", mode === "ping" ? target : `${target}:${port}`);
    url.searchParams.set("max_nodes", String(selected.length));
    for (const id of selected) url.searchParams.append("node", id);
    const result = await upstream(url);
    return { provider, mode, target, port, taskId: String(result.request_id), reportUrl: result.permanent_link || "", nodes: result.nodes || {}, createdAt: Date.now() };
  }

  if (!nodeIds.length) throw new Error("请先获取节点并选择探测节点，避免意外消耗额度");
  const providerNodes = await getNodes(provider);
  const selectedNodes = providerNodes.filter((node) => nodeIds.includes(node.id));
  const nodeMetadata = Object.fromEntries(selectedNodes.map((node) => [node.id, node]));
  if (provider === "boce") {
    const url = new URL(`https://api.boce.com/v3/task/create/${mode === "ping" ? "ping" : "tcping"}`);
    url.searchParams.set("key", process.env.BOCE_API_KEY);
    url.searchParams.set("node_ids", nodeIds.join(","));
    url.searchParams.set("host", mode === "ping" ? target : `${target}:${port}`);
    const result = await upstream(url);
    if (result.error_code !== 0 || !result.data?.id) throw new Error(result.error || "BOCE 创建任务失败");
    return { provider, mode, target, port, taskId: String(result.data.id), reportUrl: "", nodes: nodeMetadata, createdAt: Date.now() };
  }

  // TCPTest documents POST /tasks with type=ping|tcping, async task/results,
  // and Bearer authentication. Keep provider payload isolated here so the
  // documented schema can be updated without touching the shared UI.
  const result = await upstream("https://www.tcptest.cn/api/open/v1/tasks", {
    method: "POST", headers: tcptestHeaders(),
    body: JSON.stringify({ type: mode === "ping" ? "ping" : "tcping", target: mode === "ping" ? target : `${target}:${port}`, node_ids: nodeIds, count }),
  });
  const taskId = result.id ?? result.task_id ?? result.data?.id;
  if (!taskId) throw new Error(result.error || "TCPTest 未返回任务 ID");
  return { provider, mode, target, port, taskId: String(taskId), reportUrl: "", nodes: nodeMetadata, createdAt: Date.now() };
}

async function getResult(provider, taskId, mode = "ping") {
  requireProvider(provider);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) throw new Error("任务 ID 格式不正确");
  if (provider === "check-host") {
    const result = await upstream(`https://check-host.net/check-result/${encodeURIComponent(taskId)}`);
    return { provider, taskId, pending: Object.values(result).some((value) => value === null), raw: result };
  }
  if (provider === "boce") {
    const url = new URL(`https://api.boce.com/v3/task/${mode === "tcp" ? "tcping" : "ping"}/${encodeURIComponent(taskId)}`);
    url.searchParams.set("key", process.env.BOCE_API_KEY);
    const result = await upstream(url);
    return { provider, taskId, pending: result.done !== true, raw: result };
  }
  const base = `https://www.tcptest.cn/api/open/v1/tasks/${encodeURIComponent(taskId)}`;
  const [status, results] = await Promise.all([
    upstream(base, { headers: tcptestHeaders() }),
    upstream(`${base}/results`, { headers: tcptestHeaders() }),
  ]);
  return { provider, taskId, pending: !(status.done === true || status.status === "completed"), raw: { status, results } };
}

function cleanupJobs() {
  const cutoff = Date.now() - RESULT_TTL;
  for (const [key, value] of jobs) if (value.createdAt < cutoff) jobs.delete(key);
}

async function handler(req, res) {
  if (!cors(req, res)) return json(res, 403, { error: "Origin not allowed" });
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") return json(res, TOKEN ? 200 : 503, { ok: Boolean(TOKEN) });
  if (!TOKEN) return json(res, 503, { error: "代理未配置 PROBE_PROXY_TOKEN" });
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${TOKEN}`) return json(res, 401, { error: "Unauthorized" });

  try {
    if (req.method === "GET" && url.pathname === "/v1/providers") {
      return json(res, 200, { providers: PROVIDERS.map((id) => ({ id, configured: providerReady(id) })) });
    }
    const quotaMatch = url.pathname.match(/^\/v1\/providers\/([a-z-]+)\/quota$/);
    if (req.method === "GET" && quotaMatch) {
      const quota = await getQuota(quotaMatch[1]);
      return json(res, 200, { provider: quotaMatch[1], quota });
    }
    const nodesMatch = url.pathname.match(/^\/v1\/providers\/([a-z-]+)\/nodes$/);
    if (req.method === "GET" && nodesMatch) {
      const nodes = await getNodes(nodesMatch[1]);
      return json(res, 200, { provider: nodesMatch[1], nodes });
    }
    if (req.method === "POST" && url.pathname === "/v1/checks") {
      const input = await readBody(req);
      const provider = String(input.provider || "");
      const task = await createCheck(provider, input);
      const key = `${provider}:${task.taskId}`;
      jobs.set(key, task);
      cleanupJobs();
      return json(res, 202, task);
    }
    const resultMatch = url.pathname.match(/^\/v1\/checks\/([a-z-]+)\/([a-zA-Z0-9_-]+)$/);
    if (req.method === "GET" && resultMatch) {
      const [, provider, taskId] = resultMatch;
      const task = jobs.get(`${provider}:${taskId}`);
      if (!task) return json(res, 404, { error: "任务不存在或代理重启后任务记录已过期" });
      const result = await getResult(provider, taskId, task.mode);
      return json(res, 200, { ...task, ...result });
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(Number.isInteger(error?.status) ? error.status : 400, 400, { error: error instanceof Error ? error.message : "请求失败" });
  }
}

const server = http.createServer((req, res) => void handler(req, res));
server.listen(PORT, HOST, () => {
  console.log(`CFSM probe proxy listening on http://${HOST}:${PORT}`);
});
