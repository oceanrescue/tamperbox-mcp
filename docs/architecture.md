# Architecture

```text
MCP client ── stdio or HTTPS /mcp ── official MCP SDK
                                      ├─ search → isolated JS over bundled OpenAPI
                                      └─ execute → parent broker
                                                     ├─ fresh worker → QuickJS/WASM
                                                     └─ validated REST calls → Tamperbox API
```

The MCP surface stays small: `search` runs an async JavaScript body over the bundled `spec` and resolved `operations` array, and `execute` runs one with a generic `tamperbox.request({method,path,query?,body?})` bridge. Search has no API bridge. A JSON catalog resource containing `{spec,operations}` is also available at `tamperbox://catalog`. Code mode is exposed by the server, so the client does not need its own code runner.

Both tools return `{ result, apiCalls }`; search always reports `apiCalls: 0`. `result` is the guest's returned JSON; `apiCalls` counts bridge calls attempted, including host-validation failures, against the per-execution call budget. It is not an upstream HTTP-request count. Arguments rejected during guest serialization are excluded because no bridge call occurs. The public field name remains unchanged for compatibility.

`src/openapi.json` is the standalone bundled execution contract. `src/spec.ts` resolves local references, derives operations and compiles input/output validation from it. Only supported method/path combinations can execute; path parameters and scalar query values are validated separately. External references and arbitrary URLs are forbidden. No sibling repository is needed to build or run the package. Updating API coverage requires a reviewed snapshot and matching implementation/tests; a live discovery response cannot dynamically grant new capabilities.

The expanded snapshot has 58 operations representing all 53 website entries: 50 diagnostic reports, five transforms and three workflow utilities. Coverage is by website entry, not every browser UI mode. Many generators, pasted-input modes and visual interactions remain outside the API contract. The matching expanded REST API is deployed; this MCP interface is available from source and as `tamperbox-mcp@0.2.0` on npm. Deployment and acceptance evidence is recorded in [Code Mode expansion](code-mode-expansion.md). Never infer availability from a bundled catalog alone.

The corresponding Tamperbox API owns network restrictions, diagnostic composition, report semantics and probe dependencies. It reuses website parsers and server checks. The MCP owns code isolation and a generic request broker, not a handwritten guest function for each website tool. Diagnostic responses use `{result,warnings,provenance}`; transforms use artifacts such as `{output:{mediaType,value},warnings,provenance}`. The MCP's outer result is independently selected by guest code.

`ApiClient` constructs fixed routes, validates both directions, bounds UTF-8 bytes and deadlines, rejects redirects, and suppresses upstream error bodies. No retries are automatic. `CodeRunner` owns per-execution and process budgets. It creates a worker with an empty environment and isolated Node launch flags, queues calls behind the parallelism limit, and brokers only JSON messages. `sandbox-worker` creates a QuickJS runtime, installs the frozen request bridge for execution or local specification data for search, and pumps promise jobs. Pending API work wakes on port messages rather than a fixed polling interval; runnable promise jobs yield to the worker event loop in bounded batches. Results cross the bridge as JSON strings, never host object references. The parent aborts API calls and terminates the worker on completion, cancellation or deadline.

The HTTP adapter creates a stateless MCP server per request, sharing one bounded runner across requests. It uses Streamable HTTP JSON responses. It does not allocate sessions or support unsolicited server events; GET/DELETE on `/mcp` return 405. Tool errors use MCP `isError`; malformed requests use protocol or HTTP errors. The SDK handles negotiation; compatibility tests exercise several protocol revisions and SDK clients.

The stdio CLI treats stdin `end` and `close` as client disconnection and uses the same idempotent shutdown path as SIGINT/SIGTERM. It closes the MCP server, which aborts in-flight request handlers, then exits. Active guests and pending upstream requests do not remain running until their normal deadlines after the client disconnects.

QuickJS was chosen for a portable npm/Node distribution with a 32 MiB allocator budget, a 512 KiB stack limit and interrupt limits, plus a hard 64 MiB WebAssembly linear-memory cap. The separate cap covers backing stores not counted by the QuickJS allocator; it is not a total process-memory budget. Node worker threads keep computation off the MCP event loop and allow forced termination. Workers are not an OS security sandbox; deployment controls remain necessary. See [QuickJS upstream documentation](https://github.com/justjake/quickjs-emscripten) and the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x).

The exposed API does not mutate persisted application state, so execution has `readOnlyHint: true`. Diagnostic calls can still initiate bounded network measurements of public targets. Code may contain nondeterminism and the directory can change, so `idempotentHint` is false. `openWorldHint` is true because execution sends data to an external API. Search is local and has no network effects; its annotation is idempotent even though supplied JavaScript can choose nondeterministic output.
