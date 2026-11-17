# CFSM-SAO Network Probe Proxy

A small Node.js 22 service for the CFSM-SAO administrator's manual ICMP Ping and TCP connectivity checks.

## Free-first behavior

- **Check-Host.net is the default no-key provider.** It exposes a public API for node discovery, ICMP Ping, TCP checks and asynchronous result retrieval. It is not a Mainland China three-carrier network; the live node list is authoritative and may contain nearby Asian locations such as Hong Kong, Japan and Singapore instead.
- **TCPTest is optional and metered.** Its API requires a server-side API key and charges quota per successfully executed probe node. Node discovery/quota/result retrieval are documented as non-billable.
- **BOCE is optional and metered.** Its API requires a server-side API key and deducts wave points according to the endpoint's unit price and selected node count.
- If TCPTest/BOCE keys are blank, the proxy reports those providers as unconfigured and does not call their node, quota or task APIs. The theme offers links to the official Ping/TCPing web tools for manual use; website limits/terms still apply.
- Paid API task submission requires an additional confirmation in the theme. Keep the default node cap small; check your account's live balance/pricing before enabling metered providers.

Official references:
- TCPTest API: https://www.tcptest.cn/member/api-docs
- TCPTest web tools: https://www.tcptest.cn/ping and https://www.tcptest.cn/tcping
- BOCE API: https://www.boce.com/api-console
- BOCE web tools: https://www.boce.com/ping and https://www.boce.com/tcping
- Check-Host.net API: https://check-host.net/about/api

The three sources remain independent. Their nodes are not falsely mapped to one another. ICMP timeout does not prove TCP is unavailable; TCP timeout does not prove the host is offline.

## Configuration

Copy `.env.example` to `.env`. Required settings:

- `PROBE_PROXY_TOKEN`: long random secret shared only with the administrator's browser session.
- `PROBE_ALLOWED_ORIGINS`: exact CFSM-SAO origin(s), comma separated.

Optional settings (leave blank for the free Check-Host.net path):

- `TCPTEST_API_KEY`: enables metered TCPTest integration.
- `BOCE_API_KEY`: enables metered BOCE integration.

Third-party API keys stay on the proxy server and must never be added to the theme build, Vite variables, browser settings, or chat messages. The theme stores the proxy URL persistently but keeps its proxy bearer token in session storage only.

The service binds to `127.0.0.1` by default. Put it behind an HTTPS reverse proxy; do not expose the Node port directly to the Internet.

## API

- `GET /health`
- `GET /v1/providers` — provider configuration and billing metadata
- `GET /v1/providers/:provider/nodes`
- `GET /v1/providers/:provider/quota` — optional account quota where supported
- `POST /v1/checks` with `{ "provider":"check-host|boce|tcptest", "mode":"ping|tcp", "target":"public-ip-or-domain", "port":443, "nodeIds":["..."], "count":4 }`
- `GET /v1/checks/:provider/:taskId`

All routes except the health endpoint require `Authorization: Bearer <PROBE_PROXY_TOKEN>`. CORS is restricted to configured origins. Provider credentials are injected server-side. Task creation requires an explicit node selection, is limited to six nodes by default, and is rate-limited per client/provider/target/mode/port.

## Deployment

Use Node.js 22 or Docker. Example:

```sh
cd probe-proxy
cp .env.example .env
# Set PROBE_PROXY_TOKEN and PROBE_ALLOWED_ORIGINS.
# Leave TCPTEST_API_KEY and BOCE_API_KEY blank for Check-Host.net-only use.
docker build -t cfsm-probe-proxy .
docker run -d --name cfsm-probe-proxy --restart unless-stopped \
  --env-file .env -p 127.0.0.1:8787:8787 cfsm-probe-proxy
```

Configure your HTTPS reverse proxy to forward a dedicated path or subdomain to `127.0.0.1:8787`. Do not commit `.env`.

## Important semantics and limitations

- ICMP and TCP are separate tests and are equally important in the theme.
- Check-Host.net coverage must be read from its current node list. Do not relabel Hong Kong or other overseas nodes as Mainland China.
- Mainland carrier-level comparison currently depends on optional TCPTest/BOCE metered APIs or manual checks on their official websites.
- Provider payload adapters for TCPTest and BOCE are documented but remain unverified against real authenticated accounts; do not represent them as production-validated until live sample tasks are tested.
- The proxy has no persistent database. Task metadata is held in memory until expiry; a proxy restart means an in-flight task can no longer be polled through this proxy instance.
- ICMP timeouts may be caused by filtering. TCP timeouts may be caused by filtering, routing or service state. Preserve provider errors, pending nodes and actual target failures as distinct states.
- There is no scheduler, cron, background scan or automatic repeat detection. Polling only retrieves a task created by the administrator's explicit click.
