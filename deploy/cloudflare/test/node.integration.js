import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { CodeRunner, createHttpServer } from '../../../dist/index.js';
import { ContainerProxy } from '../adapter.js';

test('client abort crosses adapter HTTP proxy and terminates four real QuickJS guests', async () => {
  let startedCount = 0,
    started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const runner = new CodeRunner({
    call: async () => {
      if (++startedCount === 4) started();
      return new Promise(() => {});
    },
  });
  const server = createHttpServer(runner, { allowedHosts: ['container'] });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const portFetch = (url, options = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        origin + new URL(url).pathname,
        {
          method: options.method ?? 'GET',
          signal: options.signal,
          headers: {
            ...Object.fromEntries(new Headers(options.headers)),
            host: 'container',
          },
        },
        (res) =>
          resolve(
            new Response(Readable.toWeb(res), {
              status: res.statusCode,
              headers: res.headers,
            }),
          ),
      );
      req.once('error', reject);
      req.end(options.body);
    });
  const ctx = {
    storage: { deleteAlarm: async () => {}, setAlarm: async () => {} },
    waitUntil() {},
    container: {
      running: true,
      images: { mcp: 'fixture' },
      setInactivityTimeout: async () => {},
      getTcpPort() {
        return { fetch: portFetch };
      },
    },
  };
  const proxy = new ContainerProxy(ctx, {
    PUBLIC_ORIGIN: 'https://preview.example.workers.dev',
  });
  const aborts = Array.from({ length: 4 }, () => new AbortController());
  const code =
    'void tamperbox.request({method:"GET",path:"/v1/find"});while(true){}';
  const pending = aborts.map((abort, i) =>
    proxy.fetch(
      new Request('https://preview.example.workers.dev/mcp', {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: i + 1,
          method: 'tools/call',
          params: { name: 'execute', arguments: { code, timeoutMs: 30000 } },
        }),
      }),
    ),
  );
  try {
    await Promise.race([
      ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error('Guests did not start.')), 5000).unref(),
      ),
    ]);
    const at = Date.now();
    for (const abort of aborts) abort.abort();
    for (const response of await Promise.all(pending))
      assert.equal(response.status, 499);
    let recovered = false;
    for (let i = 0; i < 100; i++) {
      try {
        assert.equal((await runner.execute('return 42;')).result, 42);
        recovered = true;
        break;
      } catch (error) {
        if (error.code !== 'busy') throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.equal(recovered, true);
    assert.ok(
      Date.now() - at < 2000,
      'Orphaned guests must end promptly, not at their 30 s deadline.',
    );
    assert.equal(proxy.active, 0);
    const large = await proxy.fetch(
      new Request('https://preview.example.workers.dev/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 100,
          method: 'tools/call',
          params: {
            name: 'execute',
            arguments: {
              code: 'return String.fromCharCode(34).repeat(1000000);',
            },
          },
        }),
      }),
    );
    assert.equal(large.status, 200);
    const frame = await large.text();
    assert.ok(frame.length > 5 * 1024 * 1024);
    assert.equal(
      JSON.parse(frame).result.structuredContent.result,
      '"'.repeat(1000000),
    );
  } finally {
    for (const abort of aborts) abort.abort();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
