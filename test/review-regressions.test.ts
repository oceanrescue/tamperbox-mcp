import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { CodeRunner } from '../dist/runner.js';
import { SafeError } from '../dist/errors.js';
import { validateInput } from '../dist/catalog.js';
const runner = () => new CodeRunner({ call: async () => null });

describe('independently reproduced review regressions', () => {
  it.each(['ArrayBuffer', 'Uint8Array', 'Float64Array', 'DataView'])(
    'bounds retained %s backing stores',
    async (type) => {
      const allocation =
        type === 'ArrayBuffer'
          ? 'new ArrayBuffer(16*1024*1024)'
          : type === 'DataView'
            ? 'new DataView(new ArrayBuffer(16*1024*1024))'
            : `new ${type}(16*1024*1024/${type}.BYTES_PER_ELEMENT)`;
      await expect(
        runner().execute(
          `const retained=[];for(let i=0;i<6;i++){const item=${allocation};new Uint8Array(item.buffer??item).fill(1);retained.push(item);}return retained.length;`,
        ),
      ).rejects.toThrow();
    },
  );
  it('enforces memory ceilings for concurrent executions and recovers', async () => {
    const r = runner();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        r.execute(
          'const a=[];for(let i=0;i<6;i++)a.push(new Uint8Array(16*1024*1024).fill(1));return a.length;',
        ),
      ),
    );
    expect(results.every((x) => x.status === 'rejected')).toBe(true);
    expect((await r.execute('return 42;')).result).toBe(42);
  });
  it('keeps realistic JSON workloads usable under the hard cap', async () => {
    expect(
      (
        await runner().execute(
          'const a=Array.from({length:100000},(_,i)=>({i}));return {length:a.length,text:"x".repeat(1900000)};',
        )
      ).result,
    ).toMatchObject({ length: 100000, text: 'x'.repeat(1900000) });
  });
  it.each([
    ['return (', 'SyntaxError'],
    ['return missingIdentifier;', 'ReferenceError'],
    ['return 1n;', 'TypeError'],
    ['return NaN;', 'TypeError'],
    ['console.log("hello");', 'ReferenceError'],
  ])('provides bounded diagnostics for %s', async (code, name) => {
    await expect(runner().execute(code)).rejects.toMatchObject({
      code: 'execution_error',
      details: { name },
    });
  });
  it('reports the code author’s message and source line without host stacks', async () => {
    const error = await runner()
      .execute('const x=1;\nthrow new Error("example diagnostic");')
      .catch((e) => e);
    expect(error).toMatchObject({
      details: { name: 'Error', message: 'example diagnostic', line: 2 },
    });
    expect(JSON.stringify(error.details)).not.toContain('/Users/');
  });
  it('bounds diagnostic strings and does not invoke hostile accessors', async () => {
    const large = await runner()
      .execute('throw new Error("x".repeat(200000));')
      .catch((e) => e);
    expect(large.details.message.length).toBeLessThanOrEqual(1024);
    const hostile = await runner()
      .execute(
        'throw Object.defineProperty({},"message",{get(){while(true){}}});',
        { timeoutMs: 1000 },
      )
      .catch((e) => e);
    expect(hostile.code).toBe('execution_error');
  });
  it('preserves safe API codes and statuses inside guest catch blocks', async () => {
    const r = new CodeRunner({
      call: async () => {
        throw new SafeError(
          'upstream_http',
          'Tamperbox API returned HTTP 503.',
          503,
        );
      },
    });
    expect(
      (
        await r.execute(
          'try{await tamperbox.request({method:"GET",path:"/v1/find",query:{}});}catch(e){return {code:e.code,status:e.status,message:e.message};}',
        )
      ).result,
    ).toEqual({
      code: 'upstream_http',
      status: 503,
      message: 'Tamperbox API returned HTTP 503.',
    });
  });
  it('keeps unknown host error messages private while exposing their safe code', async () => {
    const r = new CodeRunner({
      call: async () => {
        throw Error('PRIVATE_UPSTREAM_BODY');
      },
    });
    const result = await r.execute(
      'try{await tamperbox.request({method:"GET",path:"/v1/find",query:{}});}catch(e){return {code:e.code,message:e.message};}',
    );
    expect(result.result).toEqual({
      code: 'internal',
      message: 'Operation failed.',
    });
  });
  it('gives actionable validation paths without echoing values or extra keys', async () => {
    const args = {
      input: { mediaType: 'private-value', value: 'private-payload' },
    };
    const e = (() => {
      try {
        validateInput('json_format', args);
      } catch (error) {
        return error;
      }
    })() as any;
    expect(e.details.validation).toEqual([
      {
        path: '/input/mediaType',
        keyword: 'enum',
        message: 'must be equal to one of the allowed values',
      },
    ]);
    expect(JSON.stringify(e)).not.toContain('private-value');
    expect(JSON.stringify(e)).not.toContain('private-payload');
    const r = await runner().execute(
      'try{await tamperbox.request({method:"POST",path:"/v1/tools/json_format",body:{}});}catch(e){return {code:e.code,details:e.details};}',
    );
    expect(r.result).toMatchObject({
      code: 'invalid_arguments',
      details: { validation: [{ path: '/body', keyword: 'required' }] },
    });
  });
  it('queues batches while limiting actual network concurrency', async () => {
    let active = 0,
      peak = 0;
    const call = vi.fn(async (_name, args) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return args;
    });
    const r = new CodeRunner({ call });
    const result = await r.execute(
      'return await Promise.all(Array.from({length:12},(_,i)=>tamperbox.request({method:"GET",path:"/v1/find",query:{query:String(i)}})));',
    );
    expect(peak).toBe(4);
    expect(result.apiCalls).toBe(12);
    expect(result.result).toEqual(
      Array.from({ length: 12 }, (_, i) => ({ query: String(i) })),
    );
  });
  it('releases queued calls after failures and honors custom parallelism', async () => {
    let active = 0,
      peak = 0;
    const r = new CodeRunner(
      {
        call: async (_name, args: any) => {
          peak = Math.max(peak, ++active);
          await new Promise((r) => setTimeout(r, 1));
          active--;
          if (args.query === '0') throw Error('private');
          return args.query;
        },
      },
      { maxParallelCalls: 2 },
    );
    const result = await r.execute(
      'return await Promise.allSettled(Array.from({length:6},(_,i)=>tamperbox.request({method:"GET",path:"/v1/find",query:{query:String(i)}})));',
    );
    expect(peak).toBe(2);
    expect(result.apiCalls).toBe(6);
    expect(
      (result.result as any[]).filter((x) => x.status === 'fulfilled'),
    ).toHaveLength(5);
  });
  it('starts no queued calls after cancellation', async () => {
    let ready!: () => void;
    const started = new Promise<void>((r) => (ready = r));
    const call = vi.fn(async () => {
      if (call.mock.calls.length === 4) ready();
      return new Promise(() => {});
    });
    const r = new CodeRunner({ call });
    const abort = new AbortController();
    const execution = r.execute(
      'return await Promise.all(Array.from({length:10},()=>tamperbox.request({method:"GET",path:"/v1/find",query:{}})));',
      { signal: abort.signal },
    );
    const caught = execution.catch((e) => e);
    await started;
    abort.abort();
    expect((await caught).code).toBe('cancelled');
    expect(call).toHaveBeenCalledTimes(4);
  });
  it('works when the library caller uses Node --input-type=module', () => {
    const source = `import {CodeRunner} from './dist/runner.js';console.log(JSON.stringify(await new CodeRunner({call:async()=>null}).execute('return 42;')));`;
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', source],
      { encoding: 'utf8' },
    );
    expect(JSON.parse(output)).toEqual({ result: 42, apiCalls: 0 });
  });
});

