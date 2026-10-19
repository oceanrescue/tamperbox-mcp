import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../dist/client.js';
import { CodeRunner } from '../dist/runner.js';
import { parseConfig } from '../dist/config.js';
import { assertJsonDepth } from '../dist/json.js';
const input = { input: { mediaType: 'application/json', value: '{}' } };
const caller = { call: async () => ({ ok: true }) };
describe('JSON structural budget', () => {
  it('accepts primitives, arrays and normal nested values', () => {
    for (const x of [null, 1, 'x', [], { x: [{ a: true }] }])
      expect(() => assertJsonDepth(x)).not.toThrow();
  });
  it('rejects deeply nested objects and arrays', () => {
    for (const array of [true, false]) {
      let x: unknown = 0;
      for (let i = 0; i < 50; i++) x = array ? [x] : { x };
      expect(() => assertJsonDepth(x)).toThrow();
    }
  });
});
describe('REST adversarial responses', () => {
  it('limits UTF-8 input bytes rather than string length', async () => {
    const fetcher = vi.fn();
    await expect(
      new ApiClient({ fetch: fetcher }).call('json_format', {
        input: { mediaType: 'application/json', value: '💡'.repeat(300000) },
      }),
    ).rejects.toMatchObject({ code: 'input_size' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('encodes search parameters as data', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ tools: [], provenance: {} }),
    );
    await new ApiClient({ fetch: fetcher }).call('find', { query: 'a&b=#c' });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.tamperbox.dev/v1/find?query=a%26b%3D%23c',
    );
  });
  it('honors an already-cancelled request without fetching', async () => {
    const fetcher = vi.fn();
    const abort = new AbortController();
    abort.abort();
    await expect(
      new ApiClient({ fetch: fetcher }).call(
        'json_format',
        input,
        abort.signal,
      ),
    ).rejects.toMatchObject({ code: 'upstream_timeout' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancels a delayed fetch on deadline', async () => {
    const fetcher = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener(
            'abort',
            () => reject(Error('aborted')),
            { once: true },
          ),
        ),
    );
    await expect(
      new ApiClient({ fetch: fetcher, timeoutMs: 10 }).call(
        'json_format',
        input,
      ),
    ).rejects.toMatchObject({ code: 'upstream_timeout' });
  });
  it('rejects empty, broken, oversized declared and invalid UTF-8 bodies', async () => {
    for (const response of [
      new Response(null, { headers: { 'content-type': 'application/json' } }),
      new Response('{}', {
        headers: {
          'content-type': 'application/json',
          'content-length': '9999999',
        },
      }),
      new Response(new Uint8Array([0xff]), {
        headers: { 'content-type': 'application/json' },
      }),
      new Response(
        new ReadableStream({
          start(c) {
            c.error(Error('private'));
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ]) {
      await expect(
        new ApiClient({ fetch: async () => response }).call(
          'json_format',
          input,
        ),
      ).rejects.toThrow();
    }
  });
});
describe('sandbox budgets and cleanup', () => {
  it.each([0, -1, 30001, 1.2, NaN])(
    'rejects invalid timeout %s',
    async (timeoutMs) =>
      await expect(
        new CodeRunner(caller).execute('return 1;', { timeoutMs }),
      ).rejects.toMatchObject({ code: 'invalid_timeout' }),
  );
  it('enforces global execution capacity and releases it after cancellation', async () => {
    const runner = new CodeRunner(caller, { maxConcurrent: 1 });
    const abort = new AbortController();
    const first = runner.execute('await new Promise(()=>{});', {
      signal: abort.signal,
    });
    await expect(runner.execute('return 2;')).rejects.toMatchObject({
      code: 'busy',
    });
    abort.abort();
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    expect((await runner.execute('return 3;')).result).toBe(3);
  });
  it('aborts an actual pending upstream call on cancellation', async () => {
    const abort = new AbortController();
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const ready = new Promise<void>((r) => (started = r));
    const runner = new CodeRunner({
      call: async (_n, _a, s) => {
        signal = s;
        started();
        return new Promise(() => {});
      },
    });
    const execution = runner.execute(
      'return await tamperbox.request({method:"GET",path:"/v1/find",query:{}});',
      {
        signal: abort.signal,
      },
    );
    await ready;
    abort.abort();
    await expect(execution).rejects.toMatchObject({ code: 'cancelled' });
    expect(signal?.aborted).toBe(true);
  });
  it('counts queued calls toward the hard API call budget', async () => {
    const call = vi.fn(async () => new Promise(() => {}));
    const runner = new CodeRunner({ call });
    await expect(
      runner.execute(
        'return await Promise.all(Array.from({length:21},()=>tamperbox.request({method:"GET",path:"/v1/find",query:{}})));',
      ),
    ).rejects.toMatchObject({ code: 'call_limit' });
    expect(call).toHaveBeenCalledTimes(4);
  });
  it('validates input before passing it to any caller', async () => {
    const call = vi.fn();
    await expect(
      new CodeRunner({ call }).execute(
        'return await tamperbox.request({method:"POST",path:"/v1/tools/json_format",body:{}});',
      ),
    ).rejects.toMatchObject({ code: 'execution_error' });
    expect(call).not.toHaveBeenCalled();
  });
  it('bounds bridge inputs and outputs independently of the real API client', async () => {
    const runner = new CodeRunner({ call: async () => 'x'.repeat(2100000) });
    await expect(
      runner.execute(
        'return await tamperbox.request({method:"GET",path:"/v1/find",query:{}});',
      ),
    ).rejects.toThrow();
    await expect(
      new CodeRunner(caller).execute(
        'return await tamperbox.request({method:"POST",path:"/v1/tools/json_format",body:{input:{mediaType:"application/json",value:"💡".repeat(300000)}}});',
      ),
    ).rejects.toThrow();
  });
  it('normalizes absent returns and rejects non-JSON values', async () => {
    expect((await new CodeRunner(caller).execute('const x=1;')).result).toBe(
      null,
    );
    for (const code of [
      'return NaN;',
      'return ()=>1;',
      'return Symbol();',
      'return Infinity;',
    ])
      await expect(new CodeRunner(caller).execute(code)).rejects.toThrow();
  });
  it('contains memory exhaustion and stays usable', async () => {
    const runner = new CodeRunner(caller);
    await expect(
      runner.execute(
        'const a=[];while(true)a.push(new Array(100000).fill(123));',
      ),
    ).rejects.toThrow();
    expect((await runner.execute('return true;')).result).toBe(true);
  });
  it('rejects deeply nested code results before MCP serialization', async () => {
    await expect(
      new CodeRunner(caller).execute(
        'let x={};for(let i=0;i<100;i++)x={x};return x;',
      ),
    ).rejects.toMatchObject({ code: 'json_depth' });
  });
  it('retains no cross-request prototype mutations', async () => {
    const runner = new CodeRunner(caller);
    await runner.execute('Object.prototype.secret=1;return true;');
    expect((await runner.execute('return typeof ({}).secret;')).result).toBe(
      'undefined',
    );
  });
});
describe('configuration edge cases', () => {
  it.each([
    [['--port', '01'], {}],
    [['--host', 'bad/host'], {}],
    [['--port', '3', '--port', '4'], {}],
    [[], { TAMPERBOX_MCP_TOKEN: 'secret\nvalue' }],
    [[], { TAMPERBOX_ALLOWED_HOSTS: 'example.com:3000' }],
    [[], { TAMPERBOX_ALLOWED_HOSTS: ',' }],
    [[], { TAMPERBOX_API_BASE_URL: 'https://user:secret@example.com' }],
  ])('validates configuration %j', (argv, env) => {
    if (argv[1] === '01') expect(parseConfig(argv, env).port).toBe(1);
    else expect(() => parseConfig(argv, env)).toThrow();
  });
  it('accepts configured HTTPS origins and loopback API opt-in', () => {
    expect(
      parseConfig(['--transport', 'http'], {
        TAMPERBOX_ALLOWED_ORIGINS: 'https://client.example',
        TAMPERBOX_ALLOWED_HOSTS: 'mcp.example.com',
        TAMPERBOX_API_BASE_URL: 'http://localhost:8080',
        TAMPERBOX_ALLOW_LOCAL_HTTP: 'true',
      }),
    ).toMatchObject({
      allowedOrigins: ['https://client.example'],
      apiBaseUrl: 'http://localhost:8080',
    });
  });
});
