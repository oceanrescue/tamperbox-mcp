# Code Mode expansion — 2026-10-18

The MCP now exposes exactly two tools: `search` and `execute`. Both accept JavaScript async function bodies. Search runs over a frozen local OpenAPI document and derived operations array without network access. Execution exposes only the generic `tamperbox.request({method,path,query?,body?})` API bridge; the host validates the documented route, arguments and response.

## Coverage and limits of coverage

The shared contract contains 58 operations: 50 diagnostic reports, five artifact transforms, pipeline execution, directory search and recipe retrieval. Its website IDs match all 53 entries in the Tamperbox registry. This does not mean every browser mode is callable: visual interfaces, some pasted-input modes, generators, JWT verification/rebuilding and additional timestamp modes are outside this API contract. Each endpoint describes its narrower behavior and limitations.

The expanded REST API was deployed to the existing `tamperbox-agents` service in the verified personal account, version `d2396b90-607b-49a9-95b4-6a241087e7d6`. The preceding version was `4cee8c20-5640-4917-8595-d0839fd4e01e`. Both `https://api.tamperbox.dev/v1/openapi.json` and `https://docs.tamperbox.dev/openapi.json` were fetched and matched the MCP bundle exactly. The website deployment was not replaced. The private certificate probe was subsequently updated as described below.

The existing hosted `mcp.tamperbox.dev` implementation remains separate. This source MCP supports stdio and self-hosted Streamable HTTP; neither npm publication nor a hosted deployment of this new MCP interface is established by the REST deployment.

## Executed checks

- Upstream complete suite after the probe launcher fix: 826 passing tests, including real dispatcher/handler/parser execution for every POST operation and independent output-schema validation against synthetic external services.
- MCP full check on Node 22.22.3: 303 passing tests; formatting, type checking, coverage gates and extracted-package stdio/sandbox/client smoke passed.
- MCP suite on Node 24.16.0 and 26.8.2: 303 passing tests on each.
- Coverage: 94.62% statements, 89.53% branches, 97.18% functions, 95.33% lines. CLI and VM-worker subprocess behavior is tested separately from host coverage.
- Runtime dependency audit: zero known vulnerabilities reported at the time of this check.
- Local Worker HTTP smoke and eight concurrent conversion requests passed. Deployment dry run passed; deployed startup time was 51 ms.
- Cross-repository acceptance: official MCP client → sandbox → HTTP → actual API Worker, all 58 operations, 61 API requests and 148 synthetic external requests. It checks exact specification/website-registry agreement, search isolation, report-to-transform composition, errors and connection-identity warnings.
- Fresh hardened container (network disabled, read-only, 512 MiB, two CPUs): four concurrent full-catalog searches and two four-execution binary-allocation attacks passed; 337,784,832-byte cgroup peak, zero OOM events/kills, and `return 42` healthy afterward. Image: `3b2a43ebdfc7b4b278a71c5a315becd04256fa9dd04e972df9432c11b4d4b0fe`.
- A live production DNS request through the MCP sandbox returned validated DNS evidence for `example.com` with `apiCalls: 1`.

These checks distinguish contract behavior from external-service availability. Lookup failures must remain unavailable or partial evidence, never silently become absence or a successful verdict. Cancellation aborts pending fetches and promptly settles even if a downstream operation ignores its signal.

## Reproduce

```sh
npm ci
npm run check
npm run sync:openapi -- ../toolkit-apps/src/agent-api/openapi.js --check
npm run test:api-integration -- ../toolkit-apps
```

The two cross-repository commands are maintainer checks and require the corresponding API checkout. Published package execution does not depend on it. Contract synchronization is an explicit local action; runtime discovery cannot grant new routes or fetch arbitrary schema references.

Provider-account acceptance, npm/registry publishing and marketplace review remain separate release steps. Historical verification documents describe the earlier eight-operation implementation and are retained as dated records.

## Production diagnostic acceptance

All 58 published operation examples were called with synthetic text and public example targets. The initial sweep returned 54 schema-valid results. Subdomain discovery timed out and BGP timed out; the corresponding existing website endpoints also returned unavailable/timeout errors. These are availability failures, not evidence of an empty result. The regional TCP example initially returned an unavailable report and later returned a reachable report without a code change.

The other two failures exposed an obsolete private TLS probe image. Rebuilding it supplied OpenSSL 3.5.9 and the already-implemented TLS routes, but production startup revealed a second issue: a 176,758-byte inline `node -e` argument exceeds Linux's per-argument limit. This was independently reproduced as `E2BIG`. The prior probe version was restored while a regression-tested file-based launcher was verified in the real image.

The corrected private probe is deployed as `2a3ceece-5335-4573-9874-04f1a5dc97a5`, using image digest `sha256:d46baca8ad8ff1dc9fb8925989447bc95e67bc1175db262693d49592e55be815`. Both SSL and post-quantum examples then succeeded through the real MCP sandbox: TLS 1.3, verified trust, four certificate rows, and observed supported hybrid key exchange. This brings successful schema-valid production examples to 56 of 58; subdomain/BGP availability remains explicitly unverified as successful.

A final generated API-documentation paragraph distinguishing the companion Code Mode MCP from the legacy hosted MCP is prepared and passed discovery checks. Publishing that paragraph is pending explicit approval because automatic review rejected redeploying the whole API Worker for a documentation-only change. The companion README already states the distinction.

## Publication follow-up

On 2026-10-18, `tamperbox-mcp@0.2.0` was published through npm staged publishing with browser approval. Release source is `92606fdcbabad97e58ad2b722109e1179e73ee08`; tarball SHA-256 is `5a07b508ddf08ad3c784543011ff8929b3199b38ceb352264e09a7aac6993eac`. npm reported SHA-1 `1faff0a7d4f374ba01f4e34e2f10dcbb663508e2`, matching the candidate. A clean registry installation using only its own installed dependencies verified both MCP tools, 58 operations/53 entries, `return 42` and a real synthetic JSON-format API call. Earlier publication-pending statements describe the preceding stages.

The owner explicitly approved the documentation-only production redeployment after automatic review required that specific approval. Clean source `36caf2086982287a707891e31487ea6ec47e99f6` deployed as `bdf6f8b7-03cd-4a21-90ee-c64579ba5807`. Build, 212 focused tests and dry run passed first. Ten postdeployment assertions confirmed the developer HTML/Markdown clarification, byte-identical OpenAPI, successful JSON/DNS examples and the unchanged legacy seven-tool MCP surface. This did not replace the main website or private probe services.
