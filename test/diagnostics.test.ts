import { describe, expect, it } from 'vitest';
import { CodeRunner } from '../dist/runner.js';
import { SafeError } from '../dist/errors.js';

const runner = () => new CodeRunner({ call: async () => null });

describe('source locations', () => {
  it.each([
    ['return (', 1],
    ['const values = [\n  1,', 2],
    ['if (true) {\n  return 1;\n', 3],
    ['const value = `unfinished', 1],
    ['/* unfinished', 1],
    ['const value = 1;\nreturn (\n', 3],
  ])('locates incomplete code %j on user line %i', async (code, line) => {
    await expect(runner().execute(code)).rejects.toMatchObject({
      code: 'execution_error',
      details: { name: 'SyntaxError', line },
    });
  });

  it.each(['\n', '\r\n', '\r', '\u2028', '\u2029'])(
    'maps JavaScript line terminator %j without rewriting string contents',
    async (separator) => {
      const code = `const value = "💡é";${separator}throw new Error('located');`;
      await expect(runner().execute(code)).rejects.toMatchObject({
        details: { name: 'Error', message: 'located', line: 2 },
      });
      const literal = `return \`a${separator}b\`;`;
      expect((await runner().execute(literal)).result).toBe(
        `a${separator.replace(/\r\n?/g, '\n')}b`,
      );
    },
  );

  it('maps mixed terminators, nested functions and post-await throws', async () => {
    const code =
      'const value = "💡";\r\nasync function f(){\u2028await Promise.resolve();\rthrow new RangeError("located");\n}\u2029await f();';
    await expect(runner().execute(code)).rejects.toMatchObject({
      details: { name: 'RangeError', message: 'located', line: 4 },
    });
  });

  it('does not misattribute output serialization failures to the last user line', async () => {
    const error = await runner()
      .execute('const value = NaN;\nreturn value;')
      .catch((e) => e);
    expect(error.details.name).toBe('TypeError');
    expect(error.details).not.toHaveProperty('line');
  });
});

describe('bridge error construction under prototype mutation', () => {
  it.each(['status', 'details', 'get', 'set'])(
    'preserves safe errors despite an inherited %s getter',
    async (property) => {
      const r = new CodeRunner({
        call: async () => {
          throw new SafeError('upstream_network', 'Safe failure.');
        },
      });
      const code = `Object.defineProperty(Object.prototype,${JSON.stringify(property)},{get(){throw new Error('inherited getter invoked');}});
        try { await tamperbox.request({method:"GET",path:"/v1/find",query:{}}); }
        catch(e) { return {code:e.code,message:e.message}; }`;
      expect((await r.execute(code)).result).toEqual({
        code: 'upstream_network',
        message: 'Safe failure.',
      });
    },
  );

  it('does not depend on a guest-modified array iterator', async () => {
    const r = new CodeRunner({
      call: async () => {
        throw new SafeError('upstream_http', 'Safe failure.', 503);
      },
    });
    expect(
      (
        await r.execute(`Array.prototype[Symbol.iterator]=function(){throw new Error('iterator invoked');};
          try { await tamperbox.request({method:"GET",path:"/v1/find",query:{}}); }
          catch(e) { return {code:e.code,status:e.status,message:e.message}; }`)
      ).result,
    ).toEqual({
      code: 'upstream_http',
      status: 503,
      message: 'Safe failure.',
    });
  });
});
