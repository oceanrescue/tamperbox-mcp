// Requires a deployed HTTPS MCP URL and an OpenAI model supporting remote MCP.
// Uses built-in fetch; no additional SDK dependency is required.
for (const name of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'TAMPERBOX_MCP_URL']) {
  if (!process.env[name]) throw new Error(`Set ${name}.`);
}
const response = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: process.env.OPENAI_MODEL,
    input:
      'Discover Tamperbox JSON operations, then format the synthetic JSON {"example":true}.',
    tools: [
      {
        type: 'mcp',
        server_label: 'tamperbox',
        server_url: process.env.TAMPERBOX_MCP_URL,
        require_approval: 'always',
        allowed_tools: ['search', 'execute'],
        ...(process.env.TAMPERBOX_MCP_TOKEN
          ? { authorization: process.env.TAMPERBOX_MCP_TOKEN }
          : {}),
      },
    ],
  }),
});
if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}.`);
// With approvals enabled, inspect mcp_approval_request items and submit approved
// mcp_approval_response items in a continuation using previous_response_id.
console.log(JSON.stringify(await response.json(), null, 2));
