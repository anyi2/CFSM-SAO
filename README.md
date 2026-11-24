# Anyi2 CFSM-SAO

<p>
  <a href="https://github.com/anyi2/CFSM-SAO/actions/workflows/build-theme.yml"><img src="https://github.com/anyi2/CFSM-SAO/actions/workflows/build-theme.yml/badge.svg?branch=main" alt="Build theme"></a>
  <img src="https://img.shields.io/badge/version-v2026.11.19-blue" alt="Version v2026.11.19">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
  <a href="https://github.com/WAOR/CFSM-SAO"><img src="https://img.shields.io/badge/upstream-WAOR%2FCFSM--SAO-64748b" alt="Upstream WAOR CFSM-SAO"></a>
</p>

**面向 [CF-Server-Monitor（CFSM）](https://github.com/huilang-me/CF-Server-Monitor) 的 SAO 系列第三方主题分支。**

Anyi2 基于 [WAOR/CFSM-SAO](https://github.com/WAOR/CFSM-SAO) 持续维护，在保留 SAO 主题视觉与交互体系的基础上，针对 CFSM 的节点详情、路由、数据展示、大规模节点性能和网络诊断进行适配与增强。本项目不是 CFSM 服务端，也不包含探针 Agent。

<p align="center">
  <img src="./preview.png" alt="Anyi2 CFSM-SAO 主题预览" width="100%">
</p>

<p align="center">
  <a href="#功能概览">功能概览</a> ·
  <a href="#预览">界面预览</a> ·
  <a href="#安装与更新">安装与更新</a> ·
  <a href="#网络诊断与隐私">网络诊断与隐私</a> ·
  <a href="#本地开发">本地开发</a> ·
  <a href="#参与贡献">参与贡献</a>
</p>

---

## 目录

- [功能概览](#功能概览)
- [预览](#预览)
- [安装与更新](#安装与更新)
- [网络诊断与隐私](#网络诊断与隐私)
- [兼容性与功能边界](#兼容性与功能边界)
- [本地开发](#本地开发)
- [质量检查与发布](#质量检查与发布)
- [参与贡献](#参与贡献)
- [上游项目与致谢](#上游项目与致谢)
- [许可证](#许可证)

## 功能概览

### SAO 主题体验（继承自上游）

- **深浅色外观：** 透白磨砂与通透卡片风格，适配桌面和移动设备。
- **两种集群视图：**「趋势大盘」用于快速观察集群概况；「方格矩阵」用于高密度浏览大量节点。
- **指标可视化：** 服务器状态卡片、实时指标微图、带宽与流量展示。
- **自定义能力：** 指标卡片池与排序、主题配色、带宽评级徽章、点阵图案和开屏动效等。
- **响应式设置：** 主题管理界面适配窄屏和触屏操作。

### Anyi2 的 CFSM 适配与增强

- **节点详情页重整：** 优化 CPU、内存、Swap、磁盘、网络、周期流量和配额等信息的组织与窄屏布局。
- **主机名详情路由：** 支持 `/#/s/<主机名>`，同时兼容 UUID 详情入口；监控数据请求仍使用 CFSM 原始节点 ID。
- **历史数据导出：** 支持负载和 Ping 历史 CSV 导出，并处理缺失字段、异常样本及表格公式注入风险。
- **隐藏节点规则统一：** 后端标记为隐藏的节点，对登录用户和未登录访客使用相同的隐藏规则；首页列表、集群统计、节点切换器和详情入口保持一致。
- **大规模节点性能：** 首页节点网格采用虚拟渲染，减少大量节点同时挂载带来的页面开销。
- **连接与数据稳定性：** 改善 WebSocket 长断线恢复、Ping 数据缓存和旧版独立 Ping 设置兼容；对缺失或无效指标样本进行边界处理，避免把未知数据误显示为真实的零值。
- **跨区域三协议检测：** 登录管理员可手动发起 ICMP、TCP、UDP 检测，并在统一结果矩阵查看中国电信、联通、移动以及日本、香港、美国的探测结果。

> 功能依赖 CFSM 后端实际提供的数据和接口。主题只负责前端展示与交互，不替代 CFSM 后端，也不会为后端未提供的数据造值。

## 预览

### 桌面端

| 深色模式 · 方格矩阵 | 浅色模式 · 趋势大盘 |
|:---:|:---:|
| <img src="./docs/images/dark+EVA配色+方格矩阵.png" alt="深色模式方格矩阵" width="100%"> | <img src="./docs/images/light+经典标准配色+趋势大盘.png" alt="浅色模式趋势大盘" width="100%"> |

### 设置与移动端

| 指标卡片设置 | 移动端方格矩阵 |
|:---:|:---:|
| <img src="./docs/images/SAO指标卡池.png" alt="SAO 指标卡片池" width="100%"> | <img src="./docs/images/移动端+EVA配色+方块矩阵%20呈现效果.png" alt="移动端方格矩阵" width="100%"> |

<p align="center">
  <img src="./docs/images/移动端%20主题设置.png" alt="移动端主题设置" width="68%">
</p>

[查看主题动态演示](https://github.com/user-attachments/assets/0540209f-442d-4977-b872-ff04821e0843)。

## 安装与更新

### 通过 CFSM 自定义主题 URL 安装（推荐）

1. 登录 CFSM 管理后台，打开主题管理中提供的自定义主题 URL 配置。
2. 填入本项目的正式发布地址：

   ```text
   https://github.com/anyi2/CFSM-SAO/tree/dist
   ```

3. 保存并按照 CFSM 的主题加载流程启用。

**请使用 `dist` 分支，不要使用 `main`。** `main` 保存开发源码；`dist` 是 GitHub Actions 自动生成的可加载静态主题文件。

### 固定到指定版本

如需固定在某个版本，避免跟随 `dist` 后续更新，可将 `dist` 替换为该发布提交的完整 Commit SHA：

```text
https://github.com/anyi2/CFSM-SAO/tree/<commit-sha>
```

发布分支会保留历史构建提交，可用于锁定版本和回退。更新内容见 [CHANGELOG.md](./CHANGELOG.md)。

### 网络诊断模块的 CSP 配置

网络诊断通过浏览器直接请求 Globalping 公共 API。如果 CFSM 的内容安全策略（CSP）阻止了请求，请在 CFSM 管理后台的 **CSP API domains** 允许列表中加入：

```text
https://api.globalping.io
```

该配置只用于放行网络诊断 API，不是主题安装地址。未启用或无法访问 Globalping 时，主题的其他页面功能不受此配置影响。

## 网络诊断与隐私

网络检测是可选的管理员手动操作，不会在后台定时扫描，也不会由主题自动重复提交检测任务。

- **请求方式：** 浏览器直接连接 Globalping，不需要自行部署代理、Worker 或填写共享 API Key。
- **目标数据：** 管理员点击检测后，目标公网 IPv4、TCP/UDP 目标端口及探测参数会提交给 Globalping，由其全球探针执行测量。
- **可见性：** Globalping 测量及其目标信息可能通过测量记录或测量 ID 被查询。请只检测自己拥有或获准检测的公网目标，不要提交密码、访问令牌、内网地址或其他机密。
- **探测范围：** 每种协议最多选择中国电信、联通、移动各一个探针，以及日本、香港、美国各一个探针；实际数量取决于当时在线的探针。
- **UDP 结果：** UDP 使用 Globalping 的 MTR 路径探测。路径节点有响应不代表目标 UDP 服务端口开放；无响应也不能单独证明端口关闭。
- **额度：** Globalping 的匿名使用额度和探针覆盖情况由服务提供方控制，可能变化；主题会读取接口返回的当前额度信息，不在代码中嵌入共享凭据。

网络检测的请求流程、探针选择、额度处理和结果解释见 [NETWORK_PROBE_IMPLEMENTATION.md](./docs/NETWORK_PROBE_IMPLEMENTATION.md)。

## 兼容性与功能边界

- 本项目是 **CFSM 前端主题**，不是独立监控平台；使用前需要先部署并正常运行 [CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor)。
- 主题需要 CFSM 提供相应的主题加载能力和后端 API。不同 CFSM 版本或后端配置可能影响个别数据项的可用性。
- 管理员网络诊断需要有效登录状态；普通访客不会看到该管理工具。
- 主机名路由是主题提供的前端入口，不会改变 CFSM 后端保存的节点 ID 或数据结构。

遇到数据缺失时，请先确认 CFSM 后端本身是否提供对应字段，再反馈主题问题。

## 本地开发

### 环境要求

- Node.js 22
- npm（随 Node.js 安装）

### 获取源码并启动

```bash
git clone https://github.com/anyi2/CFSM-SAO.git
cd CFSM-SAO
npm ci
npm run dev
```

Vite 启动后，使用终端输出的本地地址访问。

如需在本地连接自己的 CFSM 后端，可在本地创建被 Git 忽略的 `.env.local`：

```dotenv
API_BASE=https://your-cfsm.example
```

请将示例地址替换成自己的 CFSM API 基址。不要把真实环境配置、账号密码、JWT、API Key 或其他凭据提交到 Git。

### 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动本地开发服务器 |
| `npm run build` | 执行类型检查并构建主题 |
| `npm run package` | 构建、校验并生成 ZIP 安装包 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 检查 |
| `npm test` | 运行 Vitest 单元测试 |
| `npm run verify:build` | 校验主题构建目录及资源引用 |

### 项目结构

```text
.
├── .github/workflows/   # CI、构建与发布工作流
├── docs/                # 功能说明和界面截图
├── scripts/             # 构建校验、打包、浏览器及性能检查
├── src/                 # React / TypeScript 源码
├── CHANGELOG.md         # 更新日志
├── VERSIONING.md        # 版本号策略
├── LICENSE              # 许可证
└── README.md
```

## 质量检查与发布

向 `main` 提交 Pull Request 时，仓库 CI 会执行：

- TypeScript 类型检查、ESLint 和 Vitest 单元测试。
- 生产构建、构建目录检查与 ZIP 包完整性验证。
- Playwright 桌面端和移动端浏览器冒烟测试。
- 大规模节点场景的性能冒烟测试。
- 当前版本更新日志检查。

PR 合并到 `main` 后，GitHub Actions 会构建静态主题并发布到 `dist`。该分支是自动生成的发布产物，请勿手工修改。

## 参与贡献

欢迎通过 Fork 和 Pull Request 参与改进。

提交前请：

1. 说明 CFSM 版本、浏览器、复现步骤和预期结果；必要时提供经过脱敏的截图。
2. 为行为变更补充或更新测试。
3. 更新 `CHANGELOG.md` 中与 `package.json` 当前版本对应的条目。仓库 CI 会检查该要求。
4. 不要在公开 PR、截图或日志中提交服务器 IP、域名、密码、JWT、API Key、Cookie 或其他私人信息。
5. 在本地运行相关检查，并确保 PR 的 CI 全部通过。

### 安全问题

请勿在公开讨论中发布可复用的凭据、完整访问令牌或包含私人基础设施信息的日志。涉及认证、隐私或潜在凭据泄露的问题，请先联系项目维护者，再决定是否公开技术细节。

## 上游项目与致谢

本仓库是基于开源项目持续维护的衍生版本，感谢原作者及相关社区：

- **直接上游：** [WAOR/CFSM-SAO](https://github.com/WAOR/CFSM-SAO) —— SAO 系列 CFSM 主题的直接来源。
- **SAO 系列其他平台：** [WAOR/Komari-Theme-SAO](https://github.com/WAOR/Komari-Theme-SAO)、[WAOR/Monitor-SAO](https://github.com/WAOR/Monitor-SAO)。
- **相关主题与移植探索：** [stqfdyr/komari-theme-Lumina](https://github.com/stqfdyr/komari-theme-Lumina)、[shanyang242/Komari-Theme-LuminaPlus](https://github.com/shanyang242/Komari-Theme-LuminaPlus)、[volcano-1025/CFSM-Theme-LuminaPlus](https://github.com/volcano-1025/CFSM-Theme-LuminaPlus)、[guboysky/LuminaPlus](https://github.com/guboysky/LuminaPlus)。
- **监控平台及生态：** [CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor)、[Komari](https://github.com/komari-monitor/komari) 和 [monitor-probe/monitor](https://github.com/monitor-probe/monitor)。

感谢所有上游作者、贡献者和开源社区。上游代码、第三方依赖和素材的版权及许可仍以各自仓库中的声明为准。

## 许可证

本项目按照仓库中的 [MIT License](./LICENSE) 发布。复制、修改或再分发时，请保留许可证文本及其中适用的版权声明，并遵守第三方依赖和素材各自的许可要求。
