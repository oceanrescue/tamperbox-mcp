import { describe, expect, it, vi } from 'vitest';
import { CodeRunner } from '../dist/runner.js';
const make = () =>
  new CodeRunner({ call: async (name, args) => ({ name, args }) });
describe('isolated code mode', () => {
  it('executes return values, loops, transforms and async API chains', async () => {
    const result = await make().execute(
      'const a=await tamperbox.request({method:"POST",path:"/v1/tools/json_format",body:{input:{mediaType:"application/json",value:"{}"}}}); return {name:a.name, values:[1,2,3].map(x=>x*2)};',
    );
    expect(result).toEqual({
      result: { name: 'json_format', values: [2, 4, 6] },
      apiCalls: 1,
    });
  });
  it('supports Promise.all and catches API errors', async () => {
    const runner = new CodeRunner({
      call: async () => {
        throw Error('private error');
      },
    });
    expect(
      (
        await runner.execute(
          'try { await tamperbox.request({method:"GET",path:"/v1/find",query:{}}); } catch(e) { return e.message; }',
        )
      ).result,
    ).not.toContain('private');
    expect(
      (
        await make().execute(
          'return await Promise.all([tamperbox.request({method:"GET",path:"/v1/find",query:{}}),tamperbox.request({method:"GET",path:"/v1/find",query:{}})]);',
        )
      ).apiCalls,
    ).toBe(2);
  });
  it.each([
    'process',
    'require',
    'fetch',
    'WebSocket',
    'XMLHttpRequest',
    'Buffer',
    'Deno',
    'Bun',
  ])('does not expose %s', async (name) =>
    expect((await make().execute(`return typeof ${name};`)).result).toBe(
      'undefined',
    ),
  );
  it('does not leak host globals via function constructors', async () => {
    expect(
      (
        await make().execute(
          'return tamperbox.request.constructor("return typeof process")();',
        )
      ).result,
    ).toBe('undefined');
  });
  it('isolates requests', async () => {
    await make().execute('globalThis.secret=42; return true;');
    expect((await make().execute('return typeof secret;')).result).toBe(
      'undefined',
    );
  });
  it.each([
    'while(true) {}',
    'await new Promise(()=>{});',
    'while(true) await Promise.resolve();',
  ])('terminates runaway code: %s', async (code) => {
    await expect(
      make().execute(code, { timeoutMs: 150 }),
    ).rejects.toMatchObject({ code: 'execution_timeout' });
  });
  it.each([
    'return (',
    'throw new Error("secret");',
    'return 1n;',
    'const x={};x.x=x;return x;',
    'return import("node:fs");',
  ])('contains bad code without leaking input: %s', async (code) => {
    await expect(make().execute(code)).rejects.toThrow();
  });
  it('rejects oversized code and results', async () => {
    await expect(make().execute(' '.repeat(65537))).rejects.toMatchObject({
      code: 'code_size',
    });
    await expect(
      make().execute('return "x".repeat(2100000);'),
    ).rejects.toMatchObject({ code: 'output_size' });
  });
  it('enforces the API call budget even when errors are caught', async () => {
    const call = vi.fn(async () => null);
    const runner = new CodeRunner({ call }, { maxCalls: 2 });
    await expect(
      runner.execute(
        'for(let i=0;i<5;i++) {try {await tamperbox.request({method:"GET",path:"/v1/find",query:{}});}catch{}} return true;',
      ),
    ).rejects.toMatchObject({ code: 'call_limit' });
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('cancels execution and aborts API requests', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      make().execute('return 1;', { signal: ac.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('recovers after failures', async () => {
    const runner = make();
    await expect(runner.execute('throw 1')).rejects.toThrow();
    expect((await runner.execute('return 42;')).result).toBe(42);
  });
});
