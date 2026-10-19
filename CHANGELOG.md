# Changelog

## 0.2.0 — 2026-10-18

- Replace `tamperbox_discover` and `tamperbox_execute` with `search` and `execute`. Both accept an async JavaScript function body; search inspects the bundled specification without network access.
- Replace named guest functions with `tamperbox.request({method,path,query?,body?})`, validating documented routes and request/response schemas before returning results.
- Bundle 58 operation contracts representing all 53 website tool entries. This is entry coverage, not every browser UI mode. The matching expanded REST API is deployed, and the MCP package is published on npm.
- Preserve sandbox limits, cancellation, bounded diagnostics and the `apiCalls` counting contract. Existing library exports remain available for compatibility.
- Add full-catalog contract tests and cross-repository API acceptance checks. Explain input/output shapes and live browser counterparts in the README.

## 0.1.0 — Unreleased

- Code-mode discovery and execution over eight Tamperbox API operations.
- Fresh QuickJS/WASM runtimes with bounded API access and cancellation.
- MCP stdio and stateless Streamable HTTP transports.
- Public API contract fixtures, adversarial tests, packaging checks and CI.
- OpenAI, Anthropic and other MCP client integration examples.
- Pipe-friendly one-shot stdio client example that waits for responses before disconnecting, with packaged-example acceptance checks.

### Review hardening

- Hard-cap WebAssembly memory so ArrayBuffer and typed-array storage cannot bypass the allocator budget.
- Return bounded guest diagnostics and schema-validation paths while preserving upstream error redaction.
- Queue API batches, wake workers on messages, and isolate worker launch flags.
- Declare discovery output schemas and static lists; clarify unavailable globals and transport-result overhead.
- Locate incomplete code on the last submitted line and map CR/Unicode line separators without changing string contents.
- Preserve safe bridge errors when guest code changes inherited getters or array iteration.
- Identify failed API operations in guest catches and uncaught diagnostics; reject arguments that serialize to undefined with a source-located TypeError before dispatch.
- Clarify that `apiCalls` counts attempted bridge calls, including host-validation failures, in documentation, exported types and the MCP output schema; retain the field name and counting behavior.
- Add repository and issue links from the configured GitHub origin for release packaging.
- Shut down stdio sessions on stdin EOF or closure, aborting active work instead of retaining guests until their deadlines; make shutdown idempotent across EOF and signals.