it('reports uncaught validation paths to the model without a guest catch block', async () => {
  const error = await runner()
    .execute(
      'return await tamperbox.request({method:"POST",path:"/v1/tools/json_format",body:{input:{mediaType:"private-value",value:"secret"}}});',
    )
    .catch((e) => e);
  expect(error.details.message).toContain('/input/mediaType');
  expect(error.details.message).toContain('allowed values');
  expect(JSON.stringify(error.details)).not.toContain('private-value');
});
it('bounds memory even when the guest catches allocation failure', async () => {
  const result = await runner().execute(
    'const a=[];try{for(let i=0;i<6;i++)a.push(new Uint8Array(16*1024*1024).fill(1));}catch{}return a.length;',
  );
  expect(result.result).toBeGreaterThan(0);
  expect(result.result).toBeLessThan(4);
});
it('handles mutated prototypes and hostile proxies during diagnostics', async () => {
  const mutation = await runner()
    .execute(
      'const target=Object.defineProperty({},"message",{get(){throw 1;}});Object.defineProperty(Object.prototype,"value",{get(){while(true){}}});throw target;',
      { timeoutMs: 1000 },
    )
    .catch((e) => e);
  expect(mutation.code).toBe('execution_error');
  const proxy = await runner()
    .execute(
      'throw new Proxy({},{getOwnPropertyDescriptor(){while(true){}}});',
      { timeoutMs: 150 },
    )
    .catch((e) => e);
  expect(proxy.code).toBe('execution_timeout');
});
