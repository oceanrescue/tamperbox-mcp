# Cloudflare production and preview

This private deployment package runs the Node/QuickJS server in a Cloudflare Container. `wrangler.production.jsonc` owns `mcp.tamperbox.dev` through the `tamperbox-code-mode` Worker. The default `wrangler.jsonc` continues to manage the separate preview. No deployment command runs automatically.

## Production

The public endpoint is `https://mcp.tamperbox.dev/mcp`, with no authentication. The production image is pinned by digest to the artifact verified in preview. Updating source code alone does not update that image: build and verify a new preview image, then explicitly update the production digest before deploying. Keep the referenced registry image available while either environment uses it.

```sh
npm run check:production
npm run deploy:production
# From the repository root after deployment:
TAMPERBOX_MCP_URL=https://mcp.tamperbox.dev/mcp npm run test:hosted
```

Production disables workers.dev and version preview URLs, uses its own Durable Object namespace and rate-limit namespace, and retains the same bounded resource allocation described below. See [production acceptance and rollback](../../docs/production-acceptance.md).

## Preview

The preview hostname is `tamperbox-code-mode-preview.i5634446.workers.dev`. `PUBLIC_HOST` must exactly match the published hostname; a missing or invalid value fails closed. The Worker accepts only HTTPS `/mcp` (POST/OPTIONS) and `/health` (GET).

```sh
cd deploy/cloudflare
npm ci
npm test
npm run test:node-integration  # requires the root npm run build first
npm run check                # tests and deployment dry run; requires Docker
```

For this machine's Podman engine, use the included standalone compatibility wrapper:

```sh
WRANGLER_DOCKER_BIN="$PWD/wrangler-podman.mjs" npm run check
```

The wrapper preserves target architecture and verifies the remote manifest digest after a registry push. The dry run builds locally without pushing an image or deploying a Worker. No sibling checkout is required.

The root Dockerfile is the image source with `../..` as build context. A file entrypoint starts `/app/dist/cli.js`; no generated JavaScript is passed as a command argument. The image specifies `USER node`, but that UID is not a security boundary on the Durable Object scheduling policy. The guest isolation boundary remains QuickJS, its restricted host bridge, and the existing memory and execution limits.

One fixed Durable Object ID and one container provide a bounded preview. Four active proxied requests are accepted; a fifth receives 503. The `standard-1` instance reserves **4 GiB memory and ½ vCPU**, with 8 GB disk. This is larger than the local 512 MiB test container: Cloudflare's `lite` instance has only 256 MiB, below the measured four-execution peak, and current custom sizing requires at least 3 GiB per vCPU. CPU capacity differs from the local test environment, so hosted latency and concurrency still require acceptance checks. See [instance limits](https://developers.cloudflare.com/containers/platform/limits/).

A 30-second idle alarm stops the container; an active request defers the alarm. A 120-second platform inactivity fallback exceeds the maximum active request lifetime. If scheduling the idle alarm fails, the last active request stops the container; the inactivity timer alone is not a wall-clock shutdown guarantee while monitoring is active. Cold startup is bounded to 15 seconds; submitted work to 35 seconds. Only harmless health probes retry. Submitted MCP requests never retry. Client cancellation propagates through the container HTTP connection to the Node server and its guest workers. The local integration test proves cancellation across this proxy and four real QuickJS busy loops; Cloudflare-hosted acceptance remains a separate gate.

Request bodies are streamed into a bounded 1 MiB buffer with a five-second deadline. Responses stream with a 7 MiB ceiling, allowing the MCP result's structured and text representations, including JSON escaping. Bodies, request identifiers and credentials are not stored in Durable Object storage. Only alarm timestamps are persisted. Worker and container logging are disabled; exception responses use fixed messages. On Durable Object re-creation, an existing container is retired before handling requests so image, auth and origin configuration cannot remain stale.

The edge uses the platform `cf-connecting-ip` for its rate-limit binding (60 requests per minute per client, approximate per Cloudflare location), never a forwarding header. Node's independent global request limit remains in place. Forwarding uses only the fixed `http://container:3000` origin, and Node allows only the `container` Host. User-supplied forwarding, cookie and Host headers are dropped. The configured public origin is allowed; additional exact HTTPS origins can be supplied in `ALLOWED_ORIGINS`. Authorization is preserved. An optional `MCP_TOKEN` Worker secret is checked at the edge and injected into Node as its inbound bearer token; it is never an upstream API credential. The default preview is public and has no secret configured.

This adapter uses the current [`ctx.container` API](https://developers.cloudflare.com/containers/api/durable-object-container/) with the `durable_object` scheduling policy and named images. The private package pins Wrangler 4.152.0. Review the resource allocation and account billing before an explicitly authorized deployment; this package does not run a deployment itself.
