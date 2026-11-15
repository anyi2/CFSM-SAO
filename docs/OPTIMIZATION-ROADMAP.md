# Anyi2 CFSM-SAO 优化与验收路线

所有专属改动仅进入 `preview`，在线预览仅发布至 `dist-preview`。本项目不自动修改 `main` 或正式 `dist`。

## 已实现

- 项目版本锁文件与 `package.json` 对齐。
- 补齐 `npm run package`：构建并生成仅包含 `index.html` 和 `assets/` 的 ZIP 安装包。
- 构建输出验证 HTML/CSS/JS 本地资源引用，区分 CFSM 宿主资源与主题自身资源。
- Preview CI 包含 TypeScript、Lint、单元测试、生产构建、资源完整性、ZIP 完整性、Playwright 桌面/移动端冒烟测试，以及 1000 台桌面端 / 100 台移动端模拟节点压力测试。
- WebSocket 重连增加冷却期持续探测与前台恢复重连；服务端以 1008 拒绝订阅时不进行无意义重试。
- 支持系统减少动态效果偏好。
- 多节点实时快照对比（最多 5 台）。
- 详情页负载历史与 Ping 历史 CSV 导出，缺失字段留空，超时不输出负延迟，并对文本字段做表格公式注入防护。
- CFSM API JSON 响应在解析前执行 64 MiB 流式上限；错误响应另限制为 64 KiB，降低异常/恶意大载荷造成浏览器内存耗尽的风险。
- 浏览器离线通知（仅当主题页保持打开且浏览器允许通知时运行）。
- 首页分组/地区筛选支持保存为本设备本地预设；不会覆盖后台共享配置或现有卡片/排序偏好。

## 安全审计状态

2026-11-15 的 GitHub Actions npm audit 快照：14 项（9 中危、5 高危、0 严重）。Zod 3.25.76 的高危修复要求升级到 Zod 4.6.7（主版本变更）；当前保留兼容边界并增加响应大小限制，不能将此缓解描述为漏洞已修复。TypeScript ESLint 与 minimatch 的剩余中危项也需要单独评估升级路径。CI 尝试用 npm audit fix 时，Runner 的 npm 内部出现 `edgesOut` 错误；因此采用普通 `npm update --package-lock-only` 在当前 semver 范围内刷新依赖，再经完整测试，审计报告作为 Actions artifact 保存。最终以最新审计报告数字为准。

## 明确边界 / 需要后端或真实环境支持

- 浏览器关闭后持续告警（邮件、Telegram、Webhook）必须由 CFSM 服务端或独立任务服务执行，纯静态主题不具备后台监控能力。
- 多站部署若出现相同 UUID，需要服务端提供稳定的全局节点身份；前端不擅自改写服务器 ID，以免破坏历史 API 和 WebSocket。
- 大集群（80 台及以上）自动启用行级虚拟渲染；小规模保持原 DOM 布局。CI 使用开发模拟后端对 1000 台桌面端 / 100 台移动端进行合成压测，检查首屏挂载、滚动到末端、DOM 数量、内存与溢出；真实生产节点数量、浏览器设备与数据频率仍需现场测量。
- 真实 CFSM 登录、主题设置保存、不同后端版本、跨域 WebSocket、移动端触控仍需真实站点验收；API 503 冒烟测试不等于线上实测。

## 发布验收

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run verify:build`
- [ ] `npm run package` 与 ZIP 检查
- [ ] Playwright 桌面 / 移动端冒烟测试
- [ ] Preview Actions 完整成功（包括大规模节点虚拟渲染压测）
- [ ] `dist-preview` 发布 commit SHA 与 preview 源码 commit 对应
- [ ] 真实 CFSM 站点验收
