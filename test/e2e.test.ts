import { afterEach, expect, it } from 'vitest';
import { createServer as nodeServer, type Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ApiClient, CodeRunner, createHttpServer } from '../dist/index.js';
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
it('composes HTTP MCP → real QuickJS → bounded REST → dependent second call', async () => {
  const requests: Array<{
    url: string;
    body: any;
    authorization: string | undefined;
  }> = [];
  const upstream = await listen(
    nodeServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push({
        url: req.url!,
        body,
        authorization: req.headers.authorization,
      });
      const first = req.url === '/v1/tools/jwt_decode';
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          output: {
            mediaType: first ? 'application/json' : 'application/yaml',
            value: first ? '{"sub":"example"}' : 'sub: example\n',
          },
          warnings: first ? ['Decoding is not signature verification.'] : [],
          provenance: {
            provider: 'tamperbox.dev',
            engineVersion: '1.0.0',
            tool: first ? 'jwt_decode' : 'json_to_yaml',
            attribution: 'Powered by tamperbox.dev',
            editorUrl: 'https://tamperbox.dev/pipeline',
          },
        }),
      );
    }),
  );
  const endpoint = await listen(
    createHttpServer(
      new CodeRunner(
        new ApiClient({ baseUrl: upstream, allowLocalHttp: true }),
      ),
      { bearerToken: 'inbound-fixture-token' },
    ),
  );
  const client = new Client({ name: 'full-stack-test', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint + '/mcp'), {
      requestInit: {
        headers: { authorization: 'Bearer inbound-fixture-token' },
      },
    }),
  );
  try {
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: `const decoded=await tamperbox.request({method:"POST",path:"/v1/tools/jwt_decode",body:{input:{mediaType:'application/jwt',value:'eyJhbGciOiJub25lIn0.eyJzdWIiOiJleGFtcGxlIn0.'}}});const yaml=await tamperbox.request({method:"POST",path:"/v1/tools/json_to_yaml",body:{input:decoded.output}});return {output:yaml.output,warnings:decoded.warnings,provenance:yaml.provenance};`,
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      apiCalls: 2,
      result: {
        output: { mediaType: 'application/yaml', value: 'sub: example\n' },
        warnings: ['Decoding is not signature verification.'],
        provenance: { provider: 'tamperbox.dev' },
      },
    });
    expect(requests.map((x) => x.url)).toEqual([
      '/v1/tools/jwt_decode',
      '/v1/tools/json_to_yaml',
    ]);
    expect(requests[1]?.body.input).toEqual({
      mediaType: 'application/json',
      value: '{"sub":"example"}',
    });
    expect(requests.every((x) => x.authorization === undefined)).toBe(true);
  } finally {
    await client.close();
  }
});

it('aborts a real upstream body that stalls after response headers', async () => {
  const upstream = await listen(
    nodeServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
    }),
  );
  const client = new ApiClient({
    baseUrl: upstream,
    allowLocalHttp: true,
    timeoutMs: 40,
  });
  await expect(client.call('find', {})).rejects.toMatchObject({
    code: 'upstream_response',
  });
});

it('does not follow a real upstream redirect or retry the operation', async () => {
  let count = 0;
  const upstream = await listen(
    nodeServer((_req, res) => {
      count++;
      res.writeHead(302, { location: '/private-target' });
      res.end();
    }),
  );
  await expect(
    new ApiClient({ baseUrl: upstream, allowLocalHttp: true }).call('find', {}),
  ).rejects.toMatchObject({ code: 'upstream_network' });
  expect(count).toBe(1);
});

it('cancels the worker and upstream call when the HTTP client disconnects', async () => {
  let received!: () => void;
  const started = new Promise<void>((r) => (received = r));
  let upstreamSignal: AbortSignal | undefined;
  const runner = new CodeRunner({
    call: async (_name, _args, signal) => {
      upstreamSignal = signal;
      received();
      return new Promise(() => {});
    },
  });
  const endpoint = await listen(createHttpServer(runner));
  const abort = new AbortController();
  const response = fetch(endpoint + '/mcp', {
    method: 'POST',
    signal: abort.signal,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'execute',
        arguments: {
          code: 'return await tamperbox.request({method:"GET",path:"/v1/find",query:{}});',
        },
      },
    }),
  });
  await started;
  abort.abort();
  await expect(response).rejects.toThrow();
  await expect.poll(() => upstreamSignal?.aborted).toBe(true);
  await expect
    .poll(async () => {
      try {
        return (await runner.execute('return 1;')).result;
      } catch {
        return false;
      }
    })
    .toBe(1);
});
