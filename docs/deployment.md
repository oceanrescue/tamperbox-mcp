# Deployment

For local clients, prefer stdio. For remote clients, run the Node service behind an HTTPS reverse proxy. The app itself speaks HTTP and does not provision DNS or TLS.

A dedicated Cloudflare container adapter is maintained in [deploy/cloudflare](https://github.com/oceanrescue/tamperbox-mcp/tree/main/deploy/cloudflare). Production is `https://mcp.tamperbox.dev/mcp` (no authentication), deployed with `deploy/cloudflare/wrangler.production.jsonc`. See the [production acceptance and rollback record](production-acceptance.md). The public preview is `https://tamperbox-code-mode-preview.i5634446.workers.dev/mcp` (no authentication). Its [acceptance record](hosted-acceptance.md) includes real client and lifecycle checks. The adapter supplies a separate preview hostname, bounded startup/lifecycle handling, ingress validation and rate limiting. Its tests include cancellation through the actual Node/QuickJS service. See that directory for resource allocation and deployment instructions; the default configuration manages the preview, while the production configuration owns `mcp.tamperbox.dev`.

The root scripts expose the complete Worker workflow:

```sh
npm ci
npm --prefix deploy/cloudflare ci
npm run worker:dev                 # http://localhost:8787
npm run worker:test                # unit and Node/QuickJS integration tests
npm run worker:check               # tests plus local-config dry run
npm run worker:check:production    # tests plus production dry run
npm run worker:deploy:production   # explicit production deployment
```

The local Worker config permits HTTP only for its exact loopback origin. Preview and production accept only their exact HTTPS origins. A container engine is required to build the Cloudflare Container. Podman builds use the verified compatibility adapter; see the deployment package README for setup, the separate local Wrangler runtime check, and local secret handling.

```sh
npm ci
npm run build
TAMPERBOX_ALLOWED_HOSTS=mcp.example.com \
  node dist/cli.js --transport http --host 0.0.0.0 --port 3000 --public
```

Replace `mcp.example.com` with the real hostname before running. Configure the proxy to preserve that Host value. `TAMPERBOX_ALLOWED_HOSTS` is a comma-separated hostname allowlist without ports. Forwarding headers are intentionally ignored. Default allowed hosts are loopback only. Do not expose `/health` as proof that the upstream API is reachable.

For a private deployment, omit `--public` and inject `TAMPERBOX_MCP_TOKEN` from your secret manager. Clients must send `Authorization: Bearer <token>`. Do not place secrets in URLs or committed configuration. This static token is not OAuth; add an independently tested OAuth gateway when required by a client.

`TAMPERBOX_ALLOWED_ORIGINS` accepts exact comma-separated browser origins. Requests with no Origin header are allowed after Host/auth checks. Unknown, empty and `null` origins are rejected. Configure only the actual browser origin when necessary; do not use a wildcard. CLI/server-to-server clients normally omit Origin.

## Container

```sh
docker build -t tamperbox-mcp .
docker run --rm -p 127.0.0.1:3000:3000 \
  --read-only --memory=512m --cpus=2 --pids-limit=64 \
  --cap-drop=ALL --security-opt=no-new-privileges \
  -e TAMPERBOX_ALLOWED_HOSTS=mcp.example.com \
  -e TAMPERBOX_PUBLIC_HTTP=true tamperbox-mcp
```

The Dockerfile runs as the built-in non-root Node user. Use a container runtime/host memory budget in addition to QuickJS limits; a Node worker's V8 limit does not cover WebAssembly/native allocation. Each execution has a separate 64 MiB hard WebAssembly ceiling, including binary backing stores; the 32 MiB QuickJS allocator budget is not a total heap guarantee. Size the container for concurrent Node heaps, native overhead and transport buffers as well as the four possible VM instances. Pin the base image by digest in your production deployment policy. Container build/runtime validation is separate from `npm run check`.

Set upstream egress policy to the trusted API origin. Apply distributed rate/connection limits at the gateway when using multiple replicas. In-process limits bound one process and intentionally do not trust client-supplied IP headers. Avoid logging request bodies, authorization headers and query strings. Set proxy body limits to 1 MiB and tool request timeouts above 30 seconds. WebSockets and sticky sessions are not needed.

For readiness, check `/health`, then run an MCP initialization, tools/list and a synthetic `json_format` call against the **actual deployed URL**. Verify HTTPS, Host forwarding, auth, Origin denials and logs before connecting external clients. The authorized production cutover was completed on 2026-10-18; future releases must repeat these checks.

From a source checkout, run the opt-in hosted acceptance suite against the new service:

```sh
TAMPERBOX_MCP_URL=https://mcp.tamperbox.dev/mcp npm run test:hosted
```

It checks protocol initialization and schemas, 58-operation discovery, isolated code, live JSON/JWT/DNS examples, and HTTP rejection behavior. It reports unavailable services separately from successful results. Set `TAMPERBOX_MCP_TOKEN` locally when the deployment requires a bearer token. The suite verifies selected hosted behavior, not every diagnostic's availability or provider-model acceptance.
