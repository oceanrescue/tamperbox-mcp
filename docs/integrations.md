# Client integrations

All examples assume `npm ci && npm run build` has completed. Replace `/absolute/path/to/tamperbox-mcp` with your checkout location. Remote examples use your deployed **HTTPS** `/mcp` endpoint. These configurations are prepared from official documentation reviewed on 2026-10-17; a live JSON-formatting case now passes in Codex CLI and Claude Code. Other client UIs and provider API connectors remain separate checks.

Both tools accept an async function body in `code`, with optional `timeoutMs`. `search` exposes local `spec` and `operations`; `execute` exposes `tamperbox.request({method,path,query?,body?})`. Replace old tool-name allowlists with `search` and `execute`; operation-specific guest methods are no longer the interface.

For every client, `execute` returns `{ result, apiCalls }`. `apiCalls` counts bridge calls attempted, including host-validation failures, against the execution call budget; it is not a count of upstream HTTP requests. Arguments rejected during guest serialization are excluded. The field name is retained for compatibility. `search` returns the same outer shape with `apiCalls: 0`.

**Expansion status:** the matching 58-operation REST API is deployed at `api.tamperbox.dev`. Use `npx -y tamperbox-mcp@0.2.0` or build this checkout to run the new MCP interface. The anonymous production endpoint is `https://mcp.tamperbox.dev/mcp`; see [production acceptance](production-acceptance.md). The [preview acceptance record](hosted-acceptance.md) contains earlier client and lifecycle evidence. See the [README](../README.md#code-mode) for request and search examples and the [verification record](code-mode-expansion.md) for deployment evidence.

## Shell scripts and one-shot calls

[examples/stdio-execute.mjs](../examples/stdio-execute.mjs) reads a JavaScript async function body from stdin, initializes an MCP connection, waits for the execution response, then closes the connection:

```sh
printf 'return await Promise.resolve(42);\n' | node examples/stdio-execute.mjs
node examples/stdio-execute.mjs < task.js
```

Success writes one JSON line containing `{ result, apiCalls }` to stdout and exits with status 0. Tool errors write the MCP error result (including `isError` and diagnostic content) to stdout and exit with status 1. Input or connection failures write a short message to stderr and exit with status 1. Input is limited to 64 KiB of UTF-8; normal execution limits apply, including the default 15-second execution deadline. The helper passes through `TAMPERBOX_API_BASE_URL` and `TAMPERBOX_ALLOW_LOCAL_HTTP` when configured and locates the built server relative to itself, so it also works from another working directory.

EOF on the helper's stdin finishes reading code before the MCP connection opens. EOF on the **server's** stdin initiates shutdown and promptly cancels active work, following the [MCP stdio lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#stdio). A finite pipeline of raw JSON-RPC requests can therefore lose pending responses. Keep the connection open until those responses arrive, as this helper does. The server deliberately has no grace period that would keep disconnected executions running.

## Codex

Add the server to your MCP configuration using [examples/codex.toml](../examples/codex.toml), or run:

```sh
codex mcp add tamperbox -- node /absolute/path/to/tamperbox-mcp/dist/cli.js
```

For production, configure this entry in your Codex configuration:

```toml
[mcp_servers.tamperbox]
url = "https://mcp.tamperbox.dev/mcp"
enabled = true
required = true
startup_timeout_sec = 40
tool_timeout_sec = 45
```

`required = true` makes a failed connection visible instead of silently continuing without the server. For other HTTP deployments, configure `url` instead of `command`/`args`. Use a tool timeout above 30 seconds. See [official MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## ChatGPT custom integration

Deploy this server using [deployment.md](deployment.md). In ChatGPT's Plugins interface, choose **Add custom MCP server**, enter your HTTPS `/mcp` URL and select **No authentication** for an anonymous deployment. Create the personal plugin and test discovery plus the synthetic JSON formatting example. Available controls depend on account/workspace settings. See the [official custom MCP quickstart](https://developers.openai.com/plugins/quickstart).

The optional static bearer mode is intended for clients that can supply authorization headers. It does not implement OAuth discovery or user authorization. If your workspace requires OAuth, place a conforming MCP OAuth gateway in front of the server and validate it separately.

## OpenAI Responses API

[examples/openai.mjs](../examples/openai.mjs) uses the `mcp` tool, `server_url`, an explicit tool allowlist and approval requests. Set `OPENAI_API_KEY`, `OPENAI_MODEL` and `TAMPERBOX_MCP_URL` in your environment. The initial example may return an approval request; review it and continue with `mcp_approval_response` and `previous_response_id`. It does not silently auto-approve tool calls. See [remote MCP tools and approvals](https://developers.openai.com/api/docs/guides/tools-connectors-mcp).

## Claude Code

```sh
claude mcp add --transport stdio tamperbox -- node /absolute/path/to/tamperbox-mcp/dist/cli.js
```

Or copy [examples/claude-code.mcp.json](../examples/claude-code.mcp.json) to the consuming project's `.mcp.json`. For a hosted server:

```sh
claude mcp add --transport http tamperbox https://mcp.tamperbox.dev/mcp
```

Review the server and tool permissions in your client. See [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

## Claude Desktop

Merge [examples/claude-desktop.json](../examples/claude-desktop.json) into your desktop client's MCP server configuration. Use an absolute Node executable path if the application does not inherit your shell's PATH. Restart the client after editing. This is a local stdio setup; no public hosting is needed. See the [local MCP server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

## Anthropic Messages API

[examples/anthropic.mjs](../examples/anthropic.mjs) sets `mcp_servers`, an `mcp_toolset`, and the documented `mcp-client-2025-11-20` beta header. Configure `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` and `TAMPERBOX_MCP_URL`. Optional `TAMPERBOX_MCP_TOKEN` is sent as the inbound server token. Provider support and beta behavior can change; review [Anthropic's MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) before release.

## VS Code, Cursor and other clients

For VS Code, put [examples/vscode.mcp.json](../examples/vscode.mcp.json) in the consuming project's `.vscode/mcp.json`; see [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers). Clients using an `mcpServers` wrapper can adapt the Claude Desktop example. Any conforming client with stdio or Streamable HTTP and MCP tools can use this server without provider-specific server code. Actual client UI acceptance is not implied by protocol tests.

## Manual acceptance checklist

1. Connect and confirm exactly `search` and `execute` appear.
2. Call `search` with `return operations.filter(o => o.operationId === "json_format");`, then use its method/path/schema through `tamperbox.request` in `execute`.
3. Chain JWT decode → YAML; verify the trust warning remains visible.
4. Verify code errors are reported as tool errors, and a later call still succeeds.
5. Against the matching expanded API, discover and execute representative email, DNS, HTTP and network diagnostics; inspect partial/unavailable results and caller-context limitations.
6. Verify configured auth, prompts/permissions, timeout and disconnect handling in the target client.

Never point users at a placeholder or at the existing Tamperbox MCP service as if this code-mode server were already deployed there.
