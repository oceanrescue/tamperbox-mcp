import { describe, expect, it } from 'vitest';
import { operations, spec, validateRequest } from '../dist/spec.js';

describe('complete bundled API contract', () => {
  it('covers all 60 pages and their expanded server capabilities', () => {
    expect(operations).toHaveLength(120);
    expect(new Set(operations.flatMap((o) => o.websiteToolIds)).size).toBe(60);
    expect(new Set(operations.map((o) => o.operationId)).size).toBe(
      operations.length,
    );
    expect(Object.isFrozen(spec.paths)).toBe(true);
  });
  it.each(operations.filter((o) => o.method === 'POST'))(
    'validates the documented request example for $operationId',
    (operation) => {
      const raw = (spec.paths as any)[operation.path][
        operation.method.toLowerCase()
      ];
      const example = raw.requestBody.content['application/json'].example;
      expect(example).toBeDefined();
      const result = validateRequest({
        method: operation.method,
        path: operation.path,
        body: example,
      });
      expect(result.operation.operationId).toBe(operation.operationId);
    },
  );
  it('validates recipe path parameters and rejects unknown recipes', () => {
    expect(
      validateRequest({ method: 'GET', path: '/v1/recipes/jwt-to-yaml' })
        .pathArgs,
    ).toEqual({ id: 'jwt-to-yaml' });
    expect(() =>
      validateRequest({ method: 'GET', path: '/v1/recipes/unknown' }),
    ).toThrow();
  });
  it('requires exact documented methods and validates query types', () => {
    for (const request of [
      { method: 'get', path: '/v1/find' },
      { method: 'GET', path: '/v1/find', query: { query: 3 } },
      { method: 'GET', path: '/v1/find', query: { query: ['json'] } },
      { method: 'GET', path: '/v1/find', query: { query: null } },
      { method: 'GET', path: '/v1/find', query: { query: 'x'.repeat(257) } },
      { method: 'GET', path: '/v1/find', query: [] },
      { method: 'GET', path: '/v1/find', query: 'query=json' },
      { method: 'GET', path: '/v1/find', credentials: 'include' },
      { method: 'POST', path: '/v1/tools/constructor', body: {} },
      null,
      [],
      'GET /v1/find',
      {},
    ])
      expect(() => validateRequest(request)).toThrow();
  });
  it('validates actual success statuses and schemas rather than accepting any JSON', () => {
    const request = validateRequest({ method: 'GET', path: '/v1/find' });
    expect(() =>
      request.validateResponse(200, { tools: [], provenance: {} }),
    ).toThrow();
    expect(() =>
      request.validateResponse(201, { tools: [], provenance: {} }),
    ).toThrow();
  });
});
