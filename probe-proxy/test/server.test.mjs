import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 18787 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
let child;

test.before(async () => {
  child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PROBE_PROXY_TOKEN: "test-secret-token",
      PROBE_ALLOWED_ORIGINS: "https://status.example.test",
    },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("proxy did not start");
});

test.after(() => {
  child?.kill("SIGTERM");
});

test("health endpoint is available without provider credentials", async () => {
  const response = await fetch(`${origin}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("API endpoints require the proxy bearer token", async () => {
  const response = await fetch(`${origin}/v1/providers`);
  assert.equal(response.status, 401);
});

test("CORS rejects unconfigured origins", async () => {
  const response = await fetch(`${origin}/v1/providers`, {
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(response.status, 403);
});

test("private targets are rejected before dispatch", async () => {
  const response = await fetch(`${origin}/v1/checks`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-secret-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      provider: "check-host",
      mode: "ping",
      target: "127.0.0.1",
    }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /公网 IPv4/);
});

test("provider metadata defaults to the no-key public Check-Host API", async () => {
  const response = await fetch(`${origin}/v1/providers`, {
    headers: { authorization: "Bearer test-secret-token" },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const providers = Object.fromEntries(body.providers.map((provider) => [provider.id, provider]));
  assert.equal(providers["check-host"].configured, true);
  assert.equal(providers["check-host"].requiresApiKey, false);
  assert.equal(providers.tcptest.configured, false);
  assert.equal(providers.tcptest.requiresApiKey, true);
  assert.equal(providers.boce.configured, false);
  assert.equal(providers.boce.requiresApiKey, true);
});

test("metered providers do not expose node or quota requests without keys", async () => {
  for (const provider of ["tcptest", "boce"]) {
    for (const resource of ["nodes", "quota"]) {
      const response = await fetch(`${origin}/v1/providers/${provider}/${resource}`, {
        headers: { authorization: "Bearer test-secret-token" },
      });
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /API Key/);
    }
  }
});

test("Check-Host checks require an explicit node selection", async () => {
  const response = await fetch(`${origin}/v1/checks`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-secret-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ provider: "check-host", mode: "ping", target: "8.8.8.8", nodeIds: [] }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /选择.*探测节点/);
});

test("provider tasks are rate-limited per target", async () => {
  const send = () => fetch(`${origin}/v1/checks`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-secret-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ provider: "check-host", mode: "ping", target: "9.9.9.9", nodeIds: [] }),
  });
  const first = await send();
  const second = await send();
  assert.equal(first.status, 400);
  assert.equal(second.status, 429);
});
