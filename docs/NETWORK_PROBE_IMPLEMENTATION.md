# Multi-provider network probe implementation

## Product contract

The instance detail page will provide two equally important, separate modes:

1. **ICMP Ping** — reachability, packet loss, min/average/max RTT and response count.
2. **TCP connect** — selected public IPv4 + port, connection success and connect latency.

The three providers are independent result sources:

- TCPTest
- BOCE
- Check-Host.net

One explicit button click creates one task per enabled provider. Polling only retrieves the results of those submitted tasks; it never creates another check. No cron, scheduler, background scan, or automatic repeat check is part of this feature.

## Provider API references and known contracts

| Provider | Node list | ICMP | TCP | Result retrieval | Credentials |
|---|---|---|---|---|---|
| TCPTest | `GET /api/open/v1/nodes` | `POST /api/open/v1/tasks`, type `ping` | same endpoint, type `tcping` | `GET /tasks/{id}`, `GET /tasks/{id}/results` | Bearer API Key |
| BOCE | `GET /v3/node/list` (mainland default) | `GET /v3/task/create/ping` | `GET /v3/task/create/tcping` | `GET /v3/task/ping/{id}`, `GET /v3/task/tcping/{id}` | key query parameter |
| Check-Host.net | `GET /nodes/hosts` | `GET /check-ping` | `GET /check-tcp` | `GET /check-result/{request_id}` | Public API; no provider key required for basic checks |

Official documentation:
- TCPTest: https://www.tcptest.cn/member/api-docs
- BOCE: https://www.boce.com/api-console
- Check-Host.net: https://check-host.net/about/api

## Security and deployment boundary

The CFSM-SAO theme is static. It cannot safely hold TCPTest or BOCE API credentials. `probe-proxy/` is a separate Node.js 22 service:

- provider keys live only in the proxy process environment;
- the browser uses a separate proxy access token;
- exact browser origins are allow-listed;
- the proxy binds to loopback by default and should sit behind HTTPS reverse proxy;
- targets are restricted to public IPs / public DNS names;
- the theme does not call the provider APIs directly.

The proxy has no persistent database. Task metadata is held in memory until expiry; a proxy restart means an in-flight task cannot be polled through this proxy instance.

## Mainland node selection

Node lists must be fetched from each provider independently. A node is classified as mainland only when the provider's own metadata identifies country code `CN` or country `中国`. Do not infer carrier or city from an IP address. Do not label Check-Host.net's non-mainland nodes as mainland nodes.

The theme keeps provider-specific node IDs separate. It must not pretend that nodes from different platforms are the same physical node.

## Important semantics

- ICMP timeout means no ICMP response was received; it does not prove TCP is unreachable.
- TCP timeout may be firewall, filtering, routing or a closed service; it does not prove the host is offline.
- Provider errors, pending nodes, and target failures must remain separate states.
- TCPTest charges by successful node execution according to its API docs. Node selection is explicit and capped in the initial UI.
- BOCE account point costs and Check-Host rate limits must be confirmed from the user's account/provider console before enabling large node selections.

## Current implementation status (draft)

- [x] Initial proxy service, environment template, Dockerfile and deployment notes.
- [x] Check-Host.net node discovery, Ping/TCP dispatch and result retrieval.
- [x] Initial BOCE node/Ping/TCP task adapter.
- [x] Initial TCPTest node/task/result adapter.
- [x] New admin-only instance detail UI for ICMP and TCP, with explicit provider and node selection.
- [x] Best-effort current-instance public IPv4 lookup via the authenticated CFSM admin server list; manual input fallback.
- [ ] Verify TCPTest request body and response shapes against a real API account.
- [ ] Verify BOCE node-list response shape and task results against a real API account.
- [ ] Verify Check-Host.net mainland node availability and live Ping/TCP result semantics.
- [ ] Add provider-specific quota/point preflight where APIs expose it.
- [ ] Run live end-to-end checks with user-provided credentials, then tune normalizers.
- [ ] Complete independent code review and final install/deployment handoff.

Do not treat the adapters as production-verified until the unchecked items are completed.
