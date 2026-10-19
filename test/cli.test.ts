import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parseConfig } from '../dist/config.js';
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
describe('CLI configuration and stdio distribution', () => {
  it('defaults to stdio with the public API', () =>
    expect(parseConfig([], {})).toMatchObject({
      transport: 'stdio',
      host: '127.0.0.1',
      port: 3000,
      apiBaseUrl: 'https://api.tamperbox.dev',
    }));
  it.each([
    ['--wat'],
    ['--transport', 'udp'],
    ['--port', 'abc'],
    ['--port', '-1'],
    ['--port', '70000'],
    ['--port'],
    ['--host', '0.0.0.0'],
  ])('rejects invalid or accidentally exposed config %j', (argv) =>
    expect(() => parseConfig(argv, {})).toThrow(),
  );
  it('accepts explicit public HTTP or token-protected HTTP', () => {
    expect(
      parseConfig(['--transport', 'http', '--host', '0.0.0.0', '--public'], {}),
    ).toMatchObject({ publicHttp: true });
    expect(
      parseConfig(['--transport', 'http', '--host', '0.0.0.0'], {
        TAMPERBOX_MCP_TOKEN: 'fixture-token',
      }).bearerToken,
    ).toBe('fixture-token');
  });
  it('rejects malformed env and validates origin allowlists', () => {
    for (const env of [
      { PORT: '0' },
      { TAMPERBOX_ALLOW_LOCAL_HTTP: 'yes' },
      { TAMPERBOX_ALLOWED_ORIGINS: 'null' },
      { TAMPERBOX_ALLOWED_ORIGINS: 'https://user:pass@example.com' },
    ])
      expect(() => parseConfig([], env)).toThrow();
  });
  it('prints help/version without starting a transport and reports config errors without secrets', () => {
    expect(
      spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }).stdout,
    ).toContain('tamperbox-mcp');
    expect(
      spawnSync(process.execPath, [cli, '--version'], {
        encoding: 'utf8',
      }).stdout.trim(),
    ).toBe('0.2.0');
    const r = spawnSync(process.execPath, [cli, '--private-token-value'], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain('private-token-value');
  });
  it('runs from the compiled CLI over real stdio without protocol noise', async () => {
    const client = new Client({ name: 'test-stdio', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli],
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk) => (stderr += String(chunk)));
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools).toHaveLength(2);
      expect(
        (
          await client.callTool({
            name: 'execute',
            arguments: { code: 'return {value:6*7};' },
          })
        ).structuredContent,
      ).toEqual({ result: { value: 42 }, apiCalls: 0 });
      expect(stderr).toBe('');
    } finally {
      await client.close();
    }
  });
});
