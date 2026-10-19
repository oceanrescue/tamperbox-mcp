# Hosted Code Mode preview acceptance

Verified on 2026-10-18. Connect a Streamable HTTP client to:

```text
https://tamperbox-code-mode-preview.i5634446.workers.dev/mcp
```

Authentication: **none**. This is a bounded public preview, separate from the legacy `mcp.tamperbox.dev` service. Inputs pass through the MCP hosting service to the API; use synthetic examples for acceptance. The preview allows four concurrent requests and approximately 60 requests/minute per client/location. It exposes exactly `search` and `execute`.

## Deployed artifact

- Source: [`9da3e6a`](https://github.com/oceanrescue/tamperbox-mcp/commit/9da3e6acec4f7345485396d1eb02b5fe13dda29e).
- Worker version: `707b3e43-051f-4866-b5cf-246602bde8e2`.
- Registry image digest: `sha256:b23070b9ddf820aa480184ba750b532235c5f2019cd8abe66c14edebaaafc753`.
- Server version: `0.2.0`, with the published npm release's runtime source. Later documentation changes do not replace the immutable npm tarball or release tag.
- [CI passed](https://github.com/oceanrescue/tamperbox-mcp/actions/runs/39119461450), including the Node/OS matrix, container build, 28 adapter tests, real Node cancellation integration and credential-free deployment dry run.

## Actual checks

| Check                | Observed result                                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted suite         | All 15 checks passed at 10:32 UTC: health, initialization, schemas, 58 operations/53 website entries, `return 42`, live JSON formatting, JWT-to-YAML, Google DNS evidence, HTTP rejection boundaries and client close. |
| Composition          | JWT-to-YAML made two bridge calls and preserved `signatureVerified: false` and an explicit trust limitation. The API supplied no warning strings for this sample; no upstream warning was invented.                    |
| Large result         | One million quotation marks returned intact, exercising the expanded response-frame allowance.                                                                                                                         |
| Concurrent execution | Four 30-second busy executions occupied capacity; a fifth request returned HTTP 503.                                                                                                                                   |
| Disconnect           | All four requests were aborted after three seconds. A subsequent `return 42` succeeded 1,509 ms after cancellation, including a deliberate one-second propagation wait.                                                |
| Idle lifecycle       | Cloudflare reported the named preview instance inactive after idle shutdown.                                                                                                                                           |
| Codex CLI 0.163.0    | One model-driven `search` followed by one `execute` returned the actual formatted synthetic JSON and `apiCalls: 1`. The CLI's default model was used; its exact model identifier was not captured.                     |
| Claude Code 2.1.284  | `claude-opus-5-5` performed one `search` and one `execute`, then returned the actual formatted JSON and `apiCalls: 1`.                                                                                                 |

The first hosted run failed health and initialization because first-time provisioning exceeded the 15-second startup deadline. A later request reached the Node server, and the full repeat run passed in 9.5 seconds. Initial Codex acceptance also had no usable tools; a separate run using the explicitly enabled/required configuration in [integrations.md](integrations.md) passed. These observations do not establish the exact cause of that first client failure. A cold-start 503 remains possible; reconnect after a startup failure. Submitted API calls are never automatically retried.

Run the reproducible hosted suite from a checkout:

```sh
TAMPERBOX_MCP_URL=https://tamperbox-code-mode-preview.i5634446.workers.dev/mcp npm run test:hosted
```

A Claude Code connection can be configured with:

```sh
claude mcp add --transport http tamperbox https://tamperbox-code-mode-preview.i5634446.workers.dev/mcp
```

See [Codex configuration and other integrations](integrations.md). The acceptance runs used temporary client configuration and did not change the owner's saved client setup.

## Remaining acceptance

These are bounded client and transport checks. They do not establish every diagnostic's availability, sustained-load performance, an uptime commitment, OpenAI Responses API or Anthropic API connector acceptance, or acceptance in ChatGPT, Claude Desktop, Cursor and VS Code UIs. The eight marketplace review cases and demo recording remain pending. Namespace proof, verified publisher details, countries, commerce and applicable policy/terms confirmation are still required for registry/marketplace submission.
