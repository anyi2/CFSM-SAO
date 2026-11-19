# Anyi2 CFSM-SAO

**面向 [CF-Server-Monitor（CFSM）](https://github.com/huilang-me/CF-Server-Monitor) 的 SAO 系列主题分支。**  
本项目由 Anyi2 基于 [WAOR/CFSM-SAO](https://github.com/WAOR/CFSM-SAO) 继续维护，保留 SAO 主题的视觉与交互体系，并针对 CFSM 的节点详情、数据展示、路由和网络诊断进行适配与增强。

<p>
  <a href="https://github.com/anyi2/CFSM-SAO/actions/workflows/build-theme.yml"><img src="https://github.com/anyi2/CFSM-SAO/actions/workflows/build-theme.yml/badge.svg?branch=main" alt="Build theme"></a>
  <img src="https://img.shields.io/badge/version-v2026.11.19-blue" alt="Version v2026.11.17">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
</p>

<p align="center">
  <img src="./preview.png" alt="Anyi2 CFSM-SAO 主题预览" width="100%">
</p>

<p align="center">
  <a href="#功能概览">功能概览</a> ·
  <a href="#安装与更新">安装与更新</a> ·
  <a href="#开发与构建">开发与构建</a> ·
  <a href="./CHANGELOG.md">更新日志</a>
</p>

---

## 项目定位

- **适用平台：** CF-Server-Monitor（CFSM）。
- **项目性质：** SAO 系列主题的 CFSM 适配与独立维护分支，不是 CFSM 服务端，也不包含探针 Agent。
- **版本策略：** 本仓库独立使用日期版本号（CalVer，`YYYY.MM.DD`），不跟随上游版本号。
- **源码分支：** `main`。
- **主题发布分支：** `dist`，由 GitHub Actions 从源码自动构建；CFSM 自定义主题地址应指向该分支，而不是源码分支。

本仓库的功能说明会区分**继承自 SAO 上游的主题能力**与**本分支针对 CFSM 的改动**，避免将上游已有功能误标为本仓库原创。

## 功能概览

### 主题体验

- 深色与浅色模式、透白磨砂视觉和响应式布局。
- 服务器卡片、实时状态展示与指标微图。
- 两种集群视图：适合快速观察的「趋势大盘」，以及适合大规模节点的「方格矩阵」。
- 指标卡片池、卡片排序、主题配色、带宽徽章和点阵开屏效果等自定义选项。
- 面向桌面和移动端的布局适配。

### 本分支的 CFSM 增强

- **节点详情页优化：** 重组 CPU、内存、Swap、磁盘、上下行网络、周期流量和配额信息；改善窄屏下的内容排布。
- **数据有效性处理：** 区分真实的零值与缺失/无效样本，避免将缺失的负载或 GPU 数据显示成误导性的 `0`。
- **主机名详情路由：** 支持 `/#/s/<主机名>`；保留既有 UUID 路由兼容入口。主机名会解析回 CFSM 原始节点 ID，监控查询仍使用原始 ID。
- **历史数据导出：** 支持负载和 Ping 历史 CSV 下载，并对缺失字段、超时样本和表格公式注入进行处理。
- **跨区域网络诊断：** 管理员可手动一次发起 ICMP、TCP、UDP 三项 Globalping 检测，在同一结果矩阵比较中国电信、联通、移动以及日本、香港、美国的探测结果。
- **稳定性与性能：** 包含 WebSocket 长断线恢复、大规模节点列表虚拟渲染，以及构建产物、桌面/移动端页面和大集群性能的自动化检查。

> 具体能力取决于 CFSM 后端实际提供的数据与接口。主题本身不会替代 CFSM 服务端功能，也不会为后端不存在的数据造值。

## 安装与更新

### 通过 CFSM 自定义主题 URL 安装

1. 打开 CFSM 管理后台，进入主题配置中提供的**自定义主题 URL**入口。
2. 填入以下地址：

   ```text
   https://github.com/anyi2/CFSM-SAO/tree/dist
   ```

3. 保存并按 CFSM 的主题加载流程启用主题。

**请使用 `dist` 分支地址。** `main` 是开发源码，包含 TypeScript/React 工程文件，不是可直接加载的主题构建目录。

### 固定到指定版本

如需锁定版本、避免跟随 `dist` 后续更新，可将地址中的 `dist` 替换为对应的完整 Git Commit SHA：

```text
https://github.com/anyi2/CFSM-SAO/tree/<commit-sha>
```

构建产物会保留历史提交，因此固定 SHA 的地址可用于回退或复现指定版本。版本变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

### 网络诊断模块的 CSP 配置

跨区域网络诊断由浏览器直接请求 Globalping 公共 API，不需要额外部署代理、Worker、Node.js 服务或填写 API Key。

如果 CFSM 的内容安全策略（CSP）阻止了请求，请在 CFSM 管理后台的外观设置中，将以下域名加入 **CSP API domains** 允许列表：

```text
https://api.globalping.io
```

此配置只影响网络诊断模块的外部 API 访问，不是主题安装地址。

### 网络检测结果说明

- ICMP 用于连通性与 RTT 观察；ICMP 无响应不代表 TCP/UDP 服务不可用。
- TCP 使用填写的目标端口进行探测；拒绝/重置与超时是不同结果。
- UDP 使用 Globalping MTR 路径探测。**路径节点有响应不代表目标 UDP 服务端口开放；没有响应也不能单独证明端口关闭。**
- 检测由管理员手动触发，不执行定时巡检或后台自动扫描。
- Globalping 测量可能公开显示目标地址、端口及测量结果。请只提交可公开的目标信息，不要输入密码、访问令牌或其他机密。

实现细节、探针选择、请求额度和结果解释见 [跨区域三协议网络检测说明](./docs/NETWORK_PROBE_IMPLEMENTATION.md)。

## 视觉预览

### 桌面端

| 深色模式 · 方格矩阵 | 浅色模式 · 趋势大盘 |
|:---:|:---:|
| <img src="./docs/images/dark+EVA配色+方格矩阵.png" alt="深色模式方格矩阵" width="100%"> | <img src="./docs/images/light+经典标准配色+趋势大盘.png" alt="浅色模式趋势大盘" width="100%"> |

### 自定义设置与移动端

| 指标卡片设置 | 移动端方格矩阵 |
|:---:|:---:|
| <img src="./docs/images/SAO指标卡池.png" alt="指标卡片池设置" width="100%"> | <img src="./docs/images/移动端+EVA配色+方块矩阵%20呈现效果.png" alt="移动端方格矩阵" width="100%"> |

| 移动端主题设置 |
|:---:|
| <img src="./docs/images/移动端%20主题设置.png" alt="移动端主题设置" width="68%"> |

### 动态演示

[查看主题动态效果](https://github.com/user-attachments/assets/0540209f-442d-4977-b872-ff04821e0843)。

## 开发与构建

本仓库是前端主题工程，主要使用 React、TypeScript、Vite 和 Tailwind CSS。CI 使用 Node.js 22。

### 环境要求

- Node.js 22
- npm（随 Node.js 安装）

### 本地运行

```bash
git clone https://github.com/anyi2/CFSM-SAO.git
cd CFSM-SAO
npm ci
npm run dev
```

Vite 开发服务器启动后，按终端输出的本地地址访问。若需连接实际 CFSM 环境，可通过本地环境变量 `API_BASE` 指定 API 基址；不要把生产环境凭据或密钥提交到仓库。

### 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动本地开发服务器 |
| `npm run build` | 类型检查并构建生产主题 |
| `npm run package` | 构建、校验并生成主题 ZIP 安装包 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 检查 |
| `npm test` | 运行 Vitest 单元测试 |
| `npm run verify:build` | 校验构建产物结构与资源引用 |

## 项目结构

```text
.
├── .github/workflows/   # CI、主题构建与发布工作流
├── docs/                # 功能实现说明与界面截图
├── scripts/             # 构建校验、打包、浏览器冒烟及性能检查
├── src/                 # React/TypeScript 主题源码
├── CHANGELOG.md         # 版本更新记录
├── VERSIONING.md        # 日期版本号策略
├── LICENSE              # MIT 许可证
└── README.md
```

## 质量检查与发布流程

向 `main` 提交 Pull Request 时，CI 会执行：

- TypeScript 类型检查、ESLint 与 Vitest。
- 生产构建、构建目录校验和 ZIP 包完整性检查。
- Playwright 桌面/移动端浏览器冒烟测试。
- 大规模节点场景性能冒烟测试。

合并到 `main` 后，GitHub Actions 会构建主题并将可加载文件发布到 `dist`。请勿把手工修改直接提交到 `dist`；它是自动生成的发布分支。

## 参与贡献

欢迎通过 [Issues](https://github.com/anyi2/CFSM-SAO/issues) 报告问题、提出建议，或提交 Pull Request。

提交前请：

1. 尽量提供 CFSM 版本、浏览器、复现步骤和相关截图；请勿在 Issue 中公开密码、Token 或私人服务器信息。
2. 保持改动范围清晰，并为行为变更补充或更新测试。
3. 更新 `CHANGELOG.md` 当前版本（`package.json` 中的版本号）对应的条目。仓库 CI 会检查该要求。
4. 在本地运行相关检查；Pull Request 还需通过仓库 CI。

## 版本与更新日志

本仓库使用 CalVer：`YYYY.MM.DD`。版本号独立于 SAO 上游项目维护。完整规则见 [VERSIONING.md](./VERSIONING.md)，版本变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 上游项目与致谢

本项目是基于上游项目持续开发的分支。感谢原作者及相关开源社区：

- [WAOR/CFSM-SAO](https://github.com/WAOR/CFSM-SAO)：本项目直接来源与 SAO 系列 CFSM 主题上游。
- [WAOR/Komari-Theme-SAO](https://github.com/WAOR/Komari-Theme-SAO) 与 [WAOR/Monitor-SAO](https://github.com/WAOR/Monitor-SAO)：SAO 系列的其他平台版本。
- [stqfdyr/komari-theme-Lumina](https://github.com/stqfdyr/komari-theme-Lumina)、[shanyang242/Komari-Theme-LuminaPlus](https://github.com/shanyang242/Komari-Theme-LuminaPlus)、[volcano-1025/CFSM-Theme-LuminaPlus](https://github.com/volcano-1025/CFSM-Theme-LuminaPlus) 与 [guboysky/LuminaPlus](https://github.com/guboysky/LuminaPlus)：相关主题设计、移植与功能探索。
- [komari-monitor/komari](https://github.com/komari-monitor/komari)、[huilang-me/CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor) 与 [monitor-probe/monitor](https://github.com/monitor-probe/monitor)：监控平台及其开源生态。

## 许可证

本仓库按 [MIT License](./LICENSE) 发布。使用、分发或修改时，请保留许可证及适用的版权声明。
