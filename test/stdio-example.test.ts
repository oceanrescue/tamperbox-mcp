import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const example = fileURLToPath(
  new URL('../examples/stdio-execute.mjs', import.meta.url),
);
function run(
  input: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const result = spawnSync(process.execPath, [example], {
    input,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 5 * 1024 * 1024,
    cwd: options.cwd,
    env: { PATH: process.env.PATH, ...options.env },
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result;
}

it.each(['return 6*7;', 'return await Promise.resolve(42);'])(
  'waits for a response after piped code reaches EOF: %s',
  (code) => {
    const result = run(code);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('{"result":42,"apiCalls":0}\n');
  },
);

it('returns guest diagnostics and a failing exit status for tool errors', () => {
  const result = run('const value=1;\nreturn missingName;');
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('');
  const output = JSON.parse(result.stdout);
  expect(output.isError).toBe(true);
  expect(JSON.parse(output.content[0].text)).toMatchObject({
    code: 'execution_error',
    details: { name: 'ReferenceError', line: 2 },
  });
});

it('does not truncate a large one-shot response', () => {
  const result = run('return "x".repeat(1900000);');
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    result: 'x'.repeat(1900000),
    apiCalls: 0,
  });
});

it('resolves the server relative to the example rather than the working directory', () => {
  const result = run('return true;', { cwd: tmpdir() });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ result: true, apiCalls: 0 });
});

it('explains empty input without starting a request', () => {
  const result = run(' \n');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Pipe a JavaScript function body');
});

it('bounds UTF-8 input bytes before connecting', () => {
  const result = run('//' + '💡'.repeat(20000));
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('64 KiB');
  expect(result.stderr).not.toContain('💡');
});

it('reports startup failure without exposing private server configuration', () => {
  const result = run('return 1;', {
    env: { TAMPERBOX_API_BASE_URL: 'PRIVATE_CONFIGURATION_VALUE' },
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Could not execute code');
  expect(result.stderr).not.toContain('PRIVATE_CONFIGURATION_VALUE');
});
