# Independent review verification and fixes

The supplied review was treated as a set of claims to reproduce. These checks used newly written probes/tests against the actual installed dependencies, rather than running the supplied probe scripts. Verified on 2026-10-17.

## Confirmed memory-limit failure

Before the fix, a guest retained six filled 16 MiB buffers (96 MiB) and returned successfully despite the 32 MiB QuickJS allocator budget. Regression tests independently reproduced the bypass with ArrayBuffer, Uint8Array, Float64Array and DataView backing stores, including four concurrent executions. A test that grows only ordinary arrays does not cover this failure.

Each execution now instantiates its own WebAssembly memory with 256 initial pages and a maximum of 1,024 pages (64 KiB per page: 16 MiB initial, 64 MiB maximum). The existing 32 MiB allocator budget and 512 KiB stack limit remain. The hard ceiling covers binary backing stores; it does not claim to bound total Node/process RSS. Binary constructors remain available under the cap.

Four concurrent attempts to retain 64 filled 16 MiB buffers each were rejected inside a non-root, read-only, network-disabled Linux ARM64 container limited to 512 MiB. A subsequent execution returned 42. The observed cgroup peak was 285,229,056 bytes (about 272 MiB) for this run, not a universal RSS guarantee. Ordinary 100,000-object processing plus a 1.9 MB string result also passes under the cap.

## Diagnostics and batching

Syntax errors, missing identifiers, invalid output types and upstream failures previously collapsed to the same opaque message. Guest errors now provide bounded names/messages and a code line when available. Safe bridge error codes/statuses survive inside guest catch blocks. Uncaught validation errors include the schema path and rule, with structured validation details available in catch blocks. Upstream error bodies and unknown host exception messages remain redacted.

Diagnostic extraction captures VM intrinsics before user code, reads data descriptors rather than ordinary accessors, and never transfers arbitrary thrown objects to the host. It runs within the same resource/deadline limits; hostile Proxy traps cannot escape those limits. Host stack traces are not returned. Guest messages can contain guest data and are disclosed only in the caller's tool response, not logged.

A five-item Promise.all previously failed the execution at the parallelism limit. Calls now enter a bounded host queue: at most four run concurrently, every queued request counts toward the total call budget, and cancellation drops queued calls and aborts in-flight requests. Tests cover completion order, rejection recovery, custom parallelism, cancellation and queued-call budgets.

## Remaining review points

- `console` is absent. Documentation now says so explicitly and lists the unavailable browser-style encoding globals and Intl; no silent no-op console was introduced.
- The worker previously polled every millisecond. Pending I/O now wakes through port messages; active promise jobs yield in bounded batches. Never-settling promises still hit the parent deadline. An observational four-call/1.5-second probe used about 408 ms CPU before and 187 ms after, including startup; this is not a portable performance threshold.
- Discovery now declares an output schema, and static tool/resource lists advertise `listChanged: false`.
- Text plus structured output is retained for client compatibility. Documentation clarifies that the result byte limit does not bound the entire duplicated/escaped MCP envelope.
- An additional independently discovered bug affected callers launched with Node `--input-type=module`: workers inherited an incompatible launch flag. Worker `execArgv` is now isolated, and a real subprocess regression covers that use.

## First review validation

The new review regression file contains 23 tests. All 177 tests pass on Node 22.22.3, 24.16.0 and 26.8.2; `npm run check` passes, including type checking, formatting, coverage gates and extracted-tarball MCP execution. Host coverage is 96.97% statements, 91.92% branches, 96.00% functions and 97.70% lines. CLI and worker code remain covered behaviorally by subprocess/worker tests rather than the in-process coverage percentage. The original release's eight live API checks remain historical evidence; this patch does not change REST endpoint mappings.

## Follow-up review and fixes

The follow-up findings were independently inspected on 2026-10-17. Eighteen new cases in `test/diagnostics.test.ts` produced 13 failures before implementation, then all passed with these corrections:

- An incomplete expression such as `return (` previously lost its location because QuickJS reported the wrapper's closing line. Parse errors beyond the submitted source now point to its last line, including trailing blank lines. Runtime failures in result serialization remain unlocated instead of being attributed to user code.
- Additional probes found incorrect locations after lone CR, U+2028 and U+2029 separators. QuickJS reports LF-based lines and Unicode code-point columns; the worker maps those positions to the submitted source's JavaScript line boundaries. It does not rewrite code or template literal contents. Tests include CRLF, non-ASCII prefixes, mixed terminators and nested throws after an await.
- An inherited `Object.prototype.status` or `details` getter could replace a safe API error during construction. Inherited `get`/`set` properties and a replaced array iterator also broke construction. The bridge now checks only own fields, uses descriptors with no prototype and avoids guest array iteration. Safe codes, messages and statuses survive these mutations.

All **195 tests across 12 files** pass on local macOS ARM64 Node **22.22.3, 24.16.0 and 26.8.2**. Node 26 was directly verified using the Homebrew installation; it was not inferred from CI configuration. `npm run check` passes with unchanged host coverage percentages and an extracted-tarball MCP smoke test. These changes are in the worker, which is verified by real worker tests rather than the host coverage percentage.

