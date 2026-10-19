import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalog } from '../dist/catalog.js';
const spec = JSON.parse(
  readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8'),
);
describe('published OpenAPI snapshot', () => {
  it('covers every published API path', () => {
    expect(
      catalog.map((x) => x.path.replace('jwt-to-yaml', '{id}')).sort(),
    ).toEqual(Object.keys(spec.paths).sort());
  });
  it.each(catalog.filter((x) => x.method === 'POST'))(
    'matches the published $name request and result schemas',
    (op) => {
      const endpoint = spec.paths[op.path].post;
      expect(op.inputSchema).toEqual(
        endpoint.requestBody.content['application/json'].schema,
      );
      expect(op.outputSchema).toEqual(
        endpoint.responses['200'].content['application/json'].schema,
      );
    },
  );
});
