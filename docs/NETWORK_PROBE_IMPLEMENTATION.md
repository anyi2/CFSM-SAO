# CFSM 大陆 TCP 端口检测（Globalping）

## 目标

管理员在实例详情页手动检测当前 VPS 的公网 IPv4 和指定 TCP 端口，从中国电信、联通、移动的在线探针发起 TCP Ping，并使用海外节点作对照。只检测管理员点击提交的单次任务；不做定时巡检、后台扫描或自动重试任务。

## 运行结构

- CFSM-SAO 是静态主题，直接从浏览器调用 Globalping 公共 API。
- 不需要自建 Node.js Proxy、Cloudflare Worker、平台 API Key 或额外 VPS。
- API 根地址：https://api.globalping.io/v1
- GET /probes 读取当前在线探针，按探针自己的 location.country 和 location.asn 统计覆盖。
- POST /measurements 创建检测；GET /measurements/{id} 轮询任务结果。
- Globalping 官方允许浏览器跨域请求（CORS *）。匿名使用不需要认证。

## 探针筛选

| 线路 | ASN | 请求筛选 |
|---|---:|---|
| 中国电信 | AS4134 | country=CN + asn=4134 |
| 中国联通 | AS4837 | country=CN + asn=4837 |
| 中国移动 | AS9808 | country=CN + asn=9808 |

每家运营商最多请求两个探针。若该 ASN 下存在 eyeball-network（家庭/企业宽带）探针，优先只选这些探针；否则回退到该 ASN 下当前在线的其他探针，并在结果中显示探针类别。海外对照从在线探针中依次选择日本、新加坡、美国、德国，最多两个地点。

Globalping 不公开探针唯一 ID，使用国家、ASN、tags、limit 进行筛选；实际执行数量可能少于请求数量。探针在线情况随社区设备状态动态变化，主题每次手动检测前重新读取在线清单。若三家运营商均无匹配探针，不提交伪造结果，而是提示使用 AntPing 手动复核。

## API 请求

示意请求（探针地点数量由每次实时在线清单动态计算）：

~~~json
{
  "type": "ping",
  "target": "45.67.89.10",
  "locations": [
    { "country": "CN", "asn": 4134, "tags": ["eyeball-network"], "limit": 2 },
    { "country": "CN", "asn": 4837, "limit": 2 },
    { "country": "CN", "asn": 9808, "limit": 2 },
    { "country": "JP", "limit": 1 },
    { "country": "SG", "limit": 1 }
  ],
  "measurementOptions": {
    "protocol": "TCP",
    "port": 443,
    "packets": 3
  }
}
~~~

TCP 检测使用 Globalping 的 type: ping + measurementOptions.protocol: TCP + port，不是 ICMP Ping。

## 免费额度

根据 Globalping 官方 API 文档（2026-11-17 核验）：

- 匿名调用无需 API Key。
- 每个来源 IP 每小时最多 250 个探测测试。
- 单次测量最多 50 个探针。
- 每个探针执行一次测量计为一个测试；每次 CFSM 检测按当前在线探针数消耗额度。
- 单个测量结果按需轮询，文档限制为每个 measurement 每秒最多 2 个 GET 请求。主题采用 2 秒轮询间隔。
- 在线探针列表和当前限额查询不计入测量测试额度。
- 公开测量及目标信息可能被他人凭测量 ID 查看；只提交公网 IP 和端口，不要发送密码、令牌或其他机密数据。

额度和探针可用性可能调整。前端处理 HTTP 429、无匹配探针和服务错误，并保留 AntPing 备用入口。

官方文档：
- API / OpenAPI：https://github.com/jsdelivr/globalping/blob/master/public/v1/spec.yaml
- 项目说明与使用限制：https://github.com/jsdelivr/globalping
- 在线探针与服务：https://globalping.io/

## 结果解释

- TCP 有响应：探针收到目标端口的 TCP 响应。
- 目标拒绝/重置：网络路径到达目标，但目标端口可能未监听或主动拒绝；不能标记为“大陆封禁”。
- 无 TCP 响应：可能是防火墙丢弃、线路过滤、路由异常、目标离线或探针限制，单次超时不能证明封禁。
- 需要结合三家运营商、海外对照、服务器本机监听和防火墙复测。
- 家庭/企业宽带探针比数据中心探针更能代表普通用户接入网络；结果表始终标注实际 probe tags，不混淆两者。

## 验收范围

- [x] 前端直接调用 Globalping，不依赖独立后端。
- [x] 自动读取所选 CFSM 实例公网 IPv4；失败时可手动填写。
- [x] 只接受公网 IPv4，并校验 TCP 端口范围。
- [x] 每次执行前重新读取在线探针列表，显示大陆三家 ASN 的实时探针覆盖。
- [x] 家庭/企业宽带探针优先；无此类节点时回退并标注探针类型。
- [x] 海外对照最多两个区域。
- [x] 明确区分连接成功、目标拒绝、无响应和任务进行中。
- [x] 不定时、不后台、不自动重跑。
- [x] AntPing 网页复核链接。
- [ ] 在用户的 CFSM 实际环境完成一次真实端到端测试；Globalping 探针覆盖和运营商表现以使用时 API 实时返回为准。
