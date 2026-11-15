import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const archiveName = `CFSM-Theme-SAO-v${pkg.version}.zip`;
const archivePath = resolve(root, archiveName);

for (const required of ["index.html", "assets"]) {
  if (!existsSync(resolve(dist, required))) {
    throw new Error(`缺少 dist/${required}，请先构建主题`);
  }
}

const result = spawnSync(
  "zip",
  ["-q", "-r", archivePath, "index.html", "assets"],
  { cwd: dist, stdio: "inherit" },
);
if (result.error || result.status !== 0) {
  throw new Error(
    `创建 ZIP 失败。Linux/macOS 请安装 zip 命令；Windows 请在 Git Bash/WSL 中执行。详情：${result.error?.message ?? `exit ${result.status}`}`,
  );
}
if (!existsSync(archivePath) || statSync(archivePath).size === 0) {
  throw new Error("ZIP 安装包未生成或文件为空");
}
console.log(`[package] 已生成 ${archiveName}（仅包含 CFSM 主题所需的 index.html 与 assets/）`);
