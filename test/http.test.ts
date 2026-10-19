import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer } from '../dist/http.js';
import { CodeRunner } from '../dist/runner.js';
import { request, type Server } from 'node:http';
async function raw(
  base: string,
  headers: Record<string, string>,
  body = JSON.stringify(rpc),
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      base + '/mcp',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode!, body: text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});
async function start(options = {}) {
  const server = createHttpServer(
    new CodeRunner({ call: async () => ({ ok: true }) }),
    options,
  );
  servers.push(server);
  await new Promise<void>((r, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', r);
  });
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
const rpc = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
};
const post = (body: unknown = rpc, headers = {}) => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...headers,
  },
  body: JSON.stringify(body),
});
describe('Streamable HTTP transport', () => {
  it('works with a real remote MCP client across stateless requests', async () => {
    const base = await start();
    const client = new Client({ name: 'test-http', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + '/mcp')),
    );
    try {
      expect((await client.listTools()).tools).toHaveLength(2);
      expect(
        (
          await client.callTool({
            name: 'execute',
            arguments: { code: 'return 7;' },
          })
        ).structuredContent,
      ).toEqual({ result: 7, apiCalls: 0 });
    } finally {
      await client.close();
    }
  });
  it.each(['null', 'https://evil.example', '', 'not-a-url'])(
    'denies untrusted Origin %s',
    async (origin) => {
      const base = await start();
      expect((await fetch(base + '/mcp', post(rpc, { origin }))).status).toBe(
        403,
      );
    },
  );
  it('checks hosts and ignores spoofed proxy forwarding headers', async () => {
    const base = await start();
    expect(
      (
        await raw(base, {
          host: 'evil.example',
          'x-forwarded-host': 'localhost',
        })
      ).status,
    ).toBe(403);
  });
  it('allows configured origins and preflights without reflecting strangers', async () => {
    const base = await start({ allowedOrigins: ['https://client.example'] });
    const r = await fetch(base + '/mcp', {
      method: 'OPTIONS',
      headers: { origin: 'https://client.example' },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe(
      'https://client.example',
    );
    expect(
      (
        await fetch(
          base + '/mcp',
          post(rpc, { origin: 'https://client.example' }),
        )
      ).status,
    ).toBe(200);
  });
  it('optionally requires a bearer token', async () => {
    const base = await start({ bearerToken: 'test-token-for-fixtures-only' });
    expect((await fetch(base + '/mcp', post())).status).toBe(401);
    expect(
      (await fetch(base + '/mcp', post(rpc, { authorization: 'Bearer wrong' })))
        .status,
    ).toBe(401);
    expect(
      (
        await fetch(
          base + '/mcp',
          post(rpc, { authorization: 'Bearer test-token-for-fixtures-only' }),
        )
      ).status,
    ).toBe(200);
  });
  it.each([[], [rpc], null, 42, 'text'])(
    'rejects nonobject/batched JSON RPC',
    async (body) => {
      const base = await start();
      expect((await fetch(base + '/mcp', post(body))).status).toBe(400);
    },
  );
  it('rejects malformed JSON, encodings, wrong media types and large bodies', async () => {
    const base = await start({ maxBodyBytes: 300 });
    expect(
      (await fetch(base + '/mcp', { ...post(), body: '{bad' })).status,
    ).toBe(400);
    expect(
      (await fetch(base + '/mcp', post(rpc, { 'content-encoding': 'gzip' })))
        .status,
    ).toBe(415);
    expect(
      (await fetch(base + '/mcp', post(rpc, { 'content-type': 'text/plain' })))
        .status,
    ).toBe(415);
    expect(
      (await fetch(base + '/mcp', post({ data: 'x'.repeat(400) }))).status,
    ).toBe(413);
  });
  it('bounds requests globally without trusting client IP headers', async () => {
    const base = await start({ requestsPerMinute: 1 });
    expect((await fetch(base + '/mcp', post())).status).toBe(200);
    const r = await fetch(
      base + '/mcp',
      post(rpc, { 'x-forwarded-for': '1.2.3.4' }),
    );
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
  });
  it('serves a minimal health response, 404 and 405 without input echo', async () => {
    const base = await start();
    expect((await fetch(base + '/health')).status).toBe(200);
    expect((await fetch(base + '/missing?secret=1')).status).toBe(404);
    for (const method of ['GET', 'DELETE', 'PUT'])
      expect((await fetch(base + '/mcp', { method })).status).toBe(405);
    const r = await fetch(base + '/mcp', post());
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('HTTP abuse and lifecycle boundaries', () => {
  it.each([
    'user:pass@localhost',
    'localhost/path',
    'localhost?x=1',
    'localhost#x',
    'bad host',
  ])('denies malformed Host %s', async (host) => {
    const base = await start();
    expect((await raw(base, { host })).status).toBe(403);
  });
  it('bounds chunked bodies even without a declared length', async () => {
    const base = await start({ maxBodyBytes: 100 });
    expect(
      (
        await raw(
          base,
          { 'transfer-encoding': 'chunked' },
          JSON.stringify({ code: 'x'.repeat(101) }),
        )
      ).status,
    ).toBe(413);
  });
  it('returns a bounded error for deeply nested JSON', async () => {
    const base = await start();
    let value: unknown = {};
    for (let i = 0; i < 50; i++) value = { value };
    expect((await fetch(base + '/mcp', post(value))).status).toBe(400);
  });
  it('terminates slow request bodies and releases capacity', async () => {
    const base = await start({ bodyTimeoutMs: 30, maxActiveRequests: 1 });
    const slow = new Promise<number>((resolve, reject) => {
      const req = request(
        base + '/mcp',
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        (res) => {
          res.resume();
          res.on('end', () => {
            resolve(res.statusCode!);
            req.destroy();
          });
        },
      );
      req.on('error', reject);
      req.write('{');
    });
    expect(await slow).toBe(408);
    expect((await fetch(base + '/mcp', post())).status).toBe(200);
  });
  it('bounds concurrent incomplete requests', async () => {
    const base = await start({ bodyTimeoutMs: 500, maxActiveRequests: 1 });
    let started!: () => void;
    const ready = new Promise<void>((r) => (started = r));
    const slow = new Promise<number>((resolve, reject) => {
      const req = request(
        base + '/mcp',
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode!));
        },
      );
      req.on('error', reject);
      req.write('{', () => started());
      req.on('close', () => req.destroy());
    });
    await ready;
    await new Promise((r) => setTimeout(r, 20));
    expect((await fetch(base + '/mcp', post())).status).toBe(503);
    expect(await slow).toBe(408);
  });
  it.each(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'])(
    'negotiates protocol %s',
    async (protocolVersion) => {
      const base = await start();
      const r = await fetch(
        base + '/mcp',
        post({ ...rpc, params: { ...rpc.params, protocolVersion } }),
      );
      expect(r.status).toBe(200);
      expect((await r.json()).result.protocolVersion).toBe(protocolVersion);
    },
  );
  it('returns protocol errors for malformed envelopes and unsupported methods', async () => {
    const base = await start();
    expect((await fetch(base + '/mcp', post({ foo: 'bar' }))).status).toBe(400);
    const r = await fetch(
      base + '/mcp',
      post({ jsonrpc: '2.0', id: 2, method: 'unknown/method' }),
    );
    expect((await r.json()).error.code).toBe(-32601);
  });
});
