# Release acceptance record

## 0.2.0 — published package, 2026-10-18

The implementation is published on GitHub at [`0e2b066`](https://github.com/oceanrescue/tamperbox-mcp/commit/0e2b0660c671546a0553e7a0c0891adc850cde0b). It exposes exactly two MCP tools, `search` and `execute`, over 58 API operations representing all 53 website entries. Entry coverage does not imply support for every browser mode. See [the expansion record](code-mode-expansion.md) for deployment versions, feature limits, reproduction commands and the probe repair.

| Gate                            | Evidence and remaining work                                                                                                                                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local checks                    | 303 MCP tests pass on Node 22.22.3, 24.16.0 and 26.8.2. Full Node 22 checks include formatting, types, coverage and extracted-package acceptance. The API suite passes 826 tests.                                                                              |
| GitHub CI                       | [The hosting run](https://github.com/oceanrescue/tamperbox-mcp/actions/runs/39119461450) succeeded, including the Node/OS matrix, container and isolated hosting checks.                                                                                       |
| Package candidate               | Published 0.2.0 contains 62 allowlisted files. Its immutable tarball SHA-256 is `5a07b508ddf08ad3c784543011ff8929b3199b38ceb352264e09a7aac6993eac`; extracted stdio, search, execution and one-shot checks pass.                                               |
| Contract and API integration    | Bundled and deployed OpenAPI documents match. The official MCP client exercised all 58 operations through the sandbox and real local API Worker with synthetic external services.                                                                              |
| Production REST API             | The expanded REST API is deployed. 56 of 58 production examples returned schema-valid successes after the TLS probe repair; subdomain discovery and BGP remained unavailable or timed out. These failures are not empty results.                               |
| Isolation and dependencies      | Fresh hardened 512 MiB container survived concurrent catalog and binary-allocation probes without OOM; runtime dependency audit reported zero known vulnerabilities.                                                                                           |
| Provider examples               | OpenAI and Anthropic envelopes were checked against official documentation and exercised with mocked provider requests and the actual MCP tool list. Twelve existing client configuration/stdio tests pass. This does not establish provider-model acceptance. |
| npm                             | Published 0.2.0 via npm staged publishing and browser approval on 2026-10-18. Registry integrity matches the reviewed tarball; a clean registry install passed tool discovery, 58/53 catalog checks, isolated execution and a live synthetic API call.         |
| Hosted Code Mode endpoint       | Dedicated preview deployed from `9da3e6a`; 15 hosted checks and four lifecycle checks pass. Initial image provisioning exceeded the startup deadline; later checks passed. See [hosted acceptance](hosted-acceptance.md).                                      |
| Provider models and client UIs  | Live JSON formatting passes through Codex CLI 0.163.0 and Claude Code 2.1.284 using the hosted preview. Provider API connectors, other client UIs and the full marketplace review cases remain pending.                                                        |
| Registry and marketplaces       | npm prerequisite is complete. Namespace verification and the respective submission/review processes remain pending.                                                                                                                                            |
| API documentation clarification | Explicitly approved and deployed as bdf6f8b7-03cd-4a21-90ee-c64579ba5807. Ten postdeployment assertions pass: docs match, OpenAPI is unchanged, live API examples succeed and the legacy MCP retains its seven tools.                                          |

The source, npm package and hosted preview are published. The bounded live client checks do not establish marketplace approval or universal diagnostic availability. Follow [the provider checklist](#provider-acceptance-still-requiring-configuration) and [release instructions](releasing.md).

## Historical 0.1.0 preparation

The sections below preserve the earlier acceptance evidence. Their test counts, eight-operation coverage and publication observations describe those revisions, not the current candidate.

Initially prepared on 2026-10-17 for `tamperbox-mcp@0.1.0` at `2d083ab`, after the review fixes through `2316d43` and the bridge-call accounting documentation/metadata update. The subsequent stdio shutdown validation is recorded below. The accounting field remains `apiCalls`; its behavior is unchanged. This record covers local release preparation, not publication or provider approval.

## Initial completed checks at 2d083ab

| Check                        | Result                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full check on Node 22.22.3   | 212 tests across 13 files pass; formatting, strict TypeScript and coverage gates pass                                                                                            |
| Host coverage                | 96.97% statements, 91.92% branches, 96.00% functions, 97.70% lines; worker/CLI exclusions remain documented                                                                      |
| Package acceptance           | Extracted npm tarball initializes through the official stdio client and executes code; package contents satisfy the allowlist checks                                             |
| Integration transports       | Official MCP-client tests pass for in-memory, stdio and Streamable HTTP, including schema discovery and tool execution                                                           |
| Field-description acceptance | A separate stdio probe reads the `apiCalls` schema description; a caught host-validation failure plus a caught guest-serialization failure returns `{ result: 42, apiCalls: 1 }` |
| Live Tamperbox API           | All eight synthetic operation examples and the two-call JWT-to-YAML chain pass                                                                                                   |
| Dependency audit             | npm audit reports zero vulnerabilities, including development dependencies                                                                                                       |
| Registry metadata            | Official schema fixture validation passes; package, server and registry identities/versions agree                                                                                |
| Repository metadata          | Package and registry repository URLs match the configured `oceanrescue/tamperbox-mcp` origin; the remote read succeeded and returned no branch heads                             |
| Package name lookup          | npm returned E404 for `tamperbox-mcp`; this does not reserve the name or establish publishing rights                                                                             |
| Provider examples            | Both JavaScript examples pass syntax checking; request fields were checked against current official documentation                                                                |

The full suite includes the existing memory, cancellation, queued-call and diagnostic regressions. Previous multi-Node/container measurements remain in [the review record](review-fixes.md); no new container or latency measurement is claimed for this documentation/metadata change.

## Stdio shutdown follow-up

The CLI now shuts down on stdin EOF or closure during active execution. The current full check passes **219 tests across 14 files** on Node 22.22.3, and the suite also passes on Node 24.16.0 and 26.8.2. Seven new subprocess cases cover active/idle disconnects, queued and pending requests, and POSIX signal behavior; four of them failed before the fix. Coverage percentages are unchanged, and extracted-package acceptance passes. See [the independent reproduction](review-fixes.md#stdio-disconnect-review). Build a fresh tarball from this revision; the previously prepared `2d083ab` artifact does not include the shutdown fix. Live API, audit and remote-account observations in the initial table were not rerun for this patch.

## One-shot shell client follow-up

The pipe-friendly SDK client example is included in the npm package and exercised from the extracted tarball outside the checkout. The latest full check passes **227 tests across 15 files** on Node 22.22.3; the suite also passes on Node 24.16.0 and 26.8.2. Coverage is unchanged. Server EOF shutdown remains immediate, and all disconnect regressions still pass. See [the shell-client review](review-fixes.md#one-shot-shell-client-review) for the reproduced behavior and eight new test cases. Build a fresh tarball to include this example; previous artifacts do not contain it. No live API, container, dependency-audit or remote-account checks were rerun for this follow-up.

## Provider acceptance still requiring configuration

The execution environment has no `TAMPERBOX_MCP_URL`, OpenAI/Anthropic API credentials or model selections configured. Provider-model calls, client UI installation and hosted TLS/auth behavior have not been accepted by these local checks.

| Target                                       | Next concrete acceptance check                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI Responses API                         | Set the endpoint, `OPENAI_API_KEY` and `OPENAI_MODEL`; run `examples/openai.mjs`; inspect and respond to approval requests, then verify both discovery and execution calls complete |
| Anthropic Messages API                       | Set the endpoint, `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`; run `examples/anthropic.mjs`; verify discovery/execution tool results and the final answer                             |
| ChatGPT, Codex, Claude Code/Desktop, VS Code | Install the corresponding configuration in the intended client and complete the [manual acceptance checklist](integrations.md#manual-acceptance-checklist)                          |
| Hosted endpoint                              | Verify this checkout's build is deployed at the chosen HTTPS URL; test configured authentication, timeout and disconnect behavior there                                             |

OpenAI's documented Responses flow uses `mcp` tools, an optional tool allowlist and per-call approval responses. Each subsequent approval request needs its own response; an approval request alone is not a successful execution. See [OpenAI MCP tools](https://developers.openai.com/api/docs/guides/tools-connectors-mcp).

Anthropic's documented connector uses an HTTPS endpoint, `mcp_servers`, a matching `mcp_toolset` and the supported `mcp-client-2025-11-20` beta header used by this repository. See [Anthropic MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector).

## Publication steps for the current candidate

The source repository and expanded REST API are published, as recorded in the current gate table above. npm publication is verified. Continue the remaining steps in [releasing](releasing.md). MCP Registry publication additionally needs namespace verification; marketplace submission needs publisher/listing/reviewer information and provider review. Record the release commit and artifact integrity hash alongside the final tarball, outside the tarball itself.
