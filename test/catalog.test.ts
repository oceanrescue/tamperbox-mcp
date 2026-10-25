import { describe, expect, it } from 'vitest';
import { catalog, discover, validateInput } from '../dist/catalog.js';

describe('API contract', () => {
  it('exposes the nine published transforms and three utility operations', () => {
    expect(catalog.map((x) => x.name).sort()).toEqual([
      'api_convert',
      'find',
      'json_format',
      'json_to_yaml',
      'jwt_decode',
      'mojibake_fix',
      'naughty_strings',
      'pipeline',
      'recipe',
      'string_generate',
      'text_inspect',
      'timestamp_to_iso',
    ]);
  });
  it('discovers without transmitting a query and returns usable schemas', () => {
    expect(discover({ query: 'JWT' }).operations.map((x) => x.name)).toContain(
      'jwt_decode',
    );
    expect(
      discover({ names: ['json_format'] }).operations[0]?.inputSchema,
    ).toHaveProperty('required');
    expect(discover({ query: 'no-such-operation' }).operations).toEqual([]);
  });
  it('rejects unknown names, path injection and inherited properties', () => {
    for (const name of [
      '../find',
      'constructor',
      'toString',
      '__proto__',
      'https://evil.example',
    ])
      expect(() => validateInput(name, {})).toThrow();
  });
  it('validates every example and rejects extra fields', () => {
    for (const op of catalog) {
      expect(() => validateInput(op.name, op.example)).not.toThrow();
      expect(() =>
        validateInput(op.name, { ...op.example, unexpected: true }),
      ).toThrow();
    }
  });
  it.each([
    ['json_format', {}],
    ['json_format', { input: { mediaType: 'text/plain', value: '{}' } }],
    [
      'json_format',
      {
        input: { mediaType: 'application/json', value: '{}' },
        options: { indent: 9 },
      },
    ],
    [
      'api_convert',
      { input: { mediaType: 'text/plain', value: 'curl https://example.com' } },
    ],
    [
      'pipeline',
      { version: 1, input: { mediaType: 'text/plain', value: '' }, steps: [] },
    ],
    ['find', { query: 'x'.repeat(257) }],
    ['recipe', { id: '../secret' }],
  ])('rejects invalid %s arguments', (name, args) =>
    expect(() => validateInput(name as string, args)).toThrow(),
  );
});
