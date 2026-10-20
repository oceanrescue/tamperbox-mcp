/** Opt-in cross-repository acceptance. All external network services are synthetic. */
import assert from 'node:assert/strict';
import { createServer as createNodeServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  ApiClient,
  CodeRunner,
  createServer,
  spec,
  operations,
} from '../dist/index.js';
const checkout = process.argv[2] ?? process.env.TAMPERBOX_API_CHECKOUT;
assert.ok(
  checkout,
  'Usage: npm run test:api-integration -- /path/to/toolkit-apps',
);
const root = resolve(checkout);
const load = (path) => import(pathToFileURL(resolve(root, path)).href);
const [
  { default: worker },
  { openapi },
  { agentOperations },
  { createAgentApiFixture },
] = await Promise.all([
  load('src/agent-worker.js'),
  load('src/agent-api/openapi.js'),
  load('src/agent-api/catalog.js'),
  load('test/fixtures/agent-api-upstream.js'),
]);
assert.deepEqual(
  spec,
  openapi,
  'Bundled OpenAPI drift: run sync:openapi with the upstream OpenAPI module before acceptance.',
);
const registry = JSON.parse(
  await readFile(resolve(root, 'tools/registry.json'), 'utf8'),
);
assert.deepEqual(
  [...new Set(operations.flatMap((op) => op.websiteToolIds))].sort(),
  registry.tools.map((t) => t.id).sort(),
);
const fixture = createAgentApiFixture();
const nativeFetch = globalThis.fetch;
globalThis.fetch = fixture.fetcher;
const routed = [];
const upstream = createNodeServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const request = new Request('https://api.tamperbox.dev' + req.url, {
      method: req.method,
      headers: { ...req.headers, 'cf-connecting-ip': '1.1.1.1' },
      ...(body.length ? { body } : {}),
    });
    Object.defineProperty(request, 'cf', { value: fixture.request.cf });
    routed.push(req.url);
    const response = await worker.fetch(request, {
      ...fixture.env,
      AGENT_RATE_LIMITER: { limit: async () => ({ success: true }) },
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(500);
    res.end('integration fixture failed');
    console.error(error);
  }
});
await new Promise((resolve, reject) => {
  upstream.once('error', reject);
  upstream.listen(0, '127.0.0.1', resolve);
});
const api = new ApiClient({
  baseUrl: `http://127.0.0.1:${upstream.address().port}`,
  allowLocalHttp: true,
  fetch: nativeFetch,
});
const server = createServer(new CodeRunner(api));
const client = new Client({ name: 'real-api-acceptance', version: '1' });
const [a, b] = InMemoryTransport.createLinkedPair();
try {
  await server.connect(a);
  await client.connect(b);
  assert.deepEqual(
    (await client.listTools()).tools.map((tool) => tool.name),
    ['search', 'execute'],
  );
  const discovery = await client.callTool({
    name: 'search',
    arguments: {
      code: 'return {operations:operations.map(o=>({id:o.operationId,path:o.path,method:o.method})),websiteToolIds:[...new Set(operations.flatMap(o=>o.websiteToolIds))]};',
    },
  });
  assert.equal(discovery.isError, undefined, JSON.stringify(discovery));
  assert.equal(discovery.structuredContent.apiCalls, 0);
  assert.equal(routed.length, 0);
  assert.equal(
    discovery.structuredContent.result.operations.length,
    agentOperations.length,
  );
  assert.equal(
    discovery.structuredContent.result.websiteToolIds.length,
    registry.tools.length,
  );
  const completed = [];
  for (const op of agentOperations) {
    const request = {
      method: op.method,
      path: op.path.replace('{id}', 'jwt-to-yaml'),
      ...(op.method === 'POST'
        ? { body: op.example }
        : op.id === 'tamperbox_find'
          ? { query: { query: 'dns' } }
          : {}),
    };
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: `return await tamperbox.request(${JSON.stringify(request)});`,
      },
    });
    assert.equal(
      result.isError,
      undefined,
      `${op.id}: ${JSON.stringify(result)}`,
    );
    assert.equal(result.structuredContent.apiCalls, 1);
    if (op.kind === 'report')
      assert.ok(
        Object.keys(result.structuredContent.result.result).length > 0,
        op.id,
      );
    if (op.id === 'what_is_my_ip') {
      assert.equal(result.structuredContent.result.result.ip, '1.1.1.1');
      assert.ok(
        result.structuredContent.result.warnings.some((w) => w.includes('MCP')),
      );
    }
    completed.push(op.id);
  }
  const chain = await client.callTool({
    name: 'execute',
    arguments: {
      code: `const dns=await tamperbox.request({method:'POST',path:'/v1/tools/dns_lookup',body:{name:'acme.com',type:'A'}});const formatted=await tamperbox.request({method:'POST',path:'/v1/tools/json_format',body:{input:{mediaType:'application/json',value:JSON.stringify(dns.result)}}});return {dns,formatted};`,
    },
  });
  assert.equal(chain.isError, undefined, JSON.stringify(chain));
  assert.equal(chain.structuredContent.apiCalls, 2);
  assert.deepEqual(
    JSON.parse(chain.structuredContent.result.formatted.output.value),
    chain.structuredContent.result.dns.result,
  );
  const failure = await client.callTool({
    name: 'execute',
    arguments: {
      code: `return await tamperbox.request({method:'POST',path:'/v1/tools/json_format',body:{input:{mediaType:'application/json',value:'{'}}});`,
    },
  });
  assert.equal(failure.isError, true);
  const diagnostic = JSON.parse(failure.content[0].text);
  assert.equal(diagnostic.details.operation, 'json_format');
  assert.match(diagnostic.details.message, /HTTP 422/);
  console.log(
    JSON.stringify({
      passed: true,
      operations: completed.length,
      websiteTools: registry.tools.length,
      apiRequests: routed.length,
      syntheticExternalRequests: fixture.calls.length,
      verified: [
        'bundled-contract-equality',
        'complete-search',
        'all-operation-examples',
        'report-to-transform-chain',
        'API-errors',
        'server-identity-warning',
      ],
    }),
  );
} finally {
  await client.close();
  await server.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  globalThis.fetch = nativeFetch;
}
