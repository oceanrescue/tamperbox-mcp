// Explicit developer action only. The MCP runtime never reads another checkout.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';

const [catalogSource, openapiSource] = process.argv.slice(2);
assert.ok(
  catalogSource && openapiSource,
  'Usage: npm run sync:upstream -- <agent-catalog.js> <openapi.json>',
);

const catalog = await import(pathToFileURL(resolve(catalogSource)).href);
const openapi = JSON.parse(await readFile(resolve(openapiSource), 'utf8'));
for (const name of [
  'ENGINE_VERSION',
  'operations',
  'operationResultSchema',
  'pipelineSchema',
  'pipelineResultSchema',
  'findSchema',
  'recipe',
]) {
  assert.ok(catalog[name], `Agent catalog must export ${name}.`);
}
assert.ok(
  openapi?.openapi?.startsWith('3.') && openapi?.info && openapi?.paths,
  'Expected an OpenAPI 3 document.',
);

const contract = {
  engineVersion: catalog.ENGINE_VERSION,
  operations: catalog.operations.map((operation) => ({
    ...operation,
    outputSchema: catalog.operationResultSchema(operation),
  })),
  pipelineSchema: catalog.pipelineSchema,
  pipelineResultSchema: catalog.pipelineResultSchema,
  findSchema: catalog.findSchema,
  recipe: catalog.recipe,
};
const legacyPaths = new Set([
  ...catalog.operations.map(({ id }) => `/v1/tools/${id}`),
  '/v1/pipeline',
  '/v1/find',
  '/v1/recipes/{id}',
]);
const fixture = {
  ...openapi,
  paths: Object.fromEntries(
    Object.entries(openapi.paths).filter(([path]) => legacyPaths.has(path)),
  ),
};

const json = (value) =>
  format(JSON.stringify(value), { parser: 'json', tabWidth: 2 });
await Promise.all([
  writeFile(
    new URL('../src/api-contract.json', import.meta.url),
    await json(contract),
  ),
  writeFile(
    new URL('../src/openapi.json', import.meta.url),
    await json(openapi),
  ),
  writeFile(
    new URL('../test/fixtures/openapi.json', import.meta.url),
    await json(fixture),
  ),
]);
console.log(
  `Updated ${contract.operations.length} transforms, ${Object.keys(openapi.paths).length} API paths and the public-contract fixture.`,
);
