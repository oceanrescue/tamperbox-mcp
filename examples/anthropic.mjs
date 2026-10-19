// Requires a deployed HTTPS MCP URL and an Anthropic model supporting MCP.
for (const name of [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'TAMPERBOX_MCP_URL',
]) {
  if (!process.env[name]) throw new Error(`Set ${name}.`);
}
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'mcp-client-2025-11-20',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: process.env.ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content:
          'Discover Tamperbox JSON operations, then format the synthetic JSON {"example":true}.',
      },
    ],
    mcp_servers: [
      {
        type: 'url',
        name: 'tamperbox',
        url: process.env.TAMPERBOX_MCP_URL,
        ...(process.env.TAMPERBOX_MCP_TOKEN
          ? { authorization_token: process.env.TAMPERBOX_MCP_TOKEN }
          : {}),
      },
    ],
    tools: [{ type: 'mcp_toolset', mcp_server_name: 'tamperbox' }],
  }),
});
if (!response.ok)
  throw new Error(`Anthropic returned HTTP ${response.status}.`);
console.log(JSON.stringify(await response.json(), null, 2));
