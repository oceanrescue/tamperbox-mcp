import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';
import { CodeRunner } from '../dist/runner.js';
import { ApiClient } from '../dist/client.js';

describe('programmable code mode', () => {
  it('exposes exactly search and execute through the official SDK', async () => {
    const server = createServer(new CodeRunner({ call: async () => null }));
    const client = new Client({ name: 'code-mode-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const list = await client.listTools();
      expect(list.tools.map((t) => t.name)).toEqual(['search', 'execute']);
      const result = await client.callTool({
        name: 'search',
        arguments: {
          code: 'return operations.filter(o => o.operationId === "json_format").map(o => ({method:o.method,path:o.path,input:o.inputSchema}));',
        },
      });
      expect(result.structuredContent).toMatchObject({
        apiCalls: 0,
        result: [
          {
            method: 'POST',
            path: '/v1/tools/json_format',
            input: { type: 'object' },
          },
        ],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('searches the full spec locally, with no networking bridge or named tools', async () => {
    const call = vi.fn(async () => null);
    const runner = new CodeRunner({ call });
    const result = await runner.search(
      'return {version:spec.openapi,paths:Object.keys(spec.paths),bridge:typeof tamperbox,network:typeof fetch};',
    );
    expect(result.apiCalls).toBe(0);
    expect(result.result).toMatchObject({
      version: '3.1.1',
      bridge: 'undefined',
      network: 'undefined',
    });
    expect((result.result as any).paths).toContain('/v1/tools/json_format');
    expect(call).not.toHaveBeenCalled();
    expect(
      (await runner.execute('return Object.keys(tamperbox);')).result,
    ).toEqual(['request']);
  });
  it('validates and dispatches generic requests and returns JSON bodies', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        tools: [],
        provenance: {
          provider: 'tamperbox.dev',
          engineVersion: '1.0.0',
          tool: 'find',
          attribution: 'Powered by tamperbox.dev',
          editorUrl: 'https://tamperbox.dev/',
        },
      }),
    );
    const result = await new CodeRunner(
      new ApiClient({ fetch: fetcher }),
    ).execute(
      'return await tamperbox.request({method:"GET",path:"/v1/find",query:{query:"a&b=#c"}});',
    );
    expect(result).toEqual({
      result: {
        tools: [],
        provenance: {
          provider: 'tamperbox.dev',
          engineVersion: '1.0.0',
          tool: 'find',
          attribution: 'Powered by tamperbox.dev',
          editorUrl: 'https://tamperbox.dev/',
        },
      },
      apiCalls: 1,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.tamperbox.dev/v1/find?query=a%26b%3D%23c',
    );
  });
  it.each([
    { method: 'GET', path: 'https://evil.example/v1/find' },
    { method: 'GET', path: '//evil.example/v1/find' },
    { method: 'GET', path: '/v1/../find' },
    { method: 'GET', path: '/v1/%2e%2e/find' },
    { method: 'GET', path: '/v1/find?query=secret' },
    { method: 'GET', path: '/v1/find#fragment' },
    { method: 'GET', path: '/v1/find', headers: { authorization: 'secret' } },
    { method: 'DELETE', path: '/v1/find' },
    { method: 'GET', path: '/v1/find', query: { unknown: 'secret' } },
    { method: 'GET', path: '/v1/find', body: { secret: true } },
    { method: 'POST', path: '/v1/tools/json_format', body: {} },
  ])(
    'rejects invalid request before any network dispatch: %j',
    async (request) => {
      const fetcher = vi.fn(async () => Response.json({}));
      const result = await new CodeRunner(
        new ApiClient({ fetch: fetcher }),
      ).execute(
        `try {await tamperbox.request(${JSON.stringify(request)});}catch(e){return {code:e.code,message:e.message};}`,
      );
      expect((result.result as any).code).toMatch(
        /invalid_arguments|unknown_operation/,
      );
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(fetcher).not.toHaveBeenCalled();
      expect(result.apiCalls).toBe(1);
    },
  );
  it('isolates search mutations and applies execution time limits', async () => {
    const runner = new CodeRunner({ call: async () => null });
    expect(
      (
        await runner.search(
          'try {spec.info.title="evil";delete spec.paths["/v1/find"];}catch{} return spec.info.title;',
        )
      ).result,
    ).not.toBe('evil');
    expect(
      (await runner.search('return !!spec.paths["/v1/find"];')).result,
    ).toBe(true);
    await expect(
      runner.search('while(true){}', { timeoutMs: 200 }),
    ).rejects.toMatchObject({ code: 'execution_timeout' });
  });
  it('identifies a path-template operation when its parameter fails validation', async () => {
    const call = vi.fn(async () => null);
    const result = await new CodeRunner({ call }).execute(
      'try {await tamperbox.request({method:"GET",path:"/v1/recipes/unknown"});}catch(e){return {operation:e.operation,code:e.code};}',
    );
    expect(result.result).toEqual({
      operation: 'get_recipe',
      code: 'invalid_arguments',
    });
    expect(call).not.toHaveBeenCalled();
  });
});
