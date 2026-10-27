import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';
import { CodeRunner } from '../dist/runner.js';
import { ApiClient } from '../dist/client.js';
async function connect(
  runner = new CodeRunner({ call: async () => ({ ok: true }) }),
) {
  const server = createServer(runner);
  const client = new Client({ name: 'independent-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
describe('MCP with official SDK client', () => {
  it('discovers website-only categories without API calls', async () => {
    const { client, close } = await connect(
      new CodeRunner({
        call: async () => {
          throw new Error('Unexpected API call');
        },
      }),
    );
    try {
      const response = await client.callTool({
        name: 'search',
        arguments: {
          code: "const d=spec['x-tamperbox-directory']; return {total:d.tools.length,categories:d.categories.length,tools:d.tools.filter(t=>t.category==='localization')};",
        },
      });
      expect(response.isError).toBeUndefined();
      const payload = JSON.parse((response.content as any)[0].text);
      expect(payload.result).toMatchObject({ total: 67, categories: 11 });
      expect(payload.result.tools.map((t: any) => t.id)).toEqual([
        'locale-file-checker',
        'pseudo-localizer',
      ]);
      for (const tool of payload.result.tools) {
        expect(tool.operationIds).toEqual([]);
        expect(tool.execution).toBe('browser-only');
        expect(tool.related).toHaveLength(1);
      }
    } finally {
      await close();
    }
  });

  it('returns an actual API failure’s operation without its response body', async () => {
    const api = new ApiClient({
      fetch: async (url) =>
        String(url).includes('/v1/find')
          ? Response.json({
              tools: [],
              provenance: {
                provider: 'tamperbox.dev',
                engineVersion: '1.0.0',
                tool: 'find',
                attribution: 'Powered by tamperbox.dev',
                editorUrl: 'https://tamperbox.dev/',
              },
            })
          : Response.json({ error: 'PRIVATE_UPSTREAM_BODY' }, { status: 503 }),
    });
    const { client, close } = await connect(new CodeRunner(api));
    try {
      const result = await client.callTool({
        name: 'execute',
        arguments: {
          code: 'await tamperbox.request({method:"GET",path:"/v1/find",query:{}});\nreturn await tamperbox.request({method:"GET",path:"/v1/recipes/jwt-to-yaml"});',
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.parse((result.content as any)[0].text)).toMatchObject({
        code: 'execution_error',
        details: {
          operation: 'get_recipe',
          message: 'Tamperbox API returned HTTP 503.',
        },
      });
      expect(JSON.stringify(result)).not.toContain('PRIVATE_UPSTREAM_BODY');
    } finally {
      await close();
    }
  });

  it('returns argument serialization errors with their guest source line', async () => {
    const { client, close } = await connect();
    try {
      const result = await client.callTool({
        name: 'execute',
        arguments: {
          code: 'const invalid=()=>1;\nreturn await tamperbox.request(invalid);',
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.parse((result.content as any)[0].text)).toMatchObject({
        code: 'execution_error',
        details: { name: 'TypeError', line: 2 },
      });
    } finally {
      await close();
    }
  });

  it('negotiates, lists two tools with annotations and executes code', async () => {
    const { client, close } = await connect();
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((x) => x.name)).toEqual(['search', 'execute']);
      expect(tools.tools[0]?.outputSchema).toHaveProperty('properties.result');
      expect(client.getServerCapabilities()).toMatchObject({
        tools: { listChanged: false },
        resources: { listChanged: false },
      });
      expect(tools.tools[1]?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
      const result = await client.callTool({
        name: 'execute',
        arguments: {
          code: 'return await tamperbox.request({method:"GET",path:"/v1/find",query:{}});',
        },
      });
      expect(result.structuredContent).toEqual({
        result: { ok: true },
        apiCalls: 1,
      });
      expect(JSON.parse((result.content as any)[0].text)).toEqual(
        result.structuredContent,
      );
    } finally {
      await close();
    }
  });
  it('discovers schemas, lists and reads the catalog resource', async () => {
    const { client, close } = await connect();
    try {
      const result = await client.callTool({
        name: 'search',
        arguments: {
          code: 'return operations.filter(o => o.operationId === "json_format");',
        },
      });
      expect((result.structuredContent as any).result).toHaveLength(1);
      expect((await client.listResources()).resources[0]?.uri).toBe(
        'tamperbox://catalog',
      );
      expect(
        JSON.parse(
          (await client.readResource({ uri: 'tamperbox://catalog' }))
            .contents[0]?.text as string,
        ).operations,
      ).toHaveLength(120);
    } finally {
      await close();
    }
  });
  it('distinguishes invalid tools and tool execution errors', async () => {
    const { client, close } = await connect();
    try {
      expect(
        (await client.callTool({ name: 'missing', arguments: {} })).isError,
      ).toBe(true);
      expect(
        (
          await client.callTool({
            name: 'execute',
            arguments: { code: 42 },
          })
        ).isError,
      ).toBe(true);
      const result = await client.callTool({
        name: 'execute',
        arguments: { code: 'throw Error("do not leak me")' },
      });
      expect(result.isError).toBe(true);
      expect(JSON.parse((result.content as any)[0].text)).toMatchObject({
        details: { name: 'Error', message: 'do not leak me' },
      });
      expect(
        (
          await client.callTool({
            name: 'search',
            arguments: { query: 'x', extra: 1 },
          })
        ).isError,
      ).toBe(true);
    } finally {
      await close();
    }
  });
});
