# Local Wrangler + Podman acceptance — 20 October 2026

Local Cloudflare Worker validation works with the repository's actual MCP image,
including the network sidecar and outbound Tamperbox API calls.

## Reproduction and fix

The affected environment is macOS ARM64, Podman 5.8.2, a Fedora CoreOS VM with
cgroup v2 and crun 1.25.1, and Wrangler 4.151.3 / workerd 1.20261019.1.

Without the local API adapter, the sidecar failed to start with
`crun: cannot set memory swappiness with cgroupv2`. Capturing the container-create
requests confirmed that workerd sends `HostConfig.MemorySwappiness: 0` for both
the sidecar and application. Its [Docker API schema](https://github.com/cloudflare/workerd/blob/main/src/workerd/server/docker-api.capnp)
declares this as an unsigned integer with an implicit zero default; the
[sidecar creation code](https://github.com/cloudflare/workerd/blob/main/src/workerd/server/container-client.c++)
does not explicitly set it. Omitting that field allowed both containers to start.

`dev-podman.mjs` discovers the local Podman socket and runs Wrangler through
`podman-api.mjs`, a private Unix-socket adapter. On cgroup v2 it removes only the
zero swappiness field from create requests for this project's local workerd
container names and images. Other resource settings, nonzero swappiness values,
unrelated containers and cgroup v1 requests remain unchanged. Streaming API
responses and upgraded attach/exec connections pass through. Shutdown closes
connections and removes the temporary socket directory.

The existing build/registry-digest wrapper remains unchanged. No Podman VM
configuration, installed dependency, production configuration or deployed image
was changed. This is a local compatibility workaround, not a claim of universal
Podman support for every Cloudflare Container feature.

## Reproduce acceptance

The commands below use the current dedicated HTTP port 18791 and inspector port 19291. The historical run recorded here used port 8787.

With Podman running, from the repository root:

```sh
npm ci
npm --prefix deploy/cloudflare ci
npm run worker:dev:podman
```

In another terminal:

```sh
npm run worker:test:local
```

The acceptance command fixes its target to `http://localhost:18791/mcp`; it cannot
silently test production via an inherited `TAMPERBOX_MCP_URL`. It exercises the
local Worker and container, with selected outbound requests to the public API.
The hosted acceptance command retains its HTTPS requirement.

## Results

- All 15 acceptance checks passed: health/version, MCP initialization, tool
  schemas, 114-operation/53-tool discovery, isolated execution returning 42,
  live JSON formatting, JWT-to-YAML composition, DNS evidence, five invalid
  request cases, and client close.
- After inactivity, Podman listed only the sidecar: the application container
  had been removed by the Worker's idle alarm. A subsequent `/health` request
  returned HTTP 200 with `{"status":"ok","version":"0.3.0"}`.
- Ctrl-C stopped the launcher and removed its private temporary socket directory.
- All 34 Worker unit tests and the real Node/QuickJS cancellation integration
  test passed. The 360-test root suite, coverage thresholds and packed-package
  smoke checks also passed (final recheck on 21 October).
- Four API-adapter regression tests passed, including real Unix-socket
  forwarding, payload boundaries, unchanged resource settings and bidirectional
  upgraded streams.

These checks establish the tested local development path. They do not replace
hosted release acceptance or establish availability of every upstream operation.
No deployment was performed.

## Revalidation — 25 October 2026

The reconciled candidate uses Wrangler 4.152.0, its bundled workerd
1.20261019.1, and Node 26 in the container. The current source catalog has
120 operations covering 60 website tools. Earlier counts and versions above
describe the historical run. HTTP and inspector ports are now 18791 and 19291.

On this macOS host, the installed workerd path accepted outbound CONNECT
requests but stalled public HTTP and TLS traffic, even when the tunnel was
tested directly from the host. A clean launcher restart reproduced it.
Direct host and standalone-container requests worked. Both the bundled
workerd version and 1.20261025.1 passed live API calls when launched from a
temporary directory; the latter still stalled at the installed path. This
is path-dependent evidence, not proof of a runtime-version regression or a
universal Podman failure. The dependency remains at Wrangler's bundled version.

To reproduce the isolated-binary check without patching installed dependencies,
copy the installed binary and select it with Miniflare's runtime override:

```sh
runtime_dir=$(mktemp -d /tmp/tamperbox-workerd.XXXXXX)
runtime_binary=$(cd deploy/cloudflare && node -e 'const { createRequire } = require("node:module"); const load = createRequire(require.resolve("miniflare", { paths: [require.resolve("wrangler/package.json")] })); console.log(load("workerd").default)')
cp "$runtime_binary" "$runtime_dir/workerd"
MINIFLARE_WORKERD_PATH="$runtime_dir/workerd" npm run worker:dev:podman
# After stopping Wrangler:
rm -f "$runtime_dir/workerd"
rmdir "$runtime_dir"
```

Run the acceptance command in another terminal once `/health` reports ready.
A cold AMD64 container under emulation may exceed the 15-second startup bound
on a busy ARM host; the Worker returns 503 rather than claiming readiness.
The bounded health request can be retried, but submitted MCP work is not retried.
