# Multi-provider network probe implementation

## Product contract

The instance detail page provides two equally important, separate modes:

1. **ICMP Ping** — per-node reachability, packet loss and available latency samples.
2. **TCP connect** — connection outcome and connect latency for an explicit public IPv4 + port.

The three independent comparison sources are TCPTest, BOCE and Check-Host.net. A single explicit click creates a task for each enabled provider. Polling only retrieves results for those tasks; no cron, scheduler, background scan or automatic repeat check is part of this feature.

## Cost-aware provider policy

| Provider | API key | API cost model | Default behavior | Mainland coverage |
|---|---|---|---|---|
| Check-Host.net | Not required for public API | Public API; respect its usage/rate rules | Enabled by default | Current public node list at implementation time did not include Mainland China |
| TCPTest | Required | Charges quota per successfully executed probe node | Disabled unless API key is configured and selected | Mainland multi-carrier tools/nodes; verify actual live list |
| BOCE | Required | Deducts wave points based on API unit price and selected nodes | Disabled unless API key is configured and selected | Mainland default node list in official API docs |

When TCPTest/BOCE credentials are absent, the proxy must not call their node, quota or task APIs. The UI instead links to the provider's official Ping/TCPing web tools for manual operation; those web tools remain subject to their own usage limits and account policies. Before any metered task submission the UI requires a confirmation that explains the provider and selected node count. The default maximum selection is six nodes per provider/task, configurable server-side but capped in code.

Official documentation:
- TCPTest API: https://www.tcptest.cn/member/api-docs
- BOCE API: https://www.boce.com/api-console
- Check-Host.net API: https://check-host.net/about/api

## Provider API contracts currently implemented

| Provider | Node list | ICMP | TCP | Result retrieval | Credentials |
|---|---|---|---|---|---|
| TCPTest | `GET /api/open/v1/nodes` | `POST /api/open/v1/tasks`, type `ping` | same endpoint, type `tcping` | `GET /tasks/{id}`, `GET /tasks/{id}/results` | Bearer API Key |
| BOCE | `GET /v3/node/list` (mainland default) | `GET /v3/task/create/ping` | `GET /v3/task/create/tcping` | `GET /v3/task/ping/{id}`, `GET /v3/task/tcping/{id}` | key query parameter |
| Check-Host.net | `GET /nodes/hosts` | `GET /check-ping` | `GET /check-tcp` | `GET /check-result/{request_id}` | Public API, no provider key in documented basic flow |

TCPTest and BOCE request/result payloads remain provisional until authenticated test tasks are run with real provider accounts. Keep provider-specific adapters isolated and do not mark the normalizers production-verified based solely on UI/API documentation.

## Security and deployment boundary

CFSM-SAO is a static theme and must not contain provider API credentials. `probe-proxy/` is a separate Node.js 22 service:

- provider API keys, if any, live only in the proxy process environment;
- the browser uses a separate proxy token stored in session storage only;
- exact browser origins are allow-listed;
- proxy binds to loopback by default and must sit behind HTTPS reverse proxy;
- targets are restricted to public IPs/public DNS names;
- explicit node selection, six-node default cap and per-target/provider cooldown protect against accidental usage;
- never add provider keys to Vite variables, theme settings, repository files or client storage.

The proxy has no persistent database. Task metadata is held in memory until expiry; a proxy restart means an in-flight task cannot be polled via this proxy instance.

## Node coverage and comparison semantics

Fetch each provider's node list independently. A node is classified Mainland China only when its own metadata says country code `CN` or country `中国`. Do not infer carrier or city from an IP address. Do not label Check-Host.net Hong Kong or other overseas nodes as Mainland China. The UI shows Mainland and overseas counts separately; Check-Host.net's current list can change.

The theme keeps provider-specific node IDs separate. It must not pretend that nodes from different platforms are the same physical node. No fake cross-provider same-city one-to-one matching.

## Important result semantics

- ICMP timeout means no ICMP response was received; it does not prove TCP is unavailable.
- TCP timeout may be firewall, filtering, routing or a closed service; it does not prove the host is offline.
- Provider errors, pending nodes and target failures must remain separate states.
- Preserve provider raw data and each provider's own latency/loss definition; aggregate only within one provider.
- Result polling retrieves the current manually submitted task only. It must not create another detection.

## Current implementation status (draft)

- [x] Initial proxy service, environment template, Dockerfile and deployment notes.
- [x] Check-Host.net node discovery and initial Ping/TCP adapters.
- [x] Initial BOCE and TCPTest adapters (payload/result normalization still needs live account verification).
- [x] Admin-only instance detail UI for separate ICMP and TCP modes.
- [ ] Validate current-instance public IPv4 lookup against a live CFSM Admin API response (the matching-record lookup and manual fallback are implemented; exact deployment payload still needs a live check).
- [x] Free-first default and no-key Check-Host path.
- [x] Paid provider disabled until credentials configured; explicit confirmation before metered requests.
- [x] Actual node locations shown without filtering overseas Check-Host nodes into fake Mainland coverage.
- [ ] Verify TCPTest request body and response shapes against a real API account.
- [ ] Verify BOCE node-list response shape, exact wave-point prices and task result fields against a real account.
- [ ] Run live Check-Host.net Ping/TCP tasks to confirm live availability from the proxy's deployment network.
- [ ] Confirm CFSM Admin API `action=list` field mapping for the selected node's `ip_v4` against an actual server response.
- [ ] Complete full CI, browser smoke and independent review before promoting this draft.

Do not treat the adapters, IP auto-detection or end-to-end checks as production-verified until the unchecked items are completed.
