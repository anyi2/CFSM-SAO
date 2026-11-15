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
  { name: "desktop-1000", nodes: 1000, width: 1440, height: 1000, timeout: 20_000, maxHeapMiB: 350 },
  { name: "mobile-100", nodes: 100, width: 390, height: 844, timeout: 10_000, maxHeapMiB: 250 },
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
    await page.locator("#root").waitFor({ state: "attached" });
    try {
      await page.waitForFunction(
        (target) => {
          const container = document.querySelector('[data-virtualized="true"]');
          const cards = document.querySelectorAll("[data-node-uuid]");
          return container?.getAttribute("data-total-cards") === String(target) && cards.length > 0;
        },
        scenario.nodes,
        { timeout: scenario.timeout },
      );
    } catch {
      failures.push(scenario.name + ": virtual grid did not mount its first card window");
    }

    const initial = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      cards: document.querySelectorAll("[data-node-uuid]").length,
      firstUuid: document.querySelector("[data-node-uuid]")?.getAttribute("data-node-uuid") ?? "",
      heapBytes: (performance).memory?.usedJSHeapSize ?? null,
    }));
    const elapsed = Date.now() - startedAt;
    if (initial.cards <= 0 || initial.cards >= scenario.nodes) {
      failures.push(scenario.name + ": expected a virtualized subset, rendered " + initial.cards + " cards");
    }
    if (elapsed > scenario.timeout) failures.push(scenario.name + ": first window exceeded time budget");
    if (initial.document > initial.viewport + 24) failures.push(scenario.name + ": horizontal overflow");
    if (initial.heapBytes != null && initial.heapBytes / 1024 / 1024 > scenario.maxHeapMiB) {
      failures.push(scenario.name + ": JS heap exceeded " + scenario.maxHeapMiB + " MiB");
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    try {
      await page.waitForFunction((previousFirstUuid) => {
        const firstUuid = document.querySelector("[data-node-uuid]")?.getAttribute("data-node-uuid") ?? "";
        return Boolean(firstUuid) && firstUuid !== previousFirstUuid;
      }, initial.firstUuid, { timeout: 10_000 });
    } catch {
      failures.push(scenario.name + ": scrolling did not mount a different card window");
    }

    const bottom = await page.evaluate(() => ({
      cards: document.querySelectorAll("[data-node-uuid]").length,
      scrollTop: window.scrollY,
      documentHeight: document.documentElement.scrollHeight,
      heapBytes: (performance).memory?.usedJSHeapSize ?? null,
    }));
    if (bottom.cards <= 0 || bottom.cards >= scenario.nodes) {
      failures.push(scenario.name + ": bottom window is not virtualized (" + bottom.cards + " cards)");
    }
    if (pageErrors.length) failures.push(scenario.name + ": " + pageErrors.join(" | "));
    if (missingAssets.length) failures.push(scenario.name + ": failed dev assets " + missingAssets.join(", "));

    console.log(JSON.stringify({
      scenario: scenario.name,
      requestedNodes: scenario.nodes,
      initiallyRenderedCards: initial.cards,
      bottomRenderedCards: bottom.cards,
      firstWindowMs: elapsed,
      initialHeapMiB: initial.heapBytes == null ? null : Math.round(initial.heapBytes / 1024 / 1024),
      bottomHeapMiB: bottom.heapBytes == null ? null : Math.round(bottom.heapBytes / 1024 / 1024),
      scrollTop: bottom.scrollTop,
      documentHeight: bottom.documentHeight,
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
