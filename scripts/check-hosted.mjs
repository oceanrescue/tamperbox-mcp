/** Opt-in acceptance through HTTPS deployment or the exact local Wrangler endpoint. */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { operations, validateRequest } from '../dist/spec.js';

const expectedVersion = '0.3.0';
const expectedCatalog = {
  operations: operations.length,
  websiteTools: new Set(
    operations.flatMap((operation) => operation.websiteToolIds),
  ).size,
};
const local = process.argv.length === 3 && process.argv[2] === '--local';
if (process.argv.length > 2 && !local)
  throw new Error('Only --local is supported.');
const startedAt = new Date().toISOString();
const checks = [];
let endpoint, client, transport;
const overall = AbortSignal.timeout(240_000);
const auth = {};
const options = { timeout: 35_000, maxTotalTimeout: 35_000, signal: overall };
class CheckFailure extends Error {
  constructor(message, status = 'failed') {
    super(message);
    this.status = status;
  }
}
// Do not print upstream responses, SDK exception messages, URLs or credentials.
async function check(name, fn) {
  try {
    const evidence = await fn();
    checks.push({
      name,
      status: 'passed',
      ...(evidence === undefined ? {} : { evidence }),
    });
    return true;
  } catch (error) {
    checks.push({
      name,
      status: error instanceof CheckFailure ? error.status : 'failed',
      reason:
        error instanceof CheckFailure
          ? error.message
          : 'The check did not satisfy its contract or the connection failed.',
    });
    return false;
  }
}
async function boundedFetch(url, init = {}) {
  const signal = AbortSignal.any([
    overall,
    AbortSignal.timeout(35_000),
    ...(init.signal ? [init.signal] : []),
  ]);
  const response = await fetch(url, { ...init, redirect: 'error', signal });
  // This deployment deliberately returns JSON, not an open-ended SSE stream.
  const reader = response.body?.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 7 * 1024 * 1024)
        throw new CheckFailure('Response exceeded the 7 MiB acceptance limit.');
      chunks.push(value);
    }
  } catch (error) {
    await reader?.cancel().catch(() => {});
    throw error;
  } finally {
    reader?.releaseLock();
  }
  const body = chunks.length ? Buffer.concat(chunks) : null;
  return new Response([204, 205, 304].includes(response.status) ? null : body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
async function call(name, code) {
  const value = await client.callTool(
    { name, arguments: { code, timeoutMs: 30_000 } },
    undefined,
    options,
  );
  if (value.isError) {
    let diagnostic;
    try {
      diagnostic = JSON.parse(
        value.content.find((item) => item.type === 'text')?.text ?? '{}',
      );
    } catch {}
    const unavailable = [
      'upstream_timeout',
      'upstream_network',
      'busy',
      'cancelled',
    ].includes(diagnostic?.code);
    throw new CheckFailure(
      unavailable
        ? 'The MCP/API operation was unavailable; no successful evidence was obtained.'
        : 'The MCP tool returned an error rather than a successful result.',
      unavailable ? 'unavailable' : 'failed',
    );
  }
  assert.ok(
    value.structuredContent && Object.hasOwn(value.structuredContent, 'result'),
  );
  assert.ok(Number.isInteger(value.structuredContent.apiCalls));
  const text = value.content.find((item) => item.type === 'text');
  assert.ok(text);
  assert.deepEqual(JSON.parse(text.text), value.structuredContent);
  return value.structuredContent;
}
async function apiRequest(request) {
  // Catch only to classify availability without leaking upstream or host messages.
  const value = await call(
    'execute',
    `try {return {ok:true,value:await tamperbox.request(${JSON.stringify(request)})};} catch(error) {return {ok:false,error:{code:error.code,status:error.status,operation:error.operation}};}`,
  );
  assert.equal(value.apiCalls, 1);
  if (value.result.ok !== true) {
    const error = value.result.error;
    const availableFailure =
      ['upstream_timeout', 'upstream_network'].includes(error?.code) ||
      error?.status === 429 ||
      error?.status >= 500;
    if (!error || typeof error.code !== 'string')
      throw new CheckFailure(
        'API error was not represented as typed failure evidence.',
      );
    throw new CheckFailure(
      availableFailure
        ? 'The live API was unavailable or rate limited; this is not an empty or successful result.'
        : 'The live API rejected the requested operation.',
      availableFailure ? 'unavailable' : 'failed',
    );
  }
  validateRequest(request).validateResponse(200, value.result.value);
  return value.result.value;
}
try {
  const configured = await check('configuration', async () => {
    const value = local
      ? 'http://localhost:18791/mcp'
      : process.env.TAMPERBOX_MCP_URL;
    if (!value)
      throw new CheckFailure(
        'Set TAMPERBOX_MCP_URL to the new HTTPS Code Mode endpoint.',
      );
    try {
      endpoint = new URL(value);
    } catch {
      throw new CheckFailure(
        'TAMPERBOX_MCP_URL must be a valid HTTPS /mcp URL.',
      );
    }
    if (
      (!local && endpoint.protocol !== 'https:') ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== '/mcp'
    )
      throw new CheckFailure(
        'Use an HTTPS /mcp URL without URL credentials, query or fragment.',
      );
    const token = process.env.TAMPERBOX_MCP_TOKEN;
    if (token && /[\r\n]/.test(token))
      throw new CheckFailure(
        'TAMPERBOX_MCP_TOKEN contains an invalid header character.',
      );
    if (token) auth.authorization = `Bearer ${token}`;
  });
  if (configured) {
    await check('health', async () => {
      const response = await boundedFetch(new URL('/health', endpoint), {
        headers: auth,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        status: 'ok',
        version: expectedVersion,
      });
      return {
        version: expectedVersion,
        upstreamAvailabilityEstablished: false,
      };
    });
    client = new Client({
      name: 'tamperbox-hosted-acceptance',
      version: expectedVersion,
    });
    transport = new StreamableHTTPClientTransport(endpoint, {
      fetch: boundedFetch,
      requestInit: { headers: auth, redirect: 'error' },
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
    });
    const connected = await check('mcp-initialize', async () => {
      await client.connect(transport, options);
      assert.equal(client.getServerVersion()?.version, expectedVersion);
      assert.equal(client.getServerVersion()?.name, 'tamperbox-mcp');
      return { version: expectedVersion };
    });
    if (connected) {
      await check('tools-and-schemas', async () => {
        const list = await client.listTools({}, options);
        assert.equal(list.nextCursor, undefined);
        assert.deepEqual(list.tools.map((tool) => tool.name).sort(), [
          'execute',
          'search',
        ]);
        for (const tool of list.tools) {
          assert.equal(tool.inputSchema.type, 'object');
          assert.ok(tool.inputSchema.required.includes('code'));
          assert.equal(tool.inputSchema.properties.code.type, 'string');
          assert.equal(tool.outputSchema.type, 'object');
          assert.ok(tool.outputSchema.properties.result);
          assert.equal(tool.outputSchema.properties.apiCalls.type, 'integer');
          assert.match(
            tool.outputSchema.properties.apiCalls.description,
            /host-validation failures/,
          );
          for (const key of [
            'readOnlyHint',
            'destructiveHint',
            'openWorldHint',
          ])
            assert.equal(typeof tool.annotations[key], 'boolean');
        }
        return { tools: ['search', 'execute'] };
      });
      await check('search-catalog', async () => {
        const result = await call(
          'search',
          'return {operations:operations.length,websiteTools:new Set(operations.flatMap(o=>o.websiteToolIds)).size};',
        );
        assert.deepEqual(result, {
          result: expectedCatalog,
          apiCalls: 0,
        });
        return result;
      });
      await check('execute-local-code', async () => {
        const result = await call('execute', 'return 6*7;');
        assert.deepEqual(result, { result: 42, apiCalls: 0 });
        return result;
      });
      await check('live-json-format', async () => {
        const response = await apiRequest({
          method: 'POST',
          path: '/v1/tools/json_format',
          body: {
            input: { mediaType: 'application/json', value: '{"example":true}' },
            options: { indent: 2 },
          },
        });
        assert.equal(response.output.mediaType, 'application/json');
        assert.equal(response.output.value, '{\n  "example": true\n}');
        return { mediaType: response.output.mediaType, apiCalls: 1 };
      });
      await check('live-jwt-to-yaml', async () => {
        const value = await call(
          'execute',
          `try {
          const decoded=await tamperbox.request({method:'POST',path:'/v1/tools/jwt_decode',body:{input:{mediaType:'application/jwt',value:'eyJhbGciOiJub25lIn0.eyJzdWIiOiJleGFtcGxlIn0.'}}});
          const yaml=await tamperbox.request({method:'POST',path:'/v1/tools/json_to_yaml',body:{input:decoded.output}});
          return {ok:true,decoded,yaml,warning:'Decoding does not verify signature validity or trust.'};
        } catch(error) {return {ok:false,error:{code:error.code,status:error.status}};}`,
        );
        if (!value.result.ok) {
          const error = value.result.error;
          const unavailable =
            ['upstream_timeout', 'upstream_network'].includes(error?.code) ||
            error?.status === 429 ||
            error?.status >= 500;
          throw new CheckFailure(
            'The live composition did not complete; no YAML success is claimed.',
            unavailable ? 'unavailable' : 'failed',
          );
        }
        assert.equal(value.apiCalls, 2);
        const { decoded, yaml } = value.result;
        const decodedData = JSON.parse(decoded.output.value);
        assert.deepEqual(decodedData, {
          header: { alg: 'none' },
          payload: { sub: 'example' },
          signatureVerified: false,
        });
        assert.ok(Array.isArray(decoded.warnings));
        assert.equal(
          value.result.warning,
          'Decoding does not verify signature validity or trust.',
        );
        assert.equal(yaml.output.mediaType, 'application/yaml');
        assert.match(yaml.output.value, /header:\s*\n\s+alg: ['"]?none/);
        assert.match(yaml.output.value, /payload:\s*\n\s+sub: ['"]?example/);
        assert.match(yaml.output.value, /signatureVerified: false/);
        return {
          apiCalls: 2,
          mediaType: yaml.output.mediaType,
          signatureVerified: false,
          verificationLimitationRetained: true,
          upstreamWarningCount: decoded.warnings.length,
        };
      });
      await check('live-dns-evidence', async () => {
        const response = await apiRequest({
          method: 'POST',
          path: '/v1/tools/dns_lookup',
          body: { name: 'example.com', type: 'A', resolver: 'google' },
        });
        const dns = response.result;
        assert.equal(dns.question.name.replace(/\.$/, ''), 'example.com');
        assert.equal(dns.question.type, 'A');
        assert.equal(dns.resolver, 'google');
        if (
          ['ERROR', 'SERVFAIL', 'REFUSED', 'unavailable', 'partial'].includes(
            dns.status,
          )
        )
          throw new CheckFailure(
            'DNS returned failed or incomplete evidence; it is not a successful lookup.',
            'unavailable',
          );
        assert.equal(dns.status, 'NOERROR');
        assert.ok(
          dns.answer.some(
            (row) => row.type === 'A' && typeof row.data === 'string',
          ),
        );
        return {
          question: { name: 'example.com', type: 'A' },
          resolver: 'google',
          dnsStatus: dns.status,
          answerCount: dns.answer.length,
          apiCalls: 1,
        };
      });
    }
    const rejects = [
      [
        'unknown-route',
        new URL('/__tamperbox_acceptance_missing__', endpoint),
        { method: 'GET' },
        404,
      ],
      [
        'disallowed-origin',
        endpoint,
        {
          method: 'POST',
          headers: {
            origin: 'https://tamperbox-acceptance-disallowed.invalid',
            'content-type': 'application/json',
          },
          body: '{}',
        },
        403,
      ],
      ['get-not-supported', endpoint, { method: 'GET' }, 405],
      [
        'invalid-content-type',
        endpoint,
        {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: '{}',
        },
        415,
      ],
      [
        'malformed-json',
        endpoint,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        },
        400,
      ],
    ];
    for (const [name, url, init, expectedStatus] of rejects)
      await check(name, async () => {
        const response = await boundedFetch(url, {
          ...init,
          headers: {
            ...auth,
            accept: 'application/json, text/event-stream',
            ...init.headers,
          },
        });
        assert.equal(response.status, expectedStatus);
        return { status: response.status };
      });
  }
} catch {
  checks.push({
    name: 'acceptance-run',
    status: 'failed',
    reason:
      'The acceptance runner could not finish; details are suppressed to protect configuration.',
  });
} finally {
  if (client)
    await check('client-close', async () => {
      let timer;
      try {
        await Promise.race([
          client.close(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(new CheckFailure('Client close exceeded five seconds.')),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    });
  const passed =
    checks.length > 0 && checks.every((item) => item.status === 'passed');
  console.log(
    JSON.stringify(
      {
        passed,
        target: local ? 'local-worker' : 'hosted',
        expectedVersion,
        startedAt,
        finishedAt: new Date().toISOString(),
        checks,
        scope: local
          ? 'Local Wrangler/Podman MCP transport, sandbox and selected live API operations only.'
          : 'Hosted MCP transport, sandbox and selected live API operations only.',
        providerModelAcceptance: 'not run',
        allOperationAvailabilityEstablished: false,
      },
      null,
      2,
    ),
  );
  if (!passed) process.exitCode = 1;
}
