// Explicit developer action only. The MCP runtime never fetches a specification.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
const args = process.argv.slice(2);
const source = args[0];
assert.ok(
  source && args.slice(1).every((arg) => arg === '--check'),
  'Usage: npm run sync:openapi -- <local-openapi.json-or-module.js> [--check]',
);
assert.ok(!/^[a-z]+:\/\//i.test(source), 'Supply a local file, not a URL.');
const path = resolve(source);
const data =
  extname(path) === '.json'
    ? JSON.parse(await readFile(path, 'utf8'))
    : (await import(pathToFileURL(path).href)).openapi;
assert.ok(
  data?.openapi?.startsWith('3.') && data?.info && data?.paths,
  'Expected an OpenAPI 3 document (module must export openapi).',
);
const destination = new URL('../src/openapi.json', import.meta.url);
if (args.includes('--check')) {
  assert.deepEqual(
    JSON.parse(await readFile(destination, 'utf8')),
    data,
    'Bundled OpenAPI differs from the API contract; run sync:openapi without --check.',
  );
  console.log('PASS bundled OpenAPI matches the supplied API contract.');
} else {
  await writeFile(
    destination,
    await format(JSON.stringify(data), { parser: 'json', tabWidth: 2 }),
  );
  console.log('Updated src/openapi.json from the supplied local API contract.');
}
