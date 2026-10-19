import { describe, expect, it, vi } from 'vitest';
import { CodeRunner } from '../dist/runner.js';
import { SafeError } from '../dist/errors.js';

describe('API operation diagnostics', () => {
  it.each([
    new SafeError('upstream_http', 'Tamperbox API returned HTTP 503.', 503),
    new SafeError('upstream_network', 'Tamperbox API request failed.'),
    new SafeError('upstream_timeout', 'API request timed out.'),
    new Error('PRIVATE_HOST_ERROR'),
  ])(
    'identifies the failing operation after a successful call: %s',
    async (failure) => {
      const call = vi.fn(async (name) => {
        if (name === 'get_recipe') throw failure;
        return { ok: true };
      });
      const error = await new CodeRunner({ call })
        .execute(
          'await tamperbox.request({method:"GET",path:"/v1/find",query:{}});\nreturn await tamperbox.request({method:"GET",path:"/v1/recipes/jwt-to-yaml"});',
        )
        .catch((e) => e);
      expect(error).toMatchObject({
        code: 'execution_error',
        details: { name: 'Error', operation: 'get_recipe' },
      });
      expect(JSON.stringify(error)).not.toContain('PRIVATE_HOST_ERROR');
      expect(call).toHaveBeenCalledTimes(2);
    },
  );

  it('preserves per-call operations and existing fields in concurrent catch blocks', async () => {
    const failure = new SafeError('upstream_http', 'Safe failure.', 503);
    const runner = new CodeRunner({
      call: async () => {
        throw failure;
      },
    });
    const result = await runner.execute(`return await Promise.all(
      ['/v1/find','/v1/recipes/jwt-to-yaml'].map(async path => {
        try { await tamperbox.request({method:"GET",path}); }
        catch(e) { return {operation:e.operation,code:e.code,status:e.status,message:e.message}; }
      }));`);
    expect(result.result).toEqual(
      ['tamperbox_find', 'get_recipe'].map((operation) => ({
        operation,
        code: 'upstream_http',
        status: 503,
        message: 'Safe failure.',
      })),
    );
    expect(failure).not.toHaveProperty('operation');
    expect(failure.details).toBeUndefined();
  });

  it('keeps validation details and adds the operation without echoing inputs', async () => {
    const call = vi.fn(async () => null);
    const result = await new CodeRunner({ call }).execute(`
      try { await tamperbox.request({method:"POST",path:"/v1/tools/json_format",body:{input:{mediaType:'PRIVATE_MEDIA',value:'PRIVATE_INPUT'}}}); }
      catch(e) { return {operation:e.operation,code:e.code,details:e.details}; }`);
    expect(result.result).toMatchObject({
      operation: 'json_format',
      code: 'invalid_arguments',
      details: {
        validation: [{ path: '/body/input/mediaType', keyword: 'enum' }],
      },
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(call).not.toHaveBeenCalled();
  });

  it('does not invoke an operation getter during error reporting', async () => {
    const error = await new CodeRunner({ call: async () => null })
      .execute(
        'throw Object.defineProperty(new Error("safe"),"operation",{get(){while(true){}}});',
        { timeoutMs: 1000 },
      )
      .catch((e) => e);
    expect(error).toMatchObject({
      code: 'execution_error',
      details: { message: 'safe' },
    });
    expect(error.details).not.toHaveProperty('operation');
  });

  it('preserves the host operation despite an inherited operation getter', async () => {
    const runner = new CodeRunner({
      call: async () => {
        throw new Error('PRIVATE_HOST_ERROR');
      },
    });
    const error = await runner
      .execute(
        'Object.defineProperty(Object.prototype,"operation",{get(){throw Error("inherited getter");}});return await tamperbox.request({method:"GET",path:"/v1/recipes/jwt-to-yaml"});',
      )
      .catch((e) => e);
    expect(error).toMatchObject({
      code: 'execution_error',
      details: { operation: 'get_recipe', message: 'Operation failed.' },
    });
  });

  it('bounds guest-provided operation metadata', async () => {
    const error = await new CodeRunner({ call: async () => null })
      .execute(
        'throw Object.assign(new Error("bounded"),{operation:"x".repeat(100000)});',
      )
      .catch((e) => e);
    expect(error.details.operation).toBe('x'.repeat(64));
  });
});

describe('argument serialization diagnostics', () => {
  it.each([
    '()=>1',
    'Symbol("PRIVATE_SYMBOL")',
    '{toJSON(){return undefined;}}',
  ])(
    'rejects %s in the guest with a source line and without dispatching',
    async (argument) => {
      const call = vi.fn(async () => null);
      const runner = new CodeRunner({ call });
      const error = await runner
        .execute(
          `const argument=${argument};\nreturn await tamperbox.request(argument);`,
        )
        .catch((e) => e);
      expect(error).toMatchObject({
        code: 'execution_error',
        details: { name: 'TypeError', line: 2 },
      });
      expect(error.details.message).toContain('tamperbox.request');
      expect(error.details.message).toContain('JSON');
      expect(JSON.stringify(error)).not.toContain('PRIVATE_SYMBOL');
      expect(call).not.toHaveBeenCalled();
    },
  );

  it('does not charge locally rejected arguments against the API budget', async () => {
    const call = vi.fn(async () => ({ ok: true }));
    const runner = new CodeRunner({ call }, { maxCalls: 1 });
    const result = await runner.execute(`let name;
      try { await tamperbox.request(()=>1); } catch(e) { name=e.name; }
      return {name,value:await tamperbox.request({method:"GET",path:"/v1/find",query:{}})};`);
    expect(result).toEqual({
      result: { name: 'TypeError', value: { ok: true } },
      apiCalls: 1,
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('supports omitted and explicit undefined optional query arguments', async () => {
    const call = vi.fn(async (_name, args) => args);
    const result = await new CodeRunner({ call }).execute(
      'return [await tamperbox.request({method:"GET",path:"/v1/find",query:{}}),await tamperbox.request({method:"GET",path:"/v1/find",query:undefined})];',
    );
    expect(result).toEqual({ result: [{}, {}], apiCalls: 2 });
  });

  it('uses captured serialization and TypeError intrinsics', async () => {
    const call = vi.fn(async () => null);
    const error = await new CodeRunner({ call })
      .execute(
        `JSON.stringify=()=>"{}";
      globalThis.TypeError=function(){throw new Error('replaced constructor');};
      return await tamperbox.request(()=>1);`,
      )
      .catch((e) => e);
    expect(error).toMatchObject({
      code: 'execution_error',
      details: { name: 'TypeError', line: 3 },
    });
    expect(error.details.message).toContain('tamperbox.request');
    expect(call).not.toHaveBeenCalled();
  });
});
