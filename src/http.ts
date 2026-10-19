import { assertJsonDepth } from './json.js';
import {
  createServer as nodeServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, VERSION } from './server.js';
import type { CodeRunner } from './runner.js';
import { SafeError } from './errors.js';
export interface HttpOptions {
  allowedHosts?: string[];
  allowedOrigins?: string[];
  bearerToken?: string;
  maxBodyBytes?: number;
  bodyTimeoutMs?: number;
  requestsPerMinute?: number;
  maxActiveRequests?: number;
}
function send(res: ServerResponse, status: number, message: string) {
  if (!res.headersSent) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}
function equal(a: string, b: string) {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}
async function readBody(
  req: IncomingMessage,
  max: number,
  timeout: number,
): Promise<unknown> {
  if (Number(req.headers['content-length']) > max)
    throw new SafeError('body_size', 'Request exceeds the body limit.', 413);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const done = (error?: SafeError, value?: unknown) => {
      clearTimeout(timer);
      req.off('data', data);
      req.off('end', end);
      req.off('error', failed);
      req.off('aborted', failed);
      if (error) {
        req.resume();
        reject(error);
      } else resolve(value);
    };
    const failed = () =>
      done(new SafeError('body', 'Request could not be read.', 400));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > max)
        done(
          new SafeError('body_size', 'Request exceeds the body limit.', 413),
        );
      else chunks.push(chunk);
    };
    const end = () => {
      try {
        const value: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw Error();
        done(undefined, value);
      } catch {
        done(new SafeError('body', 'Send one JSON-RPC object.', 400));
      }
    };
    const timer = setTimeout(
      () =>
        done(
          new SafeError('body_timeout', 'Request body deadline exceeded.', 408),
        ),
      timeout,
    );
    req.on('data', data);
    req.on('end', end);
    req.on('error', failed);
    req.on('aborted', failed);
  });
}
export function createHttpServer(
  runner: CodeRunner,
  options: HttpOptions = {},
) {
  const hosts = new Set(
    options.allowedHosts ?? ['localhost', '127.0.0.1', '[::1]'],
  );
  const origins = new Set(options.allowedOrigins ?? []);
  let active = 0,
    count = 0,
    windowStart = Date.now();
  const server = nodeServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-robots-tag', 'noindex');
    let host: string;
    try {
      const url = new URL(`http://${req.headers.host ?? ''}`);
      if (
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw Error();
      host = url.hostname;
    } catch {
      send(res, 403, 'Host is not allowed.');
      return;
    }
    if (!hosts.has(host)) {
      send(res, 403, 'Host is not allowed.');
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {
      send(res, 403, 'Origin is not allowed.');
      return;
    }
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader(
        'access-control-expose-headers',
        'MCP-Protocol-Version, Retry-After',
      );
    }
    if (req.url === '/health' && req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', version: VERSION }));
      return;
    }
    if (req.url !== '/mcp') {
      send(res, 404, 'Not found.');
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers':
          'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id',
      });
      res.end();
      return;
    }
    if (
      options.bearerToken &&
      !equal(req.headers.authorization ?? '', `Bearer ${options.bearerToken}`)
    ) {
      res.setHeader('www-authenticate', 'Bearer');
      send(res, 401, 'Authentication required.');
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST, OPTIONS');
      send(res, 405, 'Use POST for MCP requests.');
      return;
    }
    if (Date.now() - windowStart >= 60000) {
      windowStart = Date.now();
      count = 0;
    }
    if (++count > (options.requestsPerMinute ?? 120)) {
      res.setHeader('retry-after', '60');
      send(res, 429, 'Request rate limit reached.');
      return;
    }
    if (active >= (options.maxActiveRequests ?? 16)) {
      send(res, 503, 'Request capacity reached.');
      return;
    }
    if (
      (req.headers['content-encoding'] &&
        req.headers['content-encoding'] !== 'identity') ||
      !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')
    ) {
      send(res, 415, 'Send uncompressed application/json.');
      return;
    }
    active++;
    const abort = new AbortController();
    let mcp: ReturnType<typeof createServer> | undefined;
    const disconnect = () => abort.abort();
    res.once('close', disconnect);
    try {
      const body = await readBody(
        req,
        options.maxBodyBytes ?? 1048576,
        options.bodyTimeoutMs ?? 5000,
      );
      assertJsonDepth(body);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      mcp = createServer(runner, abort.signal);
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      send(
        res,
        error instanceof SafeError ? (error.status ?? 400) : 500,
        error instanceof SafeError ? error.message : 'Request failed.',
      );
    } finally {
      abort.abort();
      res.off('close', disconnect);
      await mcp?.close();
      active--;
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}