A fresh Linux ARM64 image was built from the changed source and executed by its exact image ID (`e31c89d11a7ab02bf9cb5eac05f737d016699151ad35aedb1a62f76979080d99`). The compiled worker's SHA-256 matched the checkout build (`8fcdae0871b823b6122544040301faa40d0bb13547e18b397190db2b40ed5780`). Under Node 22.23.3, non-root execution, no network, a read-only filesystem, a 512 MiB memory limit, two CPUs, a 64-PID limit, dropped capabilities and no-new-privileges, the diagnostic probes and four simultaneous binary-memory exhaustion attempts passed. Normal execution returned 42 afterward. The cgroup peak was **308,113,408 bytes (about 294 MiB)**, with zero OOM events or kills. This is a separate measurement from the first review's 272 MiB observation.

For latency, 30 sequential `CodeRunner.execute('return 42;')` calls after five warmups measured a 29.8 ms median and 31.8 ms p95 on Node 22.22.3, including worker creation and termination. This is an observational local sample, not a controlled comparison with the original release or a portable performance threshold. Fresh per-execution isolation and the hard memory cap remain in place.

## API boundary review

Independent probes on 2026-10-17 confirmed both remaining diagnostic gaps. A successful `find` followed by a failed `recipe` reported HTTP 503 without identifying the operation. Passing a function, symbol or object whose `toJSON()` returned `undefined` produced a generic host error. These arguments also consumed a bridge-call slot despite never reaching the API. BigInt and circular arguments already raised guest TypeErrors.

The host now attaches the fixed operation name to each individual error reply without mutating the original exception. Guest catch blocks receive `error.operation`; uncaught diagnostics expose `details.operation`, bounded to 64 characters and extracted without ordinary getters. Existing error codes, statuses, validation details and upstream-body redaction are preserved. This identifies asynchronous API failures even when no guest source line is available; no line is invented.

The operation wrapper now rejects an undefined serialization result with a captured guest TypeError constructor before dispatch. The message names the operation, the diagnostic retains the guest source line, and the rejected argument consumes no API call budget. Omitted or explicit undefined arguments still default to an empty object. Nested values retain normal JSON serialization behavior.

The first test-first batch contained 13 cases, with 11 failures before the fixes. The final addition is **17 cases**: 15 bridge regression cases plus two official MCP-client cases covering the full API-error and serialization-error response paths. All **212 tests across 13 files** pass on Node **22.22.3, 24.16.0 and 26.8.2**. `npm run check` passes, including coverage gates and extracted-tarball execution; host coverage remains 96.97% statements, 91.92% branches, 96.00% functions and 97.70% lines. Earlier container and latency observations above belong to the preceding revisions and were not rerun for this patch.

## Stdio disconnect review

Independent subprocess tests confirmed that closing stdin while code was executing left the server alive. The installed SDK transport forwards stdin data/errors but does not forward EOF or stream closure. Its protocol close handler already aborts active request handlers; the missing step was invoking it on disconnect.

The stdio CLI now listens for stdin `end` and `close`, routing both through the existing SIGINT/SIGTERM shutdown path. A guard makes shutdown idempotent when multiple events arrive. Listeners are installed before connecting the transport. Server closure aborts active handlers and their upstream requests, and process exit terminates any remaining worker activity.

Seven subprocess cases were added, with four failing before implementation and all seven passing afterward. They cover EOF with one/four busy guests, destruction of the client pipe, stalled upstream requests with queued calls, idle EOF, SIGINT and SIGTERM. A local API request proves execution has started before disconnect; this avoids passing merely because stdin closed before the guest began running. Guests have a 30-second deadline, while clean exit must occur within 1.5 seconds. The stalled-request case also confirms upstream connections close and queued requests never start. Every child is reaped in cleanup, including during a failed regression run. The two POSIX-signal cases skip Windows; EOF cases remain enabled there.

All **219 tests across 14 files** pass on local macOS ARM64 Node **22.22.3, 24.16.0 and 26.8.2**. `npm run check` passes, including extracted-tarball execution. Host coverage percentages remain unchanged; this CLI fix is exercised by real subprocesses rather than the in-process coverage measurement. No new live API or container measurement is claimed for this shutdown patch. The SDK's handling of malformed JSON and requests before initialization was inspected but left unchanged.

## One-shot shell client review

A separate subprocess probe reproduced the finite-pipeline behavior: sending initialization, an initialized notification, tool discovery and `return 6*7` together, then closing stdin, returned initialization and discovery responses but no execution response. Closing server stdin initiates shutdown in the [MCP stdio lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#stdio). Immediate cancellation remains intentional; no grace period or server runtime change was added.

The new `examples/stdio-execute.mjs` accepts piped JavaScript instead. It reads the code before opening an official SDK client connection, performs initialization, awaits the tool response, then closes the connection. It preserves prompt server disconnect cancellation while supporting finite shell pipelines without an arbitrary completion window. Successful calls produce the structured result; tool errors preserve diagnostics and return a failing exit status. Input is bounded, startup failures omit private configuration, and large stdout responses are allowed to drain naturally.

Eight subprocess cases were written and observed failing before the helper existed, then passed after implementation. They cover synchronous and asynchronous results, guest diagnostics, a 1.9-million-character result, an unrelated working directory, empty input, oversized multibyte input and redacted startup failure. The packaging check also executes the helper from an extracted tarball outside the checkout.

All **227 tests across 15 files** pass on local macOS ARM64 Node **22.22.3, 24.16.0 and 26.8.2**. The Node 22 full check passes, including formatting, strict typing, coverage gates and extracted-package execution. Host coverage remains 96.97% statements, 91.92% branches, 96.00% functions and 97.70% lines; example subprocesses are outside that coverage measurement. Existing disconnect tests remain passing. No new container, live API or provider-account validation was performed for this example/documentation change.
