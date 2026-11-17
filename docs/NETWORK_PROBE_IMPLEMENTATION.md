# CFSM 跨区域网络检测（Globalping）

## 目标

管理员在实例详情页手动检测当前 VPS 的公网 IPv4，支持 ICMP、TCP、UDP 三种协议。检测位置固定为中国电信、联通、移动各一个在线探针，以及日本、香港、美国各一个在线探针；同一运营商/国家只保留一条结果，不重复展示。只检测管理员点击提交的单次任务；不做定时巡检、后台扫描或自动重试任务。

## 运行结构

- CFSM-SAO 是静态主题，直接从浏览器调用 Globalping 公共 API。
- 不需要自建 Node.js Proxy、Cloudflare Worker、平台 API Key 或额外 VPS。
- API 根地址：https://api.globalping.io/v1
- GET /probes 读取当前在线探针，按探针自己的 location.country 和 location.asn 统计覆盖。
- POST /measurements 创建检测；GET /measurements/{id} 轮询任务结果。
- Globalping 官方允许浏览器跨域请求（CORS *）。匿名使用不需要认证。

## 探针筛选与去重

| 目标 | 选择规则 | 每次最多 |
|---|---|---:|
| 中国电信 | country=CN + AS4134；优先 eyeball-network | 1 |
| 中国联通 | country=CN + AS4837；优先 eyeball-network | 1 |
| 中国移动 | country=CN + AS9808；优先 eyeball-network | 1 |
| 日本 | country=JP；有数据中心探针时优先该类型 | 1 |
| 香港 | country=HK；有数据中心探针时优先该类型 | 1 |
| 美国 | country=US；有数据中心探针时优先该类型 | 1 |

每个位置使用 limit: 1，因此计划上限为六个探针。在线清单只用于发现可用地点，并不能锁定具体探针唯一 ID；Globalping 不公开探针唯一 ID。若探针在在线清单读取后离线，实际结果可能少于六条。大陆某运营商没有 eyeball-network 时，回退同 ASN 的其他在线探针，并准确标注探针类型。海外国家也只在当时存在在线探针时加入任务，不以新加坡或德国替代用户指定的日本、香港、美国。

解析结果时再次按运营商 ASN 或海外国家代码归并去重，保证每个运营商/地区最多展示一行。若接口意外返回重复探针结果，会优先保留有响应的记录，其次优先家庭/企业宽带记录。

## 协议实现

| 界面选项 | Globalping 测量 | 端口 | 结果含义 |
|---|---|---|---|
| ICMP | type: ping + protocol: ICMP | 不需要 | ICMP Echo 连通性和 RTT |
| TCP | type: ping + protocol: TCP | 指定目标端口 | TCP 响应、拒绝/重置或无响应 |
| UDP | type: mtr + protocol: UDP | 指定目标端口 | UDP 路径节点响应、不可达提示和路径 RTT |

重要说明：

- Globalping ping API 的协议枚举仅支持 ICMP、TCP，不支持 UDP。
- Globalping 的 MTR 协议枚举支持 ICMP、TCP、UDP；本模块用 MTR 的 UDP 模式实现 UDP 路径探测。
- UDP 路径上的路由节点响应不等于目标 UDP 服务端口已开放；没有响应也不一定是端口关闭，防火墙和路由器可能静默丢弃 UDP。界面明确显示这一限制，不把 MTR 中间跳响应冒充 UDP 服务端口成功。
- ICMP 模式不需要端口输入；TCP、UDP 模式校验 1–65535 的目标端口。
- 三种协议每次均发送 3 个包/每跳，结果由 Globalping 在线探针执行。

## API 请求示意

TCP：

~~~json
{
  "type": "ping",
  "target": "45.67.89.10",
  "locations": [
    { "country": "CN", "asn": 4134, "tags": ["eyeball-network"], "limit": 1 },
    { "country": "CN", "asn": 4837, "limit": 1 },
    { "country": "CN", "asn": 9808, "limit": 1 },
    { "country": "JP", "limit": 1 },
    { "country": "HK", "limit": 1 },
    { "country": "US", "limit": 1 }
  ],
  "measurementOptions": {
    "protocol": "TCP",
    "port": 443,
    "packets": 3
  }
}
~~~

UDP 采用同样的 locations，但请求 type 使用 mtr，measurementOptions.protocol 为 UDP 并设置 port；ICMP 使用 type: ping、protocol: ICMP，不发送 port 字段。

## 免费额度与请求行为

- 匿名调用无需 API Key。
- 当前 API 文档列明匿名来源每小时 250 次 probe tests、单次 measurement 最多 50 个探针。
- 每个探针执行一次测量计为一次 test；本模块每次最多请求六个探针。
- 单个 measurement 结果轮询采用 2 秒间隔，不超过 API 文档的频率限制。
- 在线探针清单和限额查询不计入 measurement 测试额度。
- 公开测量及目标信息可能被他人通过测量 ID 查看；只提交公网 IP 和端口，不要发送密码、令牌或其他机密数据。

额度、探针在线情况和可用地域可能变化。前端处理 HTTP 429、无匹配探针和服务错误，并保留 AntPing 备用入口。

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
- 大陆探针优先使用家庭/企业宽带；回退数据中心探针时在结果中标注。
- 应结合不同协议、三家运营商、海外对照、服务器本机监听和防火墙规则复测。

## 验收范围

- [x] 前端直接调用 Globalping，不依赖独立后端。
- [x] 自动读取所选 CFSM 实例公网 IPv4；失败时可手动填写。
- [x] 只接受公网 IPv4，并校验 TCP/UDP 端口范围。
- [x] 支持 ICMP、TCP、UDP 三种协议；UDP 使用 Globalping MTR。
- [x] 每次执行前重新读取在线探针列表。
- [x] 大陆电信、联通、移动各最多选择一个探针。
- [x] 海外只选择日本、香港、美国，各最多一个探针。
- [x] 请求层 limit=1，结果层按运营商/国家再次去重。
- [x] 家庭/企业宽带探针优先；无此类节点时回退并标注探针类型。
- [x] 明确区分协议响应、拒绝/不可达、无响应和任务进行中。
- [x] 明确说明 UDP 路径响应不代表服务端口开放。
- [x] 不定时、不后台、不自动重跑。
- [x] AntPing 网页复核链接。
- [ ] 在用户的 CFSM 实际环境完成三种协议各一次真实端到端测试；Globalping 探针覆盖和运营商表现以使用时 API 实时返回为准。
