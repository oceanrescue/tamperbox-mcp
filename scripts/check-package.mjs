import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'tamperbox-package-'));
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run with npm run test:package.');
try {
  const output = execFileSync(
    process.execPath,
    [
      npm,
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      directory,
      '--cache',
      join(directory, 'npm-cache'),
    ],
    { cwd: root, encoding: 'utf8' },
  );
  const packed = JSON.parse(output);
  const [pack] = Array.isArray(packed) ? packed : Object.values(packed);
  assert.ok(
    pack?.filename && Array.isArray(pack.files),
    'Unexpected npm pack output.',
  );
  const paths = pack.files.map((x) => x.path);
  for (const required of [
    'dist/cli.js',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/sandbox-worker.js',
    'dist/api-contract.json',
    'dist/openapi.json',
    'dist/spec.js',
    'README.md',
    'LICENSE',
    'server.json',
    'examples/stdio-execute.mjs',
  ])
    assert.ok(paths.includes(required), `Missing ${required}`);
  for (const path of paths)
    assert.ok(
      !/(^|\/)(?:\.env|node_modules|test|coverage|\.git)(?:\/|$)/.test(path),
      `Private or development artifact packed: ${path}`,
    );
  assert.ok(
    // The full 119-operation contract is bundled for offline discovery.
    // Measured 0.3.0 candidate: 1.17 MB unpacked, 120 kB compressed.
    pack.unpackedSize < 1.5 * 1024 * 1024 && pack.size < 160 * 1024,
    'Package exceeds the expected size budget.',
  );
  // Only dependencies are linked; executable code/config must come from the tarball.
  execFileSync('tar', [
    '-xzf',
    join(directory, pack.filename),
    '-C',
    directory,
  ]);
  const extracted = join(directory, 'package');
  await symlink(
    join(root, 'node_modules'),
    join(extracted, 'node_modules'),
    'junction',
  );
  const pkg = JSON.parse(
    await readFile(join(extracted, 'package.json'), 'utf8'),
  );
  const client = new Client({ name: 'tarball-smoke', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(extracted, 'dist/cli.js')],
      cwd: directory,
      stderr: 'pipe',
    }),
  );
  try {
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      ['search', 'execute'],
    );
    const discovery = await client.callTool({
      name: 'search',
      arguments: {
        code: 'return {operations:operations.length,websiteTools:new Set(operations.flatMap(o=>o.websiteToolIds)).size};',
      },
    });
    assert.deepEqual(discovery.structuredContent, {
      result: { operations: 119, websiteTools: 58 },
      apiCalls: 0,
    });
    const result = await client.callTool({
      name: 'execute',
      arguments: { code: 'return {answer:6*7};' },
    });
    assert.deepEqual(result.structuredContent, {
      result: { answer: 42 },
      apiCalls: 0,
    });
  } finally {
    await client.close();
  }
  const oneShot = execFileSync(
    process.execPath,
    [join(extracted, 'examples/stdio-execute.mjs')],
    {
      cwd: directory,
      input: 'return 6 * 7;',
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.deepEqual(JSON.parse(oneShot), { result: 42, apiCalls: 0 });
  process.stdout.write(
    `PASS ${pkg.name}@${pkg.version}: ${paths.length} packed files; extracted stdio + sandbox + one-shot client smoke passed.\n`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
