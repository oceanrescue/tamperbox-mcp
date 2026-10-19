import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeFetch, ContainerProxy, readBody } from '../adapter.js';
const host = 'preview.example.workers.dev';
const request = (path = '/mcp', options = {}) =>
  new Request(`https://${host}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '1.1.1.1',
    },
    body: '{}',
    ...options,
  });
const env = (overrides = {}) => ({
  PUBLIC_HOST: host,
  RATE_LIMITER: { limit: async () => ({ success: true }) },
  MCP_CONTAINER: {
    idFromName: (name) => name,
    get: (id) => ({
      fetch: async (req) =>
        Response.json({
          id,
          auth: req.headers.get('authorization'),
          origin: req.headers.get('origin'),
          forwarded: req.headers.get('x-forwarded-for'),
        }),
    }),
  },
  ...overrides,
});
const fixture = (
  fetcher = async (url) => Response.json({ ok: true }),
  options = {},
) => {
  const calls = [];
  let alarm;
  const container = {
    running: false,
    images: { mcp: 'registry/image@sha256:fixture' },
    start(config) {
      calls.push(['start', config]);
      this.running = true;
    },
    async setInactivityTimeout(ms) {
      calls.push(['timeout', ms]);
    },
    getTcpPort(port) {
      assert.equal(port, 3000);
      return {
        fetch: (...args) => {
          calls.push(['fetch', ...args]);
          return fetcher(...args);
        },
      };
    },
    async destroy() {
      calls.push(['destroy']);
      this.running = false;
    },
    monitor() {
      return new Promise(() => {});
    },
  };
  const ctx = {
    container,
    storage: {
      setAlarm: async (value) => {
        alarm = value;
      },
      deleteAlarm: async () => {
        alarm = undefined;
      },
    },
    waitUntil() {},
  };
  return {
    proxy: new ContainerProxy(ctx, env(), options),
    container,
    calls,
    get alarm() {
      return alarm;
    },
  };
};
test('edge fails closed until exact public host and limiter are configured', async () => {
  assert.equal(
    (await edgeFetch(request(), env({ PUBLIC_HOST: '' }))).status,
    503,
  );
  assert.equal(
    (await edgeFetch(new Request('https://evil.example/mcp'), env())).status,
    403,
  );
  assert.equal(
    (await edgeFetch(request(), env({ RATE_LIMITER: undefined }))).status,
    503,
  );
  assert.equal(
    (
      await edgeFetch(
        request('/mcp', { headers: { 'content-type': 'application/json' } }),
        env(),
      )
    ).status,
    403,
  );
});
test('fixed object ID, real platform IP limiting and no forwarded identity headers', async () => {
  const keys = [];
  const e = env({
    RATE_LIMITER: {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: true };
      },
    },
  });
  const r = await edgeFetch(
    request('/mcp', {
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '1.1.1.1',
        'x-forwarded-for': '8.8.8.8',
        authorization: 'Bearer abc',
      },
    }),
    e,
  );
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.id, 'tamperbox-code-mode-v1');
  assert.equal(data.auth, 'Bearer abc');
  assert.equal(data.forwarded, null);
  assert.deepEqual(keys, ['mcp:1.1.1.1']);
});
test('rejects routes, methods, origins, encodings and declared oversize before object access', async () => {
  for (const [req, status] of [
    [request('/other'), 404],
    [request('/mcp?x=1'), 404],
    [request('/mcp', { method: 'GET', body: undefined }), 405],
    [request('/mcp', { headers: { origin: 'https://evil.example' } }), 403],
    [
      request('/mcp', {
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
        },
      }),
      415,
    ],
    [
      request('/mcp', {
        headers: {
          'content-type': 'application/json',
          'content-length': '1048577',
        },
      }),
      413,
    ],
  ])
    assert.equal((await edgeFetch(req, env())).status, status);
});
test('auth fails at edge and optional preflight does not boot container', async () => {
  const e = env({ MCP_TOKEN: 'abc' });
  assert.equal((await edgeFetch(request(), e)).status, 401);
  const allowed = await edgeFetch(
    request('/mcp', {
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '1.1.1.1',
        authorization: 'Bearer abc',
        origin: `https://${host}`,
      },
    }),
    e,
  );
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).origin, `https://${host}`);
  const preflight = await edgeFetch(
    request('/mcp', {
      method: 'OPTIONS',
      body: undefined,
      headers: { origin: `https://${host}` },
    }),
    e,
  );
  assert.equal(preflight.status, 204);
});
test('rate limit and unexpected binding errors return safe responses', async () => {
  assert.equal(
    (
      await edgeFetch(
        request(),
        env({ RATE_LIMITER: { limit: async () => ({ success: false }) } }),
      )
    ).status,
    429,
  );
  const r = await edgeFetch(
    request(),
    env({
      RATE_LIMITER: {
        limit: async () => {
          throw Error('PRIVATE');
        },
      },
    }),
  );
  assert.equal(r.status, 503);
  assert.ok(!(await r.text()).includes('PRIVATE'));
});
test('streaming ingress enforces size, deadline and cancellation', async () => {
  await assert.rejects(
    readBody(
      new Request('https://x', { method: 'POST', body: 'x'.repeat(1048577) }),
    ),
    (e) => e.status === 413,
  );
  let cancelled = false;
  const slow = new Request('https://x', {
    method: 'POST',
    body: new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    duplex: 'half',
  });
  await assert.rejects(
    readBody(slow, { timeoutMs: 10 }),
    (e) => e.status === 408,
  );
  assert.equal(cancelled, true);
  const abort = new AbortController();
  const pending = readBody(
    new Request('https://x', {
      method: 'POST',
      signal: abort.signal,
      body: new ReadableStream(),
      duplex: 'half',
    }),
  );
  abort.abort();
  await assert.rejects(pending, (e) => e.status === 499);
});
test('container starts immutable image and fixed file entrypoint; active proxy only forwards once', async () => {
  const f = fixture();
  const response = await f.proxy.fetch(request());
  assert.equal(response.status, 200);
  await response.text();
  const config = f.calls.find((c) => c[0] === 'start')[1];
  assert.equal(config.instance, 'standard-1');
  assert.equal(config.image, f.container.images.mcp);
  assert.ok(config.entrypoint.includes('/app/dist/cli.js'));
  assert.equal(config.env.TAMPERBOX_ALLOWED_HOSTS, 'container');
  assert.equal(
    f.calls.filter((c) => c[0] === 'fetch' && String(c[1]).endsWith('/mcp'))
      .length,
    1,
  );
  assert.ok(f.alarm);
});
test('only one request active until its response body is consumed', async () => {
  let stream;
  const f = fixture(
    async (url) =>
      String(url).endsWith('/health')
        ? Response.json({ status: 'ok' })
        : new Response(
            new ReadableStream({
              start(c) {
                stream = c;
              },
            }),
          ),
    { maxActive: 1 },
  );
  const first = await f.proxy.fetch(request());
  assert.equal((await f.proxy.fetch(request())).status, 503);
  stream.close();
  await first.text();
  assert.equal(f.proxy.active, 0);
});
test('cancelled response aborts upstream and releases capacity', async () => {
  let signal;
  const f = fixture(async (url, init) => {
    if (String(url).endsWith('/health')) return Response.json({ status: 'ok' });
    signal = init.signal;
    return new Response(new ReadableStream());
  });
  const response = await f.proxy.fetch(request());
  await response.body.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(f.proxy.active, 0);
});
test('request cancellation during readiness never submits work', async () => {
  const f = fixture(
    async () => {
      throw Error('not ready');
    },
    { coldStartMs: 100, pollMs: 5 },
  );
  const abort = new AbortController();
  const pending = f.proxy.fetch(request('/mcp', { signal: abort.signal }));
  setTimeout(() => abort.abort(), 10);
  assert.equal((await pending).status, 499);
  assert.equal(
    f.calls.filter((c) => c[0] === 'fetch' && String(c[1]).endsWith('/mcp'))
      .length,
    0,
  );
});
test('cold start deadline and submitted failures do not retry request bodies', async () => {
  const cold = fixture(async () => new Promise(() => {}), { coldStartMs: 15 });
  assert.equal((await cold.proxy.fetch(request())).status, 503);
  const f = fixture(async (url) => {
    if (String(url).endsWith('/health')) return Response.json({ status: 'ok' });
    throw Error('PRIVATE_BODY');
  });
  const response = await f.proxy.fetch(request());
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('PRIVATE_BODY'));
  assert.equal(
    f.calls.filter((c) => c[0] === 'fetch' && String(c[1]).endsWith('/mcp'))
      .length,
    1,
  );
});
test('idle alarm stops container but never interrupts active response', async () => {
  const f = fixture();
  const r = await f.proxy.fetch(request());
  await f.proxy.alarm();
  assert.equal(f.container.running, true);
  await r.text();
  await f.proxy.alarm();
  assert.equal(f.container.running, false);
});
test('default capacity admits four requests and rejects fifth before submission', async () => {
  const streams = [];
  const f = fixture(async (url) =>
    String(url).endsWith('/health')
      ? Response.json({ status: 'ok' })
      : new Response(
          new ReadableStream({
            start(c) {
              streams.push(c);
            },
          }),
        ),
  );
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => f.proxy.fetch(request())),
  );
  assert.equal(f.proxy.active, 4);
  assert.equal((await f.proxy.fetch(request())).status, 503);
  for (let i = 0; i < 4; i++) {
    streams[i].close();
    await responses[i].text();
  }
  assert.equal(f.proxy.active, 0);
});
test('request timeout after response headers aborts stalled response and frees capacity', async () => {
  let signal;
  const f = fixture(
    async (url, init) =>
      String(url).endsWith('/health')
        ? Response.json({ status: 'ok' })
        : ((signal = init.signal), new Response(new ReadableStream())),
    { requestMs: 10 },
  );
  const response = await f.proxy.fetch(request());
  await assert.rejects(response.text(), /interrupted/);
  assert.equal(signal.aborted, true);
  assert.equal(f.proxy.active, 0);
});
test('cancel before execution does not start or submit container work', async () => {
  const abort = new AbortController();
  abort.abort();
  const f = fixture();
  const response = await f.proxy.fetch(
    request('/mcp', { signal: abort.signal }),
  );
  assert.equal(response.status, 499);
  assert.equal(f.calls.length, 0);
});
test('container response overflow cancels response without exposing data', async () => {
  const f = fixture(async (url) =>
    String(url).endsWith('/health')
      ? Response.json({ status: 'ok' })
      : new Response('x'.repeat(7 * 1024 * 1024 + 1)),
  );
  const response = await f.proxy.fetch(request());
  await assert.rejects(response.text(), /interrupted/);
  assert.equal(f.proxy.active, 0);
});
test('container shutdown finishes before the next start and request', async () => {
  const f = fixture();
  const first = await f.proxy.fetch(request());
  await first.text();
  let stop;
  f.container.destroy = () =>
    new Promise((resolve) => {
      stop = () => {
        f.container.running = false;
        resolve();
      };
    });
  const shutdown = f.proxy.alarm();
  const second = f.proxy.fetch(request());
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(f.calls.filter((c) => c[0] === 'start').length, 1);
  stop();
  await shutdown;
  await (await second).text();
  assert.equal(f.calls.filter((c) => c[0] === 'start').length, 2);
});
test('a mismatched image on resumed DO is retired before requests use it', async () => {
  const f = fixture();
  f.container.running = true;
  f.container.inspect = async () => ({ image: 'old' });
  await f.proxy.restore();
  assert.equal(f.container.running, false);
});
test('concurrent cold starts share one boot even before running becomes true', async () => {
  const f = fixture();
  f.container.start = function (config) {
    f.calls.push(['start', config]);
    setTimeout(() => {
      this.running = true;
    }, 5);
  };
  const replies = await Promise.all(
    Array.from({ length: 4 }, () => f.proxy.fetch(request())),
  );
  for (const reply of replies) await reply.text();
  assert.equal(f.calls.filter((c) => c[0] === 'start').length, 1);
});
test('resumed DO also retires same-image container to apply current secret/config', async () => {
  const f = fixture();
  f.container.running = true;
  f.container.inspect = async () => ({ image: f.container.images.mcp });
  await f.proxy.restore();
  assert.equal(f.container.running, false);
});
test('platform inactivity safety timeout exceeds the maximum active request lifetime', async () => {
  const f = fixture();
  await (await f.proxy.fetch(request())).text();
  const timeout = f.calls.find((c) => c[0] === 'timeout')[1];
  assert.ok(
    timeout > f.proxy.options.coldStartMs + f.proxy.options.requestMs + 5000,
  );
});
test('submitted deadline releases capacity even if consumer never reads buffered response', async () => {
  const f = fixture(
    async (url) =>
      String(url).endsWith('/health')
        ? Response.json({ status: 'ok' })
        : new Response('small result'),
    { requestMs: 10, coldStartMs: 1000 },
  );
  const response = await f.proxy.fetch(request());
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.proxy.active, 0);
  await assert.rejects(response.text(), /interrupted/);
});
test('failed idle alarm scheduling stops an idle container without killing active requests', async () => {
  const streams = [];
  const f = fixture(async (url) =>
    String(url).endsWith('/health')
      ? Response.json({ status: 'ok' })
      : new Response(
          new ReadableStream({
            start(c) {
              streams.push(c);
            },
          }),
        ),
  );
  f.proxy.ctx.storage.setAlarm = async () => {
    throw Error('storage unavailable');
  };
  const first = await f.proxy.fetch(request()),
    second = await f.proxy.fetch(request());
  streams[0].close();
  await first.text();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.container.running, true);
  streams[1].close();
  await second.text();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.container.running, false);
});
test('authorized browser origins receive CORS headers on edge auth/rate failures', async () => {
  const req = request('/mcp', {
    headers: {
      'cf-connecting-ip': '1.1.1.1',
      'content-type': 'application/json',
      origin: `https://${host}`,
    },
  });
  for (const overrides of [
    { MCP_TOKEN: 'abc' },
    { RATE_LIMITER: { limit: async () => ({ success: false }) } },
  ]) {
    const response = await edgeFetch(req.clone(), env(overrides));
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      `https://${host}`,
    );
    assert.equal(response.headers.get('vary'), 'Origin');
  }
});
test('escape-heavy valid MCP result frame larger than 5 MiB is forwarded intact', async () => {
  const result = '"'.repeat(1000000);
  const json = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: {
      structuredContent: { result, apiCalls: 0 },
      content: [
        { type: 'text', text: JSON.stringify({ result, apiCalls: 0 }) },
      ],
    },
  });
  assert.ok(json.length > 5 * 1024 * 1024);
  const f = fixture(async (url) =>
    String(url).endsWith('/health')
      ? Response.json({ status: 'ok' })
      : new Response(json),
  );
  const response = await f.proxy.fetch(request());
  assert.deepEqual(
    JSON.parse(await response.text()).result.structuredContent.result,
    result,
  );
});
