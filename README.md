# Tamperbox MCP

A code-mode [Model Context Protocol](https://modelcontextprotocol.io/) server for [Tamperbox](https://tamperbox.dev). Search the API specification with JavaScript, then call documented endpoints, combine their results and return only what your agent needs.

**Two MCP tools: `search` and `execute`. 120 API operations covering the 60 website tool entries and their artifact-analysis and builder workflows. stdio and Streamable HTTP. Node.js 22+.**

**Documentation:** [docs.tamperbox.dev](https://docs.tamperbox.dev) has the [MCP overview](https://docs.tamperbox.dev/mcp/), [client setup](https://docs.tamperbox.dev/mcp/connect/), [code mode](https://docs.tamperbox.dev/mcp/code-mode/), [limits](https://docs.tamperbox.dev/reference/limits/) and, per tool, the method, finding reference and repair guide behind each operation ([tool pages](https://docs.tamperbox.dev/tools/)). Agents can read the same pages as Markdown from [docs.tamperbox.dev/llms.txt](https://docs.tamperbox.dev/llms.txt).

**Hosted release:** version 0.3.0 is published at [mcp.tamperbox.dev/mcp](https://mcp.tamperbox.dev/mcp), with 115 operations covering 55 website tools and unchanged `search`/`execute` tools. See the [release evidence and remaining service limitations](docs/page-parity-release-2026-10-20.md). The npm registry package has not been updated to 0.3.0 by this hosted release.

Artifact counterparts now cover JWT verification and rebuilding, synthetic signed fixtures, timestamp batches and editing, pasted DNS/HTTP/TLS evidence, policy builders, cookie analysis, sitemap and seller inspection, and site-file repairs. Visual rendering, clipboard actions and browser history remain interface features. Search the exact schema before building a workflow. This server requires no OpenAI or Anthropic key to start.

## Additional artifact and diagnostic workflows

- JWT: `jwt_verify`, `jwt_rebuild`, `jwt_fixture`. Verification requires an explicit algorithm; fixtures are not application credentials.
- Time and conversion: `timestamp_convert`, `timestamp_adjust`, `api_convert_report`.
- Mail: page-specific `*_analyze` and policy `*_build` operations; `dkim_discover` and `ip_enrich`.
- Supplied DNS, HTTP, HTML, RDAP and TLS evidence: page-specific `*_analyze` operations make no network lookup.
- Site files: `sitemap_inspect`, `sellers_inspect`, `site_file_inspect`, `robots_analyze`, `ads_txt_analyze`, `llms_txt_analyze`, `llms_txt_draft`.
- `tls_probe` supports explicit HTTPS/mail TLS ports; `bgp_events` requires a configured incident-feed credential and otherwise reports unavailable.

Inputs to remote artifact operations—including supplied secrets—are sent to our server. Use browser-local tools for sensitive inputs. The 20-call execution ceiling does not guarantee 20 available network checks: hosted users can share the MCP server’s upstream rate budget. Start with small batches and respect `details.retryAfterSeconds`. Errors preserve a bounded `details.upstreamCode`, not raw upstream prose; submitted work is not automatically retried.

## Try the tools before automating

Start at [tamperbox.dev](https://tamperbox.dev). Run a small example in the corresponding browser tool, inspect its inputs, result and limitations, then use `search` to inspect the API contract. A browser warning often explains why an agent should treat a result as evidence rather than a definitive verdict.

For transforms, open the [Pipeline editor](https://tamperbox.dev/pipeline), load the synthetic example, and run JWT → JSON → YAML step by step. Change the input or an option and compare the result. The editor processes those transforms locally; MCP sends operation inputs to the configured API. Website network checks already send their targets to the service. Remote header analysis also sends the supplied headers, unlike the website's local default.

### What agents can discover

The groups below summarize the expanded contract. Names identify API operations, **not additional MCP tools or guest JavaScript methods**. Most operations use `POST /v1/tools/<operationId>` with a JSON body. Utilities use their own documented paths. The full schemas are available through `search` and the `tamperbox://catalog` resource.

| Capabilities                                                                                                                                                                                    | Inputs                                                                                                                 | Expected result and important behavior                                                                                                                                                                                                     | Try the browser counterpart                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transforms: `jwt_decode`, `json_format`, `json_to_yaml`, `yaml_to_json`, `timestamp_to_iso`, `api_convert`                                                                                      | Text artifact `{mediaType,value}` and operation-specific options: indent, timestamp unit, or conversion target         | Output artifact, warnings and provenance. JWT decode does not verify trust. Converters do not execute imported requests; JSON precision and duplicate-key limits apply.                                                                    | [JSON → YAML in Pipeline](https://tamperbox.dev/pipeline) ([docs](https://docs.tamperbox.dev/tools/json-to-yaml/)), [YAML → JSON in Pipeline](https://tamperbox.dev/pipeline) ([docs](https://docs.tamperbox.dev/tools/yaml-to-json/)), [JWT](https://tamperbox.dev/jwt) ([docs](https://docs.tamperbox.dev/tools/jwt/)), [timestamps](https://tamperbox.dev/unix-timestamp) ([docs](https://docs.tamperbox.dev/tools/unix-timestamp/)), [API converter](https://tamperbox.dev/postman-converter) ([docs](https://docs.tamperbox.dev/tools/postman-converter/)), [Pipeline](https://tamperbox.dev/pipeline)                                                                                                                                                                                    |
| Email: `email_domain`, `email_provider`, `spf_checker`, `dmarc_checker`, `dkim_checker`, `mta_sts_checker`, `bimi_checker`                                                                      | Domain; DKIM also requires a selector                                                                                  | Published routing/policy/key evidence, findings and explicit unavailable or partial checks. DNS configuration is not message authentication, mailbox existence or guaranteed delivery.                                                     | [Email domain](https://tamperbox.dev/email-domain), [SPF](https://tamperbox.dev/spf-checker), [DMARC](https://tamperbox.dev/dmarc-checker), [DKIM](https://tamperbox.dev/dkim-checker) ([docs](https://docs.tamperbox.dev/tools/dkim-checker/)), [MTA-STS](https://tamperbox.dev/mta-sts-checker), [BIMI](https://tamperbox.dev/bimi-checker)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Message analysis: `email_header_analyzer`                                                                                                                                                       | Raw header text in `headers`                                                                                           | Parsed fields, ordered hops, delay and claimed authentication results. Headers are untrusted; no cryptographic message verification or automatic IP enrichment.                                                                            | [Email Header Analyzer](https://tamperbox.dev/email-header-analyzer)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Hosting and services: `saas_stack`, `website_hosting`, `cdn_detector`, `dns_provider`, `website_technology`, `subdomain_finder`, `domain_health`                                                | Domain; optional subdomain result limit                                                                                | DNS, HTTP, network and certificate-log observations; detected matches with evidence and limitations. A proxy can hide origin hosting; CT names can be historical.                                                                          | [SaaS stack](https://tamperbox.dev/saas-stack) ([docs](https://docs.tamperbox.dev/tools/saas-stack/)), [hosting](https://tamperbox.dev/website-hosting) ([docs](https://docs.tamperbox.dev/tools/website-hosting/)), [CDN](https://tamperbox.dev/cdn-detector) ([docs](https://docs.tamperbox.dev/tools/cdn-detector/)), [DNS provider](https://tamperbox.dev/dns-provider) ([docs](https://docs.tamperbox.dev/tools/dns-provider/)), [technology](https://tamperbox.dev/website-technology) ([docs](https://docs.tamperbox.dev/tools/website-technology/)), [subdomains](https://tamperbox.dev/subdomain-finder) ([docs](https://docs.tamperbox.dev/tools/subdomain-finder/)), [domain health](https://tamperbox.dev/domain-health) ([docs](https://docs.tamperbox.dev/tools/domain-health/)) |
| DNS: `dns_lookup`, `dns_propagation`, `txt_lookup`, `cname_lookup`, `ns_lookup`, `soa_lookup`, `aaaa_lookup`, `srv_lookup`, `caa_lookup`, `dnssec_checker`                                      | DNS `name`; general lookup also accepts record `type` and `resolver`; propagation accepts `type`                       | DNS answers and protocol evidence, record-specific findings, or resolver comparisons. Empty answers, resolver failures and incomplete observations have different meanings. SRV needs the full service name.                               | [DNS lookup](https://tamperbox.dev/dns-lookup), [propagation](https://tamperbox.dev/dns-propagation), [DNSSEC](https://tamperbox.dev/dnssec-checker), [CAA](https://tamperbox.dev/caa-lookup)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Registration and mail transport: `domain_availability`, `whois_lookup`, `reverse_dns`, `dane_checker`                                                                                           | Domain, registration query `q`, public `ip`, or DANE `host` with optional port/STARTTLS                                | Registration facts, reverse-DNS confirmation or TLSA/certificate evidence. Registry absence does not guarantee availability; unavailable certificate probes are not mismatches.                                                            | [Registration](https://tamperbox.dev/whois-lookup), [availability](https://tamperbox.dev/domain-availability), [reverse DNS](https://tamperbox.dev/reverse-dns), [DANE](https://tamperbox.dev/dane-checker)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Network: `what_is_my_ip`, `connection_info`, `asn_lookup`, `bgp_lookup`, `open_port_checker`, `tcp_ping`, `minecraft_server_status`                                                             | Caller-context checks use `{}`; registry lookups use `q`; probes use port and/or host, with optional supported regions | Connection/network metadata or bounded reachability measurements. “My IP”, connection info and own-port checks observe the caller reaching the API, which may be the MCP server or a shared gateway—not the human browser.                 | [My IP](https://tamperbox.dev/what-is-my-ip), [connection](https://tamperbox.dev/connection-info), [BGP](https://tamperbox.dev/bgp-lookup), [TCP ping](https://tamperbox.dev/tcp-ping), [Minecraft](https://tamperbox.dev/minecraft-server-status)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| TLS and security contacts: `ssl_checker`, `post_quantum_checker`, `security_txt_checker`                                                                                                        | Domain                                                                                                                 | Presented certificate/negotiation evidence or security.txt findings. Server-vantage measurements do not establish every client's behavior; unavailable probes remain explicit.                                                             | [SSL](https://tamperbox.dev/ssl-checker) ([docs](https://docs.tamperbox.dev/tools/ssl-checker/)), [post-quantum TLS](https://tamperbox.dev/post-quantum-checker), [security.txt](https://tamperbox.dev/security-txt-checker)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| HTTP and page diagnostics: `security_headers`, `redirect_checker`, `mixed_content_checker`, `http3_checker`, `cors_tester`, `website_down_checker`, `broken_link_checker`, `open_graph_preview` | Public URL; CORS additionally needs origin and can specify method/header names/credentials; uptime can select regions  | HTTP evidence, redirects, headers, page findings, protocol checks or regional measurements. Checks are bounded and do not run target JavaScript or crawl an entire site. CORS credentials is an evaluation flag, not supplied credentials. | [Headers](https://tamperbox.dev/security-headers), [redirects](https://tamperbox.dev/redirect-checker) ([docs](https://docs.tamperbox.dev/tools/redirect-checker/)), [HTTP/3](https://tamperbox.dev/http3-checker) ([docs](https://docs.tamperbox.dev/tools/http3-checker/)), [CORS](https://tamperbox.dev/cors-tester) ([docs](https://docs.tamperbox.dev/tools/cors-tester/)), [uptime](https://tamperbox.dev/website-down-checker), [Open Graph](https://tamperbox.dev/open-graph-preview)                                                                                                                                                                                                                                                                                                  |
| Published site files: `robots_txt_checker`, `ads_txt_checker`, `llms_txt`                                                                                                                       | Domain                                                                                                                 | Parsed robots.txt, ads.txt or llms.txt and findings. API schemas define the supported subset; use the additional artifact operations below for rule simulation, alternate site files and draft/repair modes.                               | [Robots/sitemap](https://tamperbox.dev/robots-txt-checker), [ads.txt](https://tamperbox.dev/ads-txt-checker), [llms.txt](https://tamperbox.dev/llms-txt)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Workflow utilities: `tamperbox_pipeline`, `tamperbox_find`, `get_recipe`                                                                                                                        | Pipeline version/input/steps; directory query/media filters; recipe ID in its path                                     | Named pipeline outputs, matching directory entries, or a recipe definition. A recipe fetch does not execute it. Remote directory search makes a network call; MCP `search` does not.                                                       | [Pipeline](https://tamperbox.dev/pipeline), [directory](https://tamperbox.dev)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The current catalog contains 120 operations covering 60 remotely executable website tools. The table summarizes the original live and transform families; the [additional artifact and diagnostic workflows](#additional-artifact-and-diagnostic-workflows) add analysis, build, repair, fixture and inspection variants. Across the API and data-format workflows, those variants are `jwt_verify`, `jwt_rebuild`, `jwt_fixture`, `timestamp_convert`, `timestamp_adjust` and `api_convert_report`.

### Understand inputs and results

A transform artifact is `{ "mediaType": "…", "value": "…" }`. Its value is **text**, including serialized JSON. Use `JSON.stringify(data)` to supply JSON text and `JSON.parse(response.output.value)` to read it as an object. Diagnostic operations instead take typed fields such as `{domain:"example.com"}` and return `{result,warnings,provenance}`. The diagnostic `result` is an object, not a text artifact; read each output schema before chaining.

Run this async function body through the `execute` MCP tool:

```js
const formatted = await tamperbox.request({
  method: 'POST',
  path: '/v1/tools/json_format',
  body: {
    input: { mediaType: 'application/json', value: '{"example":true}' },
    options: { indent: 2 },
  },
});
return formatted.output;
```

Expected MCP result:

```json
{
  "result": {
    "mediaType": "application/json",
    "value": "{\n  \"example\": true\n}"
  },
  "apiCalls": 1
}
```

`tamperbox.request` returns the decoded API response body. Return the complete body to retain warnings and provenance, or select only useful fields. Provenance identifies the provider, version, operation and browser editor link; the link does not automatically load your private input.

The outer MCP `result` is whatever your code returns. `apiCalls` counts **bridge calls attempted, including host-validation failures**; guest serialization failures are excluded. It is not a count of upstream HTTP requests. Successful MCP responses provide the same object as structured content and JSON text for client compatibility.

## Run from source

```sh
npm ci
npm run build
node dist/cli.js
```

To target a matching expanded API already running locally, configure its origin explicitly (replace the example port as needed):

```sh
TAMPERBOX_API_BASE_URL=http://127.0.0.1:8788 \
TAMPERBOX_ALLOW_LOCAL_HTTP=true node dist/cli.js
```

Loopback HTTP is a development option. The default API origin is `https://api.tamperbox.dev`, where the matching expanded REST API is deployed. This does not deploy the separate Code Mode MCP service; see the [deployment and verification record](docs/code-mode-expansion.md).

The default stdio transport writes only MCP messages to stdout. Connect your client using `node /absolute/path/to/tamperbox-mcp/dist/cli.js`. The package is published as [`tamperbox-mcp@0.2.0`](https://www.npmjs.com/package/tamperbox-mcp). To run the released stdio server, use `npx -y tamperbox-mcp@0.2.0`.

For a one-shot shell call, pipe JavaScript into the example client:

```sh
printf 'return 6 * 7;\n' | node examples/stdio-execute.mjs
# {"result":42,"apiCalls":0}
```

The client waits for the response before disconnecting. Piping raw MCP requests directly into the server closes its stdin at EOF and cancels active work. See [shell usage](docs/integrations.md#shell-scripts-and-one-shot-calls).

For a local HTTP endpoint:

```sh
node dist/cli.js --transport http --port 3000
```

Connect to `http://127.0.0.1:3000/mcp`. `/health` returns readiness of the process, not upstream API availability. Public hosting requires HTTPS termination and explicit host configuration; see [deployment](docs/deployment.md).

## Code mode

Your client sees exactly two MCP tools. Both accept `{code, timeoutMs?}`, where `code` is an async JavaScript function body and the optional execution deadline is 1–30,000 ms (default 15,000).

| MCP tool  | Available objects                                                                                                                   | Result                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `search`  | `spec`: bundled OpenAPI document; `operations`: resolved endpoint summaries, descriptions, schemas and metadata. No request bridge. | Selected JSON in `result`; `apiCalls` is always `0`. No network requests.                               |
| `execute` | `tamperbox.request({method,path,query?,body?})`: generic bridge to a documented API route.                                          | Selected JSON in `result`, plus `apiCalls`: bridge calls attempted, including host-validation failures. |

First call `search` with code such as:

```js
return operations
  .filter((op) => /spf|dmarc|dkim/i.test(op.summary + ' ' + op.description))
  .map((op) => ({
    operationId: op.operationId,
    method: op.method,
    path: op.path,
    description: op.description,
    inputSchema: op.inputSchema,
    outputSchema: op.outputSchema,
  }));
```

Use `operations.filter(...)` to find related capabilities, or inspect `spec.paths` directly. Endpoint `requestBody` and `responses` retain OpenAPI examples. Return relevant fragments instead of the entire specification. Discovery is a bundled snapshot; it cannot establish remote deployment readiness.

Then call `execute`. This example chains two transforms available in the earlier API as well as the expanded contract:

```js
const decoded = await tamperbox.request({
  method: 'POST',
  path: '/v1/tools/jwt_decode',
  body: {
    input: {
      mediaType: 'application/jwt',
      value: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJleGFtcGxlIn0.',
    },
  },
});
const yaml = await tamperbox.request({
  method: 'POST',
  path: '/v1/tools/json_to_yaml',
  body: { input: decoded.output },
});
return {
  output: yaml.output,
  warnings: decoded.warnings,
  provenance: yaml.provenance,
};
```

The result is `{ "result": <your returned JSON>, "apiCalls": 2 }`. `apiCalls` counts bridge calls attempted, including host-validation failures, against the per-execution budget. Arguments rejected during guest serialization do not reach the bridge and are excluded. The field name is retained for compatibility.

Use the documented uppercase HTTP method and path. `query` accepts scalar string, number or boolean values; `body` must match the endpoint's JSON schema. Full URLs, arbitrary headers, unknown paths and undocumented arguments are rejected. Path parameters are substituted into the path, for example `/v1/recipes/jwt-to-yaml`; query parameters belong in `query`, not a `?` suffix.

Decoding a JWT does **not** verify its signature, validity or trust. API conversion does not execute requests and may lose unsupported features. Diagnostic operations may contact the requested public host, resolver or registry through the API; inspect limitations and partial results before drawing conclusions.

Use `await`, loops, conditionals, array methods and `Promise.all`. Batches queue automatically with at most four API calls in flight; all queued calls count toward the 20-call budget. There is no `fetch`, filesystem, `process`, package import, timer API or host environment inside the guest. `console`, `TextEncoder`, `TextDecoder`, `atob`, `btoa` and `Intl` are also unavailable. Use `return` to produce a result. An omitted return becomes `null`; cyclic, BigInt, function, symbol and non-finite results are rejected. JSON objects follow JSON serialization semantics (for example, undefined object fields are omitted). Await every API call; outstanding calls are cancelled when execution ends.

Guest failures return bounded `details.name`, `details.message` (up to 1,024 characters), and a one-based `details.line` when a source location is available. Locations account for JavaScript line terminators, including CR and Unicode separators. Incomplete code detected at the wrapper's closing line points to the last submitted line. These diagnostics are returned only to the caller and can contain values from the submitted code. Uncaught API failures identify the operation in `details.operation` (up to 64 characters), including when no guest source line is available. API failures remain redacted; guest `catch` blocks can inspect `error.operation`, `error.code`, `error.status` when available, and `error.details.validation` for input errors. The VM provides no host stack traces or raw upstream error bodies.

The request object must serialize to JSON. Functions, symbols and objects whose `toJSON()` returns `undefined` produce a guest `TypeError` before dispatch and do not consume the API call budget. Omitting the request or passing `undefined` also fails guest serialization; supply an object with the documented `method` and `path`. Normal JSON serialization rules apply to nested properties.

The 64 MiB cap covers the guest VM’s WebAssembly linear memory, not total process RSS. Node heaps, native runtime overhead and transport buffers need additional memory. Successful MCP responses repeat the result as text and structured content for compatibility, so the 2 MiB result limit is not a limit on total HTTP/MCP message size.

## Connect an AI client

[Integration instructions](docs/integrations.md) cover ChatGPT custom MCP plugins, Codex, OpenAI Responses API, Claude Code, Claude Desktop, Anthropic Messages API, VS Code and other MCP clients. Ready-to-edit examples are in [examples](examples/). The short version for any client is [Connect an MCP client](https://docs.tamperbox.dev/mcp/connect/) on the documentation site.

Local stdio works from npm or this checkout. Remote clients can use [production Code Mode](https://mcp.tamperbox.dev/mcp) with no authentication; see [production acceptance and limits](docs/production-acceptance.md) and [connection examples](docs/integrations.md). Marketplace and registry publication require account ownership and provider review; see [release guide](docs/releasing.md).

## Data and execution limits

Code executes in a fresh QuickJS WebAssembly VM within a worker thread. Only allowlisted API calls cross the sandbox boundary. Inputs to those calls leave the machine and are sent to `https://api.tamperbox.dev` by default; code itself is not sent to that API. If you host this server remotely, the hosting server receives the code and all embedded inputs. The MCP client/model provider also sees tool requests and returned results. This server does not persist or log code, inputs or outputs; hosting/proxy and provider logging policies are separate.

| Limit                                                | Default                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| Code / input to each API call                        | 64 KiB / 1 MiB, measured as UTF-8                                      |
| Result / each API response                           | 2 MiB serialized JSON                                                  |
| JSON nesting                                         | 40 levels                                                              |
| Wall-clock execution                                 | 15 seconds, selectable from 1–30,000 ms                                |
| Upstream request                                     | 30 seconds, bounded by the execution deadline; no retries or redirects |
| API calls per execution / parallel calls             | 20 / 4                                                                 |
| Active code executions per process                   | 4                                                                      |
| QuickJS allocator budget / stack                     | 32 MiB / 512 KiB                                                       |
| Hard WebAssembly linear-memory ceiling per execution | 64 MiB, including ArrayBuffer and typed-array backing stores           |
| HTTP requests per minute / active requests           | 120 / 16, per process                                                  |
| HTTP request body / body read deadline               | 1 MiB / 5 seconds                                                      |

See [security](SECURITY.md) for boundaries and [architecture](docs/architecture.md) for implementation details. Use browser-local Tamperbox tools for sensitive material you cannot send to a remote API.

## Develop and verify

```sh
npm ci
npm run check
npm run test:live  # opt-in legacy API smoke; not proof of expanded API deployment
```

Tests cover contracts, real stdio and HTTP MCP clients, API errors, sandbox escapes, cancellation, resource limits and packaging. Coverage gates apply to in-process host modules; the CLI and VM worker are verified through separate processes and are not included in that percentage. The default suite is offline except for loopback HTTP; it never needs model-provider credentials. See [testing](docs/testing.md) and the [verification record](docs/verification.md).

MIT licensed. Contributions should include a failing regression test before the fix; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Browse website tools by task

The bundled `spec['x-tamperbox-directory']` lists all 67 website tools in 11 categories, including six browser-only tools and the website-only Locator Checker. Use MCP `search` to inspect this metadata without making a network request:

```js
const directory = spec['x-tamperbox-directory'];
return {
  categories: directory.categories,
  tools: directory.tools.filter((tool) => tool.category === 'localization'),
};
```

Each tool includes its category, related tool IDs, website and documentation URLs, execution mode, and `operationIds`. An empty `operationIds` list means the tool has no executable API operation; open its website page instead. Ordinary related links carry no input. Result actions transfer only compatible derived values.
