# CFSM-SAO Network Probe Proxy

A small Node.js 22 service that keeps provider API credentials off the static CFSM-SAO theme.

## Current integration status

- Check-Host.net: documented node discovery, ICMP Ping dispatch/result and TCP dispatch/result.
- BOCE: documented mainland node list, Ping/TCPing dispatch and async result endpoints.
- TCPTest: documented API base, Bearer authentication, node/quota/task/result endpoints and Ping/TCPing types. Confirm request/response field names against a real account before production enablement.
- This proxy is a first implementation scaffold. Provider payloads are deliberately isolated in `src/server.mjs`; do not treat the TCPTest and BOCE adapters as production-verified until they have been exercised with real API credentials and node selections.

## Configuration

Copy `.env.example` to `.env`. Set:

- `PROBE_PROXY_TOKEN`: long random token shared with the admin-only theme UI.
- `PROBE_ALLOWED_ORIGINS`: exact CFSM-SAO origin(s), comma separated.
- `TCPTEST_API_KEY` and `BOCE_API_KEY`: provider credentials. These stay on this server and must never be added to the theme build or browser storage.

The service binds to `127.0.0.1` by default. Put it behind an HTTPS reverse proxy; do not expose the Node port directly to the Internet.

## API

- `GET /health`
- `GET /v1/providers`
- `GET /v1/providers/:provider/nodes`\n- `GET /v1/providers/:provider/quota` (TCPTest exposes quota; BOCE and Check-Host.net currently return a documented-unavailable notice)
- `POST /v1/checks` with `{ "provider":"check-host|boce|tcptest", "mode":"ping|tcp", "target":"public-ip-or-domain", "port":443, "nodeIds":["..."], "count":4 }`
- `GET /v1/checks/:provider/:taskId`

All routes except the health endpoint require `Authorization: Bearer <PROBE_PROXY_TOKEN>`. CORS is restricted to configured origins. Provider credentials are injected server-side.

## Deployment

Use Node.js 22 or Docker. Example:

```sh
cd probe-proxy
cp .env.example .env
# Edit .env with your own values; do not commit it.
docker build -t cfsm-probe-proxy .
docker run -d --name cfsm-probe-proxy --restart unless-stopped \
  --env-file .env -p 127.0.0.1:8787:8787 cfsm-probe-proxy
```

Configure your HTTPS reverse proxy to forward a dedicated path or subdomain to `127.0.0.1:8787`.

## Important semantics

- ICMP and TCP are separate tests and must be presented separately.
- A Ping timeout can mean ICMP filtering; it does not prove TCP is unavailable.
- A TCP timeout can mean filtering or routing failure; it does not prove the service is stopped.
- Check-Host.net node coverage is not equivalent to mainland carrier coverage. Only actual node metadata should be shown.
- Node selection and task submission are explicit; there is no scheduler or periodic scan.
- Provider task/result payloads are retained as raw data so the theme can preserve provider-specific details.
