# CFSM 跨区域三协议网络检测（Globalping）

## 目标

管理员在实例详情页只需点击一次“开始三协议检测”，同时发起 ICMP、TCP、UDP 三项检测，并把三种协议结果合并显示在同一张对照表中。检测目标为当前 VPS 的公网 IPv4；大陆电信、联通、移动各一个探针，海外日本、香港、美国各一个探针。每个地区只占一行，三列分别呈现 ICMP、TCP、UDP 的状态与 RTT，不再切换协议页面。

只检测管理员点击提交的单次任务；不做定时巡检、后台扫描或自动重试任务。

## 运行结构

- CFSM-SAO 是静态主题，直接从浏览器调用 Globalping 公共 API。
- 不需要自建 Node.js Proxy、Cloudflare Worker、平台 API Key 或额外 VPS。
- API 根地址：https://api.globalping.io/v1
- 每次点击只读取一次 GET /probes，取得当前在线探针。
- Globalping 每个 measurement 只能指定一种协议，因此先创建 ICMP 基准 measurement，再将它返回的 measurement ID 作为 TCP、UDP 请求的 locations 值，要求 API 复用完全相同的探针组。
- ICMP 基准任务创建失败时，TCP / UDP 对非 429 错误会独立选点兜底；若基准请求已经触发 HTTP 429，则不再追加两个创建请求，避免继续放大限流。
- 三项任务分别轮询，单项失败不会清除另外两项已收到的结果；创建后的额度响应头和 GET /limits 查询用于更新额度显示。
- Globalping 官方允许浏览器跨域请求（CORS *）。匿名使用不需要认证。

## 探针筛选与去重

| 目标 | 选择规则 | 每种协议最多 |
|---|---|---:|
| 中国电信 | country=CN + AS4134；优先 eyeball-network | 1 |
| 中国联通 | country=CN + AS4837；优先 eyeball-network | 1 |
| 中国移动 | country=CN + AS9808；优先 eyeball-network | 1 |
| 日本 | country=JP；有数据中心探针时优先该类型 | 1 |
| 香港 | country=HK；有数据中心探针时优先该类型 | 1 |
| 美国 | country=US；有数据中心探针时优先该类型 | 1 |

每项 measurement 的每个位置使用 limit: 1，单种协议计划最多六个探针。三种协议合计最多 18 次 probe tests。第一次 ICMP measurement 完成探针选取后，TCP 与 UDP 传入该 measurement ID 来复用相同探针组，API 会保持探针顺序；测试类型和 measurementOptions 仍由新请求分别指定。复用 ID 只在原 measurement 有效期间可用，过期或无效 ID 会返回 422。若探针在在线清单读取后离线，实际结果可能少于六条。

大陆某运营商没有 eyeball-network 时，回退同 ASN 的其他在线探针，并准确标注探针类型。海外国家也只在当时存在在线探针时加入任务，不以新加坡或德国替代日本、香港、美国。

前端把结果合并成一张地区对照表：每个大陆 ASN 或海外国家仅占一行，ICMP / TCP / UDP 分别作为列。结果解析层按运营商 ASN 或国家代码归并去重，防止 API 意外返回重复探针时重复展示。

## 一次点击的执行流程

1. 校验目标公网 IPv4 和 TCP/UDP 共用端口。
2. 读取一次 Globalping 在线探针清单，并更新大陆三网覆盖数量。
3. 先提交 ICMP 基准任务；成功后把其 measurement ID 传给 TCP 和 UDP，使两项协议复用相同探针。
4. TCP 和 UDP 并行提交；若 ICMP 基准任务因非 429 错误失败，则两项独立提交，若基准任务遇到 429 则停止继续创建。
5. 三项任务并行轮询，把各协议结果按运营商/地区 ID 合并显示；单个任务失败不会抹除其他结果。
6. 每项请求开启 inProgressUpdates，以 1 秒间隔轮询，最多 45 轮；超过窗口的任务标记等待超时，不自动重新提交。

TCP 与 UDP 共用界面中填写的同一个目标端口；ICMP 不需要端口。为了让一次点击能完整执行三项检测，TCP/UDP 端口必须填写且范围为 1–65535。

## 协议实现

| 界面列 | Globalping 测量 | 端口 | 结果含义 |
|---|---|---|---|
| ICMP | type: ping + protocol: ICMP | 不需要 | ICMP Echo 连通性和 RTT |
| TCP | type: ping + protocol: TCP | 指定目标端口 | TCP 响应、拒绝/重置或无响应 |
| UDP | type: mtr + protocol: UDP | 指定目标端口 | UDP 路径节点响应、不可达提示和路径 RTT |

重要说明：

