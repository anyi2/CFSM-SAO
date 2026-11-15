import { createRequire } from "node:module";
import { realpathSync } from "node:fs";

const playwrightBin = process.env.PLAYWRIGHT_BIN;
if (!playwrightBin) throw new Error("PLAYWRIGHT_BIN 未设置：请先通过 npx 临时获取 Playwright CLI");
const playwrightCli = realpathSync(playwrightBin);
const requirePlaywright = createRequire(playwrightCli);
const { chromium } = requirePlaywright("./index.js");

const baseUrl = process.env.SMOKE_URL || "http://127.0.0.1:4173/";
const browserInstance = await chromium.launch({ headless: true });
const failures = [];

try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const page = await browserInstance.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    const pageErrors = [];
    const missingAssets = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith("/assets/") && response.status() >= 400) missingAssets.push(`${response.status()} ${url.pathname}`);
    });
    await page.route("**/api/**", (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "browser smoke test: backend intentionally unavailable" }),
    }));
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached" });
    await page.waitForTimeout(900);
    const mounted = await page.locator("#root").evaluate((element) => element.childElementCount > 0);
    if (!mounted) failures.push(`${viewport.name}: React root 未挂载`);

    const detailUrl = new URL(baseUrl);
    detailUrl.hash = "/s/CFSM-SMOKE-NODE";
    await page.goto(detailUrl.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);

    const retiredRouteUrl = new URL(baseUrl);
    retiredRouteUrl.hash = "/compare";
    await page.goto(retiredRouteUrl.toString(), { waitUntil: "domcontentloaded" });
    try {
      await page.getByText("页面未找到", { exact: true }).waitFor({ timeout: 5_000 });
    } catch {
      failures.push(`${viewport.name}: 已移除的多节点对比路由未回退至 404`);
    }

    if (pageErrors.length) failures.push(`${viewport.name}: 页面运行异常：${pageErrors.join(" | ")}`);
    if (missingAssets.length) failures.push(`${viewport.name}: 静态资源加载失败：${missingAssets.join(", ")}`);
    const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    if (dimensions.document > dimensions.viewport + 24) failures.push(`${viewport.name}: 页面存在明显横向溢出（${dimensions.document}px > ${dimensions.viewport}px）`);
    console.log(`[browser-smoke] ${viewport.name}: root, detail and retired route checked`);
    await page.close();
  }
} finally {
  await browserInstance.close();
}
if (failures.length) {
  for (const failure of failures) console.error(`[browser-smoke] FAIL: ${failure}`);
  process.exit(1);
}
console.log("[browser-smoke] OK");
