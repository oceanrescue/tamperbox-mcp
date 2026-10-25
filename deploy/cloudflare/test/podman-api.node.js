import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPodmanApi, normalizeCreate } from '../podman-api.mjs';

const path =
  '/containers/create?name=workerd-tamperbox-code-mode-local-test-proxy';
const spec = {
  Image: 'cloudflare/proxy-everything:test',
  HostConfig: {
    MemorySwappiness: 0,
    Memory: 536870912,
    MemorySwap: 536870912,
    CapAdd: ['NET_ADMIN'],
    Privileged: false,
  },
};
const body = Buffer.from(JSON.stringify(spec));

test('omits only workerd’s zero swappiness default on cgroup v2', () => {
  const normalized = JSON.parse(normalizeCreate(body, path, true));
  const expected = structuredClone(spec);
  delete expected.HostConfig.MemorySwappiness;
  assert.deepEqual(normalized, expected);
  const app = {
    ...spec,
    Image: 'cloudflare-dev/tamperboxcodemode-mcp-123:456',
  };
  assert.equal(
    JSON.parse(normalizeCreate(Buffer.from(JSON.stringify(app)), path, true))
      .HostConfig.MemorySwappiness,
    undefined,
  );
  assert.deepEqual(JSON.parse(body), spec);
});

test('preserves unrelated containers, cgroup v1 and explicit nonzero settings', () => {
  assert.equal(normalizeCreate(body, path, false), body);
  assert.equal(
    normalizeCreate(body, '/containers/create?name=unrelated', true),
    body,
  );
  for (const input of [
    { ...spec, Image: 'unrelated:latest' },
    { ...spec, HostConfig: { MemorySwappiness: 50 } },
    { ...spec, HostConfig: { Memory: 1024 } },
  ]) {
    const bytes = Buffer.from(JSON.stringify(input));
    assert.equal(normalizeCreate(bytes, path, true), bytes);
  }
});

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tb-api-test-'));
  const upstreamPath = join(directory, 'up.sock');
  const socketPath = join(directory, 'api.sock');
  const received = [];
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    received.push({
      method: req.method,
      path: req.url,
      headers: req.headers,
      body: bytes,
    });
    res.writeHead(req.method === 'POST' ? 201 : 200, {
      'content-type': 'application/json',
    });
    res.write('{"ok":');
    res.end('true}');
  });
  upstream.on('upgrade', (req, socket, head) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n',
    );
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  upstream.listen(upstreamPath);
  await once(upstream, 'listening');
  const api = createPodmanApi({ socketPath: upstreamPath, cgroupV2: true });
  api.server.listen(socketPath);
  await once(api.server, 'listening');
  t.after(async () => {
    await api.close();
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  const send = (method, url, bytes) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath,
          method,
          path: url,
          headers: { 'content-type': 'application/json' },
        },
        async (res) => {
          const chunks = [];
          for await (const chunk of res) chunks.push(chunk);
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString(),
          });
        },
      );
      req.on('error', reject);
      req.end(bytes);
    });
  return { send, received, socketPath };
}

test('real Unix socket forwards requests and responses, adjusting only create payload', async (t) => {
  const { send, received } = await fixture(t);
  assert.deepEqual(await send('POST', '/v1.44' + path, body), {
    status: 201,
    body: '{"ok":true}',
  });
  assert.equal(
    JSON.parse(received[0].body).HostConfig.MemorySwappiness,
    undefined,
  );
  assert.equal(
    Number(received[0].headers['content-length']),
    received[0].body.length,
  );
  assert.equal((await send('GET', '/containers/example/json')).status, 200);
  assert.equal(received[1].path, '/containers/example/json');
  await send('POST', '/exec/example/start', body);
  assert.deepEqual(received[2].body, body);
  assert.equal((await send('POST', path, '{')).status, 400);
  assert.equal(
    (await send('POST', path, Buffer.alloc(1024 * 1024 + 1))).status,
    413,
  );
  assert.equal(received.length, 3);
});

test(
  'rejects an oversized unfinished upload before closing its socket',
  { timeout: 5000 },
  async (t) => {
    const { socketPath, received } = await fixture(t);
    const socket = connect(socketPath);
    t.after(() => socket.destroy());
    const closed = once(socket, 'close');
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    await once(socket, 'connect');
    const oversized = Buffer.alloc(1024 * 1024 + 1, 'x');
    socket.write(
      `POST ${path} HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n`,
    );
    socket.write(oversized.length.toString(16) + '\r\n');
    socket.write(oversized);
    socket.write('\r\n');
    // Deliberately omit the terminating chunk: rejection must not wait for EOF.
    await closed;
    const reply = Buffer.concat(chunks).toString();
    assert.match(reply, /^HTTP\/1\.1 413 /);
    assert.match(reply, /\r\nconnection: close\r\n/i);
    assert.match(reply, /\r\n\r\n0\r\n\r\n$/);
    assert.equal(received.length, 0);
  },
);

test(
  'preserves Docker upgraded bidirectional streams',
  { timeout: 5000 },
  async (t) => {
    const { socketPath } = await fixture(t);
    const socket = connect(socketPath);
    t.after(() => socket.destroy());
    await once(socket, 'connect');
    const reply = once(socket, 'data');
    socket.write(
      'POST /exec/example/start HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n',
    );
    assert.match((await reply)[0].toString(), /101 Switching Protocols/);
    const echoed = once(socket, 'data');
    socket.write('test-stream');
    assert.equal((await echoed)[0].toString(), 'test-stream');
    socket.destroy();
  },
);
