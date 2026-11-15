import { createRequire } from "node:module";
import { realpathSync } from "node:fs";

const playwrightBin = process.env.PLAYWRIGHT_BIN;
if (!playwrightBin) throw new Error("PLAYWRIGHT_BIN 未设置");
const requirePlaywright = createRequire(realpathSync(playwrightBin));
const { chromium } = requirePlaywright("./index.js");

const baseUrl = process.env.PERF_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const failures = [];

const scenarios = [
  { name: "desktop-1000", nodes: 1000, width: 1440, height: 1000, timeout: 60_000 },
  { name: "mobile-100", nodes: 100, width: 390, height: 844, timeout: 30_000 },
];

try {
  for (const scenario of scenarios) {
    const url = new URL(baseUrl);
    url.searchParams.set("mock", "1");
    url.searchParams.set("nodes", String(scenario.nodes));
    url.searchParams.set("viewMode", "compact");
    const page = await browser.newPage({
      viewport: { width: scenario.width, height: scenario.height },
      deviceScaleFactor: 1,
    });
    const pageErrors = [];
    const missingAssets = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      const requestUrl = new URL(response.url());
      if (requestUrl.pathname.includes("/src/") && response.status() >= 400) {
        missingAssets.push(String(response.status()) + " " + requestUrl.pathname);
      }
    });

    const startedAt = Date.now();
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    try {
      await page.waitForFunction(
        (target) => document.querySelectorAll(".compact-node-card").length >= target,
        scenario.nodes,
        { timeout: scenario.timeout },
      );
    } catch {
      const currentCount = await page.locator(".compact-node-card").count();
      failures.push(
        scenario.name + ": expected " + scenario.nodes + " cards, rendered " + currentCount,
      );
    }

    const result = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      cards: document.querySelectorAll(".compact-node-card").length,
      heapBytes: (performance).memory?.usedJSHeapSize ?? null,
    }));
    const elapsed = Date.now() - startedAt;
    if (result.cards < scenario.nodes) failures.push(scenario.name + ": card count incomplete");
    if (result.document > result.viewport + 24) failures.push(scenario.name + ": horizontal overflow");
    if (pageErrors.length) failures.push(scenario.name + ": " + pageErrors.join(" | "));
    if (missingAssets.length) failures.push(scenario.name + ": failed dev assets " + missingAssets.join(", "));
    if (elapsed > scenario.timeout) failures.push(scenario.name + ": render exceeded time budget");

    console.log(JSON.stringify({
      scenario: scenario.name,
      requestedNodes: scenario.nodes,
      renderedCards: result.cards,
      renderMs: elapsed,
      viewportWidth: result.viewport,
      documentWidth: result.document,
      heapMiB: result.heapBytes == null ? null : Math.round(result.heapBytes / 1024 / 1024),
    }));
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  for (const failure of failures) console.error("[browser-perf-smoke] FAIL: " + failure);
  process.exit(1);
}
console.log("[browser-perf-smoke] OK");
