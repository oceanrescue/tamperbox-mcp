// Local-only Docker API compatibility for workerd + Podman on cgroup v2.
import { createServer, request } from 'node:http';
import { connect } from 'node:net';

export function normalizeCreate(body, path, cgroupV2) {
  const name = new URL(path, 'http://localhost').searchParams.get('name');
  if (!cgroupV2 || !name?.startsWith('workerd-tamperbox-code-mode-local-'))
    return body;
  const data = JSON.parse(body.toString());
  const image = data.Image ?? '';
  if (
    (image.startsWith('cloudflare/proxy-everything:') ||
      image.startsWith('cloudflare-dev/tamperboxcodemode-')) &&
    data.HostConfig?.MemorySwappiness === 0
  ) {
    // workerd serializes the unset UInt32 field as 0. crun rejects it on
    // cgroup v2. Omit only this default; preserve every other resource setting.
    delete data.HostConfig.MemorySwappiness;
    return Buffer.from(JSON.stringify(data));
  }
  return body;
}

export function createPodmanApi({ socketPath, cgroupV2 }) {
  const sockets = new Set();
  const track = (socket) => {
    if (sockets.has(socket)) return socket;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  const server = createServer(async (req, res) => {
    let upstream;
    try {
      let body;
      if (
        req.method === 'POST' &&
        /^\/(?:v[\d.]+\/)?containers\/create(?:\?|$)/.test(req.url)
      ) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1024 * 1024) {
            res.writeHead(413).end();
            return;
          }
          chunks.push(chunk);
        }
        body = normalizeCreate(Buffer.concat(chunks), req.url, cgroupV2);
      }
      const headers = { ...req.headers };
      if (body) {
        headers['content-length'] = body.length;
        delete headers['transfer-encoding'];
      }
      upstream = request(
        { socketPath, path: req.url, method: req.method, headers },
        (reply) => {
          res.writeHead(reply.statusCode, reply.headers);
          reply.on('error', () => res.destroy());
          reply.pipe(res);
        },
      );
      upstream.on('socket', track);
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      res.on('close', () => upstream.destroy());
      req.on('error', () => upstream.destroy());
      if (body) upstream.end(body);
      else req.pipe(upstream);
    } catch {
      upstream?.destroy();
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });
  server.on('connection', track);
  // Preserve Docker's hijacked attach/exec streams without interpreting them.
  server.on('upgrade', (req, socket, head) => {
    const upstream = track(connect(socketPath));
    upstream.on('connect', () => {
      const headers = req.rawHeaders.reduce((lines, value, i, values) => {
        if (i % 2 === 0) lines.push(`${value}: ${values[i + 1]}`);
        return lines;
      }, []);
      upstream.write(
        `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`,
      );
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
  });
  return {
    server,
    async close() {
      const closed = new Promise((resolve) => server.close(resolve));
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}
