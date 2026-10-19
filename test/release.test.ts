import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { VERSION } from '../dist/server.js';
const read = (path: string) =>
  JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
describe('release metadata', () => {
  it('validates against the official MCP Registry schema snapshot', () => {
    const ajv = new Ajv({ strict: false, validateFormats: false });
    const validate = ajv.compile(read('test/fixtures/mcp-server.schema.json'));
    expect(validate(read('server.json')), JSON.stringify(validate.errors)).toBe(
      true,
    );
  });
  it('keeps package, CLI and registry versions and identifiers aligned', () => {
    const pkg = read('package.json'),
      manifest = read('server.json');
    expect(pkg.version).toBe(VERSION);
    expect(manifest.version).toBe(VERSION);
    expect(pkg.mcpName).toBe(manifest.name);
    expect(manifest.packages[0]).toMatchObject({
      identifier: pkg.name,
      version: pkg.version,
      transport: { type: 'stdio' },
    });
  });
  it('pins runtime dependencies and uses only public registry URLs', () => {
    const pkg = read('package.json');
    for (const version of Object.values(pkg.dependencies))
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const lock = read('package-lock.json');
    for (const entry of Object.values(lock.packages) as any[])
      if (entry.resolved)
        expect(entry.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);
  });
  it('provides valid client config examples targeting the same binary', () => {
    for (const path of [
      'examples/claude-desktop.json',
      'examples/claude-code.mcp.json',
      'examples/vscode.mcp.json',
    ]) {
      const config = read(path);
      expect((config.mcpServers ?? config.servers).tamperbox).toMatchObject({
        command: 'node',
        args: ['/absolute/path/to/tamperbox-mcp/dist/cli.js'],
      });
    }
  });
});
