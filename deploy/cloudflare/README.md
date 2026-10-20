# Cloudflare local development, production and preview

This private deployment package runs the Node/QuickJS server in a Cloudflare Container. `wrangler.production.jsonc` owns `mcp.tamperbox.dev` through the `tamperbox-code-mode` Worker. The default `wrangler.jsonc` continues to manage the separate preview. No deployment command runs automatically.

## Local development

Install both dependency trees once, then start Wrangler from the repository root:

```sh
npm ci
npm --prefix deploy/cloudflare ci
npm run worker:dev
```

The local-only configuration is `wrangler.local.jsonc`. It listens at `http://localhost:8787`, builds the repository Dockerfile and permits plain HTTP only for the configured loopback origin. Production and preview continue to require their exact HTTPS origins. For this machine’s Podman setup, configure the existing build adapter and API socket:

```sh
export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
WRANGLER_DOCKER_BIN="$PWD/deploy/cloudflare/wrangler-podman.mjs" npm run worker:dev
```

Both settings are needed: the wrapper builds images, while the socket connects the local runtime to Podman's container API. Without the socket, Wrangler can build successfully but container requests fail.

Podman container validation and the build/registry-digest adapter were previously verified; see the [container verification record](../../docs/verification.md) and [hosted acceptance record](../../docs/hosted-acceptance.md). Those results remain valid. In the 20 October review, a separate `wrangler dev` test with Wrangler 4.151.3 reached the local listener but failed when starting its network sidecar with `crun: cannot set memory swappiness with cgroupv2`, even with the API socket configured. That run did not establish local `/health` readiness. The cause and remedy remain unverified; this single result does not establish a general Podman limitation or a requirement to switch to Docker.

Check readiness at `http://localhost:8787/health` and connect an MCP client to `http://localhost:8787/mcp`. To require a bearer token locally, create the ignored file `deploy/cloudflare/.dev.vars` containing `MCP_TOKEN=...`; never commit that file.

## Tests

From the repository root:

```sh
npm run worker:test
npm run worker:check
npm run worker:check:production
```

`worker:test` builds the root TypeScript package, runs the adapter and Podman-wrapper unit tests, and runs the real Node/QuickJS cancellation integration test. `worker:check` additionally performs a local-config deployment dry run and requires a container engine (the Podman wrapper was verified for this build). `worker:check:production` validates the production config and pinned image without deploying.

Review validation on 20 October 2026: root package checks passed 360 tests, coverage and packed-package smoke checks; Worker checks passed 30 unit tests and one real Node/QuickJS cancellation integration test. Local and production deployment dry runs passed with Wrangler 4.151.3. The local HTTP and inspector listeners started; the full container health check failed at network-sidecar startup as recorded above. No deployment was performed.

## Production

The public endpoint is `https://mcp.tamperbox.dev/mcp`, with no authentication. The production image is pinned by digest to the artifact verified in preview. Updating source code alone does not update that image: build and verify a new preview image, then explicitly update the production digest before deploying. Keep the referenced registry image available while either environment uses it.

From the repository root:

```sh
npm run worker:check:production
npm run worker:deploy:production
# From the repository root after deployment:
TAMPERBOX_MCP_URL=https://mcp.tamperbox.dev/mcp npm run test:hosted
```

Production disables workers.dev and version preview URLs, uses its own Durable Object namespace and rate-limit namespace, and retains the same bounded resource allocation described below. See [production acceptance and rollback](../../docs/production-acceptance.md).

## Preview

The preview hostname is `tamperbox-code-mode-preview.i5634446.workers.dev`. `PUBLIC_ORIGIN` must exactly match the published origin; a missing or invalid value fails closed. The Worker accepts only HTTPS `/mcp` (POST/OPTIONS) and `/health` (GET).

```sh
cd deploy/cloudflare
npm ci
npm test
npm run check:preview # tests and deployment dry run; requires a container engine
```

For this machine's Podman engine, use the included standalone compatibility wrapper:

```sh
WRANGLER_DOCKER_BIN="$PWD/wrangler-podman.mjs" npm run check:preview
```

The wrapper preserves target architecture and verifies the remote manifest digest after a registry push. The dry run builds locally without pushing an image or deploying a Worker. No sibling checkout is required.

The root Dockerfile is the image source with `../..` as build context. A file entrypoint starts `/app/dist/cli.js`; no generated JavaScript is passed as a command argument. The image specifies `USER node`, but that UID is not a security boundary on the Durable Object scheduling policy. The guest isolation boundary remains QuickJS, its restricted host bridge, and the existing memory and execution limits.

One fixed Durable Object ID and one container provide a bounded preview. Four active proxied requests are accepted; a fifth receives 503. The `standard-1` instance reserves **4 GiB memory and ½ vCPU**, with 8 GB disk. This is larger than the local 512 MiB test container: Cloudflare's `lite` instance has only 256 MiB, below the measured four-execution peak, and current custom sizing requires at least 3 GiB per vCPU. CPU capacity differs from the local test environment, so hosted latency and concurrency still require acceptance checks. See [instance limits](https://developers.cloudflare.com/containers/platform/limits/).

A 30-second idle alarm stops the container; an active request defers the alarm. A 120-second platform inactivity fallback exceeds the maximum active request lifetime. If scheduling the idle alarm fails, the last active request stops the container; the inactivity timer alone is not a wall-clock shutdown guarantee while monitoring is active. Cold startup is bounded to 15 seconds; submitted work to 35 seconds. Only harmless health probes retry. Submitted MCP requests never retry. Client cancellation propagates through the container HTTP connection to the Node server and its guest workers. The local integration test proves cancellation across this proxy and four real QuickJS busy loops; Cloudflare-hosted acceptance remains a separate gate.

Request bodies are streamed into a bounded 1 MiB buffer with a five-second deadline. Responses stream with a 7 MiB ceiling, allowing the MCP result's structured and text representations, including JSON escaping. Bodies, request identifiers and credentials are not stored in Durable Object storage. Only alarm timestamps are persisted. Worker and container logging are disabled; exception responses use fixed messages. On Durable Object re-creation, an existing container is retired before handling requests so image, auth and origin configuration cannot remain stale.

The edge uses the platform `cf-connecting-ip` for its rate-limit binding (60 requests per minute per client, approximate per Cloudflare location), never a forwarding header. Node's independent global request limit remains in place. Forwarding uses only the fixed `http://container:3000` origin, and Node allows only the `container` Host. User-supplied forwarding, cookie and Host headers are dropped. The configured public origin is allowed; additional exact HTTPS origins can be supplied in `ALLOWED_ORIGINS`. Authorization is preserved. An optional `MCP_TOKEN` Worker secret is checked at the edge and injected into Node as its inbound bearer token; it is never an upstream API credential. The default preview is public and has no secret configured.

This adapter uses the current [`ctx.container` API](https://developers.cloudflare.com/containers/api/durable-object-container/) with the `durable_object` scheduling policy and named images. The private package pins Wrangler 4.151.3. Review the resource allocation and account billing before an explicitly authorized deployment; this package does not run a deployment itself.
