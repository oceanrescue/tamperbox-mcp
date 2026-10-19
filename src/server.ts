import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { spec, operations } from './spec.js';
import { CodeRunner } from './runner.js';
import { safeError } from './errors.js';
export const VERSION = '0.2.0';
const content = (value: Record<string, unknown>) => ({
  structuredContent: value,
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
});
const inputSchema = z
  .object({
    code: z.string().min(1).max(65536),
    timeoutMs: z.number().int().min(1).max(30000).optional(),
  })
  .strict();
const outputSchema = z.object({
  result: z.unknown(),
  apiCalls: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'Bridge calls attempted, including host-validation failures, counted against the execution call budget. Not upstream HTTP requests; excludes arguments rejected during guest serialization. Always zero for search.',
    ),
});
export function createServer(
  runner: CodeRunner,
  signal?: AbortSignal,
): McpServer {
  const server = new McpServer(
    { name: 'tamperbox-mcp', version: VERSION },
    {
      instructions:
        'Use search to inspect the full bundled Tamperbox OpenAPI specification, then execute JavaScript that calls await tamperbox.request({method,path,query?,body?}). Both tools accept an async function body; use return to select JSON output. Search exposes spec (OpenAPI) and operations (method, path, operationId, summary, description, tags, inputSchema, outputSchema, parameters, requestBody, responses) and makes no network calls. Execute sends request inputs to Tamperbox. Read operation descriptions and limitations first; JWT decoding does not verify trust.',
    },
  );
  for (const mode of ['search', 'execute'] as const) {
    server.registerTool(
      mode,
      {
        title:
          mode === 'search'
            ? 'Search the Tamperbox API specification'
            : 'Execute Tamperbox API code',
        description:
          mode === 'search'
            ? 'Run an async JavaScript function body over the complete local OpenAPI spec and derived operations array. Filter and return only relevant endpoints, input/output schemas, descriptions and examples. Example: return operations.filter(o => /json/i.test(o.summary + " " + o.description)); No API requests or private inputs are needed. Limits: 64 KiB code, 15 seconds by default, 2 MiB returned JSON.'
            : 'Run an async JavaScript function body in an isolated runtime. Search schemas first, then call await tamperbox.request({method:"POST",path:"/v1/tools/json_format",body:{input:{mediaType:"application/json",value:"{}"}}}), combine results and return JSON. method/path must be documented; query is a scalar-value object; body must match the schema. Returns the decoded JSON response body. Inputs go to Tamperbox; target-check tools can contact the requested public target. No arbitrary URLs, headers, files, imports, process or secrets. Limits: 64 KiB code, 20 bridge calls, 4 in flight, 15 seconds by default, 2 MiB output. JWT decoding does not verify trust.',
        inputSchema,
        outputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: mode === 'search',
          openWorldHint: mode === 'execute',
        },
      },
      async (args, extra) => {
        try {
          const combined = signal
            ? AbortSignal.any([signal, extra.signal])
            : extra.signal;
          const result = await runner[mode](args.code, {
            ...(args.timeoutMs === undefined
              ? {}
              : { timeoutMs: args.timeoutMs }),
            signal: combined,
          });
          return content({ ...result });
        } catch (error) {
          const safe = safeError(error);
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  code: safe.code,
                  message: safe.message,
                  ...(safe.details ? { details: safe.details } : {}),
                }),
              },
            ],
          };
        }
      },
    );
  }
  server.registerResource(
    'catalog',
    'tamperbox://catalog',
    {
      title: 'Complete Tamperbox API specification',
      mimeType: 'application/json',
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ spec, operations }),
        },
      ],
    }),
  );
  server.server.registerCapabilities({
    tools: { listChanged: false },
    resources: { listChanged: false },
  });
  return server;
}
