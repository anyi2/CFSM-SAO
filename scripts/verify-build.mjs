import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist");
const indexPath = resolve(dist, "index.html");
const assetsPath = resolve(dist, "assets");

function fail(message) {
  console.error(`[verify-build] FAIL: ${message}`);
  process.exitCode = 1;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      fail(`不允许构建产物包含符号链接：${relative(dist, path)}`);
      return [];
    }
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

function verifyReference(reference, sourceFile) {
  const value = reference.trim();
  if (
    !value ||
    value.startsWith("#") ||
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) return;

  // Absolute root paths such as /favicon.ico belong to the CFSM host shell, not this theme ZIP.
  // Root-relative /assets/* is still treated as a theme asset and must exist in dist.
  let target;
  try {
    if (value.startsWith("/")) {
      if (!value.startsWith("/assets/")) return;
      target = resolve(dist, value.slice(1));
    } else {
      target = fileURLToPath(new URL(value, pathToFileURL(sourceFile)));
    }
  } catch {
    fail(`无法解析资源引用：${value}（来源：${relative(dist, sourceFile)}）`);
    return;
  }
  const rel = relative(dist, target);
  if (rel.startsWith(`..${sep}`) || rel === "..") {
    fail(`资源引用越出 dist 目录：${value}`);
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    fail(`引用的本地资源不存在：${value}（来源：${relative(dist, sourceFile)}）`);
  }
}

if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
  fail("缺少 dist/index.html");
}
if (!existsSync(assetsPath) || !statSync(assetsPath).isDirectory()) {
  fail("缺少 dist/assets/");
}

if (existsSync(indexPath) && existsSync(assetsPath)) {
  const topLevel = readdirSync(dist).sort();
  const unexpected = topLevel.filter((name) => !["index.html", "assets"].includes(name));
  if (unexpected.length) fail(`dist 顶层出现未允许的内容：${unexpected.join(", ")}`);

  const html = readFileSync(indexPath, "utf8");
  if (!/<script[^>]+type=["']module["'][^>]+src=/i.test(html)) {
    fail("index.html 未引用 ES module 入口脚本");
  }
  const htmlRefs = /(?:src|href)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(htmlRefs)) verifyReference(match[1], indexPath);

  const outputFiles = walk(dist);
  const assetFiles = outputFiles.filter((path) => path.startsWith(assetsPath + sep));
  if (!assetFiles.length) fail("dist/assets/ 为空");

  for (const file of assetFiles.filter((path) => path.endsWith(".css"))) {
    const css = readFileSync(file, "utf8");
    const urls = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
    for (const match of css.matchAll(urls)) verifyReference(match[1], file);
  }

  for (const file of assetFiles.filter((path) => path.endsWith(".js"))) {
    const js = readFileSync(file, "utf8");
    const imports = /(?:from\s*|import\s*\()["']([^"']+\.js(?:\?[^"']*)?)["']/g;
    for (const match of js.matchAll(imports)) verifyReference(match[1], file);
  }

  console.log(`[verify-build] OK: ${assetFiles.length} assets，HTML/CSS/JS 本地引用均已检查`);
}

if (process.exitCode) process.exit(process.exitCode);
