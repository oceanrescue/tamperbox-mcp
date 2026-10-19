# Testing and verification

Run `npm run check` for formatting, strict TypeScript checking, coverage tests and an extracted npm tarball smoke test. Local HTTP tests require permission to bind loopback ports. No default test calls the public API or a model provider. Runtime dependencies are pinned in `package-lock.json`.

## Test layers

| Suite                    | Evidence                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog and API contract | Expanded snapshot: 58 operations representing 53 website entries, all POST examples validate, immutable programmable search, strict method/path/query/body and response checks. Legacy eight-operation fixtures remain for compatibility regression tests. |
| REST bridge              | Correct methods/paths/query encoding, byte limits, UTF-8 errors, cancellation, malformed/oversized bodies, HTTP failures, no retries or redirects                                                                                                          |
| Sandbox                  | Real QuickJS workers; unavailable host globals/imports, constructor access, prototype isolation, parallel calls, call budgets, busy handling, time/heap/output limits, non-JSON results, recovery                                                          |
| MCP server               | Official SDK in-memory client, schema discovery, structured/text parity, annotations, resources and tool errors                                                                                                                                            |
| HTTP                     | Official Streamable HTTP client; multiple protocol revisions, Host/Origin checks, bearer auth, batches, malformed RPC, slow/chunked bodies, rate/capacity and status paths                                                                                 |
| CLI                      | Real stdio subprocess; help/version, validation, environment configuration and protocol cleanliness                                                                                                                                                        |
| Release                  | Official registry-schema validation, aligned versions, public registry lockfile, config examples, extracted-tarball execution                                                                                                                              |

Coverage gates: 90% statements, lines and functions; 85% branches on host modules. The CLI entrypoint and QuickJS worker run in separate processes/threads and are excluded from this in-process V8 percentage; their behavior is tested directly. The export-only index is also excluded. Coverage is supporting evidence, not a claim that every behavior or exploit is covered.

Review regressions additionally cover hard binary-allocation limits, bounded caller diagnostics, queued batches, hostile error objects and inherited Node launch flags. Source-location tests cover incomplete expressions, all JavaScript line terminators, nested async throws and unchanged template contents. Bridge error tests cover inherited getters, changed array iteration, per-operation failures and argument serialization before dispatch. Official MCP-client tests verify operation metadata, upstream body redaction and serialization-error locations; see [the independent review record](review-fixes.md).

Stdio shutdown tests launch the compiled CLI and complete initialization over raw JSON-RPC pipes. A loopback API request proves each guest has started before the client ends or destroys stdin. Tests require prompt clean exit with one or four busy guests, closure of stalled upstream requests without dispatching queued calls, idle EOF, and POSIX SIGINT/SIGTERM. Cleanup forcibly reaps a failing child so regression runs cannot leave orphaned loops. Signal cases skip Windows, where `child.kill()` forcibly terminates the child; EOF cases run on every platform.

The work followed test-first batches: API/catalog and sandbox tests; missing sandbox implementation failed the first run; MCP/HTTP tests failed before their modules existed; CLI tests preceded the CLI; structural-depth regression tests failed before the JSON guard was added. Incorrect response fixtures were corrected to the published output media types rather than weakening validation.

## Live API verification

`npm run test:live` intentionally sends the legacy eight-operation synthetic examples to the official API and exercises a generic-request JWT-to-YAML chain. It does not verify production availability of the 50 new diagnostic operations. It is opt-in to avoid making CI depend on API availability, costs or rate limits. The legacy snapshot in `test/fixtures/openapi.json` was retrieved from `https://docs.tamperbox.dev/openapi.json` on 2026-10-17. The expanded execution contract is `src/openapi.json`, generated from the matching Tamperbox API source. Refresh contracts as reviewed data, never from an untrusted user URL.

A successful live check is evidence for that time, not an uptime guarantee. Deployment URL, TLS, provider account connections, model-triggered tool use, marketplace approval and container-runtime behavior need separate acceptance checks. See [integrations](integrations.md) and [releasing](releasing.md).
