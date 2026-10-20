import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../dist/client.js';
import { catalog } from '../dist/catalog.js';
const output = {
  output: { mediaType: 'application/json', value: '{}' },
  warnings: [],
  provenance: {
    provider: 'tamperbox.dev',
    tool: 'json_format',
    engineVersion: '1.0.0',
    attribution: 'Powered by tamperbox.dev',
    editorUrl: 'https://tamperbox.dev/pipeline',
  },
};
const args = { input: { mediaType: 'application/json', value: '{}' } };
describe('bounded REST bridge', () => {
  it('uses the official origin and preserves provenance', async () => {
    const fetcher = vi.fn(async () => Response.json(output));
    const client = new ApiClient({ fetch: fetcher });
    expect(await client.call('json_format', args)).toEqual(output);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.tamperbox.dev/v1/tools/json_format',
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
    });
  });
  it.each(catalog)('routes $name with the right method', async (op) => {
    const response =
      op.name === 'pipeline'
        ? {
            outputs: {},
            steps: [],
            warnings: [],
            provenance: output.provenance,
          }
        : op.name === 'find'
          ? { tools: [], provenance: output.provenance }
          : op.name === 'recipe'
            ? { id: 'jwt-to-yaml', version: 1, steps: [] }
            : {
                ...output,
                output: {
                  ...output.output,
                  mediaType:
                    op.name === 'json_to_yaml'
                      ? 'application/yaml'
                      : op.name === 'timestamp_to_iso'
                        ? 'text/plain'
                        : 'application/json',
                },
              };
    const fetcher = vi.fn(async () => Response.json(response));
    await new ApiClient({ fetch: fetcher }).call(op.name, op.example);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe(op.method);
    expect(fetcher.mock.calls[0]?.[0]).toContain(op.path);
  });
  it('rejects bad inputs before network access', async () => {
    const fetcher = vi.fn();
    const client = new ApiClient({ fetch: fetcher });
    await expect(client.call('constructor', {})).rejects.toMatchObject({
      code: 'unknown_operation',
    });
    await expect(
      client.call('json_format', { input: { value: 'secret' } }),
    ).rejects.toMatchObject({ code: 'invalid_arguments' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves bounded retry guidance and machine code, not upstream prose', async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          code: 'rate_limited',
          detail: 'sensitive input must not escape',
          hint: 'private data',
        },
        { status: 429, headers: { 'retry-after': '999999' } },
      ),
    );
    await expect(
      new ApiClient({ fetch: fetcher }).call('json_format', args),
    ).rejects.toMatchObject({
      code: 'upstream_http',
      details: { upstreamCode: 'rate_limited', retryAfterSeconds: 3600 },
    });
    try {
      await new ApiClient({ fetch: fetcher }).call('json_format', args);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('sensitive');
      expect(JSON.stringify(error)).not.toContain('private');
    }
  });
  it.each([301, 400, 401, 403, 404, 413, 429, 500, 503])(
    'handles HTTP %i without echo or retries',
    async (status) => {
      const fetcher = vi.fn(
        async () =>
          new Response('secret echoed input', {
            status,
            headers: { 'retry-after': '60' },
          }),
      );
      await expect(
        new ApiClient({ fetch: fetcher }).call('json_format', args),
      ).rejects.toMatchObject({
        code: 'upstream_http',
        status,
        message: `Tamperbox API returned HTTP ${status}.`,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    () => new Response('<html>secret</html>'),
    () =>
      new Response('{bad', { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ unexpected: 'secret' }),
    () =>
      new Response('x'.repeat(500), {
        headers: { 'content-type': 'application/json' },
      }),
  ])('rejects invalid or oversized upstream output', async (response) => {
    await expect(
      new ApiClient({
        fetch: async () => response(),
        maxResponseBytes: 400,
      }).call('json_format', args),
    ).rejects.toThrow();
  });
  it('sanitizes network errors', async () => {
    await expect(
      new ApiClient({
        fetch: async () => {
          throw Error('secret URL');
        },
      }).call('json_format', args),
    ).rejects.toMatchObject({
      code: 'upstream_network',
      message: 'Tamperbox API request failed.',
    });
  });
  it.each([
    'http://evil.example',
    'https://user:pass@example.com',
    'https://example.com/path',
    'https://example.com?secret=1',
    'file:///tmp/api',
  ])('rejects unsafe origin %s', (origin) =>
    expect(() => new ApiClient({ baseUrl: origin })).toThrow(),
  );
  it('requires explicit permission for a loopback test API', () => {
    expect(() => new ApiClient({ baseUrl: 'http://127.0.0.1:9000' })).toThrow();
    expect(
      () =>
        new ApiClient({
          baseUrl: 'http://127.0.0.1:9000',
          allowLocalHttp: true,
        }),
    ).not.toThrow();
  });
});