- Globalping ping API 的协议枚举仅支持 ICMP、TCP，不支持 UDP。
- Globalping 的 MTR 协议枚举支持 ICMP、TCP、UDP；本模块用 MTR 的 UDP 模式实现 UDP 路径探测。
- UDP 路径上的路由节点响应不等于目标 UDP 服务端口已开放；没有响应也不一定是端口关闭，防火墙和路由器可能静默丢弃 UDP。界面明确显示这一限制，不把 MTR 中间跳响应冒充 UDP 服务端口成功。
- ICMP 无响应不代表 TCP/UDP 端口不可用；TCP 明确拒绝/重置与超时含义不同。
- 三种协议每次均发送 3 个包/每跳，结果由 Globalping 在线探针执行。

## 请求额度与行为

- 当前主题采用匿名直接调用，不嵌入共享 API Key。Globalping 当前列明匿名来源每小时 250 次 probe tests，单次 measurement 最多 50 个探针；注册用户 API token 为每小时 500 次、单次最多 500 个探针，但本主题未配置该 token。
- 每个探针对一次 measurement 的执行计为一次 probe test。每次点击最多创建三项 measurement，每项最多六个探针，合计最多 18 次 probe tests；按额度理论值计算，同一出口 IP 每小时约可完成 13 次满六地区的完整三协议检测（实际消耗随在线探针数变化）。
- GET /probes 与 GET /limits 不消耗 probe-test 额度；GET /limits 用于显示当前额度类型、总额、剩余数和重置秒数。界面提供手动刷新额度。
- 创建 measurement 的响应头提供 X-RateLimit-Limit、X-RateLimit-Remaining、X-RateLimit-Reset 等信息；HTTP 429 时解析额度响应头，读取 Retry-After 时显示建议等待时间。浏览器能否直接读取响应头受 CORS expose headers 影响；GET /limits 作为当前额度的权威查询补充。
- 每个 measurement 的结果 GET 请求按 1 秒间隔轮询，低于官方每个 measurement 每秒最多 2 次的频率上限；最多轮询 45 轮，以覆盖探针端最长 30 秒执行时限及结果回传时间。
- 开启 inProgressUpdates=true 后，API 可在任务运行中返回部分结果；官方说明最多前五项测试结果会实时更新。
- 公开测量及目标信息可能被他人通过测量 ID 查看；只提交公网 IP 和端口，不要发送密码、令牌或其他机密数据。

额度、探针在线情况和可用地域可能变化。桌面端保留三协议对照表，窄屏改用按地区分组的三协议卡片。前端处理 HTTP 429、无匹配探针和服务错误，并保留 AntPing 备用入口。

官方接口规范：
- API / OpenAPI：https://github.com/jsdelivr/globalping/blob/master/public/v1/spec.yaml
- MTR 协议枚举及参数：https://github.com/jsdelivr/globalping/blob/master/public/v1/components/schemas.yaml
- 项目说明与使用限制：https://github.com/jsdelivr/globalping
- 在线探针与服务：https://globalping.io/

## 结果解释

- ICMP 有响应：探针收到 ICMP Echo 响应；无响应不等同于 TCP/UDP 端口不可用。
- TCP 有响应：探针收到 TCP 响应；目标明确拒绝/重置与超时分别显示，不能把拒绝标记为区域封禁。
- UDP 路径有响应：MTR UDP 探测收到一个或多个路径节点响应；不代表目标 UDP 服务端口已开放。
- UDP 未收到路径响应：可能是目标或中间网络静默丢弃 UDP、路由异常、目标离线或探针限制，不能据此断定端口关闭。
- 大陆探针优先使用家庭/企业宽带；回退数据中心探针时在对应协议单元格中标注。
- 单个协议失败不影响其余协议结果显示。
- 应结合不同协议、三家运营商、海外对照、服务器本机监听和防火墙规则复测。

## 验收范围

- [x] 一次点击发起 ICMP、TCP、UDP 三项 measurement；TCP / UDP 复用 ICMP 基准任务选中的同一组探针。
- [x] 开启 inProgressUpdates，按 1 秒间隔轮询，最多 45 轮。
- [x] 桌面三协议对照表与移动端地区卡片呈现结果。
- [x] 每次只读取一次在线探针清单。
- [x] 每种协议大陆电信、联通、移动各最多一个探针。
- [x] 每种协议海外只选择日本、香港、美国，各最多一个探针。
- [x] 每种协议请求层 limit=1，结果层按运营商/国家再次去重。
- [x] 单项协议失败不会清除其余协议结果。
- [x] 大陆家庭/企业宽带探针优先；无此类节点时回退并标注探针类型。
- [x] ICMP 不需要端口；TCP、UDP 共用一个有效目标端口。
- [x] 明确说明 UDP 路径响应不代表服务端口开放。
- [x] 额度卡片读取 /limits，支持手动刷新；429 错误解析额度与重置提示。
- [x] 不定时、不后台、不自动重跑。
- [x] AntPing 网页复核链接。
- [ ] 在用户的 CFSM 实际环境完成三项协议同批次真实端到端测试；Globalping 探针覆盖和运营商表现以使用时 API 实时返回为准。
