// Platform-neutral logic: tests exercise the same edge and lifecycle code used by the Worker.
export const OBJECT_NAME = 'tamperbox-code-mode-v1';
const INTERNAL_ORIGIN = 'http://container:3000';
const SAFE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex',
};
class Failure extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => new Failure(status, message);
const responseError = (status, message) =>
  Response.json({ error: message }, { status, headers: SAFE_HEADERS });
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
function scope(signal, timeoutMs, status, message) {
  const controller = new AbortController();
  const abort = () => controller.abort(fail(499, 'Request cancelled.'));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(fail(status, message)),
    timeoutMs,
  );
  return {
    controller,
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}
export async function readBody(
  request,
  { maxBytes = 1048576, timeoutMs = 5000 } = {},
) {
  if (Number(request.headers.get('content-length')) > maxBytes)
    throw fail(413, 'Request exceeds 1 MiB.');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const task = scope(
    request.signal,
    timeoutMs,
    408,
    'Request body deadline exceeded.',
  );
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), task.signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw fail(413, 'Request exceeds 1 MiB.');
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error instanceof Failure
      ? error
      : fail(400, 'Request body could not be read.');
  } finally {
    task.close();
    reader.releaseLock();
  }
}
function configuration(env) {
  const publicOrigin = env.PUBLIC_ORIGIN;
  if (typeof publicOrigin !== 'string')
    throw fail(503, 'Service configuration is incomplete.');
  let publicUrl;
  try {
    publicUrl = new URL(publicOrigin);
  } catch {
    throw fail(503, 'Service configuration is incomplete.');
  }
  const local = env.LOCAL_DEVELOPMENT === 'true';
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(
    publicUrl.hostname,
  );
  if (
    publicUrl.origin !== publicOrigin ||
    publicUrl.username ||
    publicUrl.password ||
    (local
      ? publicUrl.protocol !== 'http:' || !loopback
      : publicUrl.protocol !== 'https:' || publicUrl.port)
  )
    throw fail(503, 'Service configuration is incomplete.');
  const origins = [
    publicOrigin,
    ...(env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
  ];
  for (const origin of origins) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw fail(503, 'Service configuration is incomplete.');
    }
    if (
      url.origin !== origin ||
      (origin !== publicOrigin && url.protocol !== 'https:')
    )
      throw fail(503, 'Service configuration is incomplete.');
  }
  if (
    env.MCP_TOKEN !== undefined &&
    (typeof env.MCP_TOKEN !== 'string' ||
      !env.MCP_TOKEN ||
      /[\s\u0000-\u001f\u007f]/u.test(env.MCP_TOKEN))
  )
    throw fail(503, 'Service configuration is incomplete.');
  return { publicOrigin, origins };
}
function checkRequest(request, env) {
  const config = configuration(env),
    url = new URL(request.url);
  if (url.origin !== config.publicOrigin || url.username || url.password)
    throw fail(403, 'Host is not allowed.');
  if (url.search || url.hash || !['/mcp', '/health'].includes(url.pathname))
    throw fail(404, 'Not found.');
  const origin = request.headers.get('origin');
  if (origin !== null && !config.origins.includes(origin))
    throw fail(403, 'Origin is not allowed.');
  if (
    (url.pathname === '/health' && request.method !== 'GET') ||
    (url.pathname === '/mcp' && !['POST', 'OPTIONS'].includes(request.method))
  )
    throw fail(405, 'Method is not allowed.');
  if (request.method === 'POST') {
    if (
      !/^application\/json(?:;|$)/i.test(
        request.headers.get('content-type') ?? '',
      ) ||
      !['', 'identity'].includes(request.headers.get('content-encoding') ?? '')
    )
      throw fail(415, 'Send uncompressed application/json.');
    if (Number(request.headers.get('content-length')) > 1048576)
      throw fail(413, 'Request exceeds 1 MiB.');
  }
  return { ...config, path: url.pathname, origin };
}
function requestHeaders(request) {
  const headers = new Headers();
  for (const name of [
    'content-type',
    'accept',
    'authorization',
    'origin',
    'mcp-protocol-version',
    'mcp-session-id',
    'last-event-id',
  ])
    if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  return headers;
}
async function authorized(request, token) {
  if (!token) return true;
  const digest = async (text) =>
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
    );
  const [actual, expected] = await Promise.all([
    digest(request.headers.get('authorization') ?? ''),
    digest(`Bearer ${token}`),
  ]);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
async function handleEdgeFetch(request, env) {
  try {
    const checked = checkRequest(request, env);
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          ...SAFE_HEADERS,
          ...(checked.origin
            ? { 'access-control-allow-origin': checked.origin, vary: 'Origin' }
            : {}),
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers':
            'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id',
        },
      });
    // Cloudflare replaces this header on Internet ingress. Never use forwarding headers or a caller-selected key.
    const ip = request.headers.get('cf-connecting-ip');
    if (!ip || !/^[0-9a-f:.]{3,45}$/i.test(ip))
      throw fail(403, 'Trusted client identity is required.');
    if (!env.RATE_LIMITER || !env.MCP_CONTAINER)
      throw fail(503, 'Service configuration is incomplete.');
    if (!(await env.RATE_LIMITER.limit({ key: `mcp:${ip}` })).success)
      return new Response(
        JSON.stringify({ error: 'Request rate limit reached.' }),
        {
          status: 429,
          headers: {
            ...SAFE_HEADERS,
            'content-type': 'application/json',
            'retry-after': '60',
          },
        },
      );
    if (checked.path === '/mcp' && !(await authorized(request, env.MCP_TOKEN)))
      return new Response(
        JSON.stringify({ error: 'Authentication required.' }),
        {
          status: 401,
          headers: {
            ...SAFE_HEADERS,
            'content-type': 'application/json',
            'www-authenticate': 'Bearer',
          },
        },
      );
    const body =
      request.method === 'POST' ? await readBody(request) : undefined;
    if (request.signal.aborted) throw fail(499, 'Request cancelled.');
    const forwarded = new Request(request.url, {
      method: request.method,
      headers: requestHeaders(request),
      body,
      signal: request.signal,
    });
    return await env.MCP_CONTAINER.get(
      env.MCP_CONTAINER.idFromName(OBJECT_NAME),
    ).fetch(forwarded);
  } catch (error) {
    return responseError(
      error instanceof Failure ? error.status : 503,
      error instanceof Failure
        ? error.message
        : 'Service temporarily unavailable.',
    );
  }
}
export async function edgeFetch(request, env) {
  const response = await handleEdgeFetch(request, env);
  const origin = request.headers.get('origin');
  try {
    if (origin && configuration(env).origins.includes(origin)) {
      const headers = new Headers(response.headers);
      headers.set('access-control-allow-origin', origin);
      headers.set(
        'access-control-expose-headers',
        'MCP-Protocol-Version, Retry-After, WWW-Authenticate',
      );
      headers.set('vary', 'Origin');
      return new Response(response.body, { status: response.status, headers });
    }
  } catch {}
  return response;
}
export class ContainerProxy {
  constructor(ctx, env, options = {}) {
    this.ctx = ctx;
    this.env = env;
    this.active = 0;
    this.stopping = Promise.resolve();
    this.bootRequested = false;
    this.generation = 0;
    this.options = {
      maxActive: 4,
      coldStartMs: 15000,
      requestMs: 35000,
      pollMs: 100,
      idleMs: 30000,
      maxResponseBytes: 7 * 1024 * 1024,
      ...options,
    };
  }
  async restore() {
    // A resumed DO may see the same image with stale auth/origin configuration.
    // Retire it before accepting requests; no secret fingerprint is persisted.
    if (this.ctx.container?.running) {
      this.stopping = this.ctx.container.destroy();
      await this.stopping;
    }
  }
  start() {
    const container = this.ctx.container;
    if (!container?.images?.mcp)
      throw fail(503, 'Service image is unavailable.');
    const { origins } = configuration(this.env);
    this.bootRequested = true;
    const generation = ++this.generation;
    try {
      container.start({
        image: container.images.mcp,
        instance: 'standard-1',
        enableInternet: true,
        entrypoint: [
          'node',
          '/app/dist/cli.js',
          '--transport',
          'http',
          '--host',
          '0.0.0.0',
        ],
        env: {
          TAMPERBOX_PUBLIC_HTTP: 'true',
          TAMPERBOX_ALLOWED_HOSTS: 'container',
          TAMPERBOX_ALLOWED_ORIGINS: origins.join(','),
          ...(this.env.MCP_TOKEN
            ? { TAMPERBOX_MCP_TOKEN: this.env.MCP_TOKEN }
            : {}),
        },
      });
    } catch (error) {
      this.bootRequested = false;
      throw error;
    }
    // Observe start failures without logging runtime messages that could include input.
    this.ctx.waitUntil(
      container
        .monitor()
        .catch(() => {})
        .finally(() => {
          if (generation === this.generation) this.bootRequested = false;
        }),
    );
  }
  async ready(signal) {
    await abortable(this.stopping, signal);
    signal.throwIfAborted();
    const container = this.ctx.container;
    if (!container?.running && !this.bootRequested) this.start();
    await abortable(container.setInactivityTimeout(120000), signal);
    const port = container.getTcpPort(3000);
    while (true) {
      signal.throwIfAborted();
      try {
        const ready = await abortable(
          port.fetch(`${INTERNAL_ORIGIN}/health`, { signal }),
          signal,
        );
        void ready.body?.cancel().catch(() => {});
        if (ready.status === 200) return port;
      } catch (error) {
        if (signal.aborted) throw signal.reason;
      }
      await abortable(
        new Promise((resolve) => setTimeout(resolve, this.options.pollMs)),
        signal,
      );
    }
  }
  async fetch(request) {
    let checked;
    try {
      checked = checkRequest(request, this.env);
    } catch (error) {
      return responseError(error.status ?? 503, error.message);
    }
    if (this.active >= this.options.maxActive)
      return responseError(503, 'Execution capacity reached; retry later.');
    this.active++;
    const lifetime = scope(
      request.signal,
      this.options.coldStartMs + this.options.requestMs,
      504,
      'Request deadline exceeded.',
    );
    let released = false,
      reader;
    const release = () => {
      if (released) return;
      released = true;
      lifetime.close();
      this.active--;
      this.ctx.waitUntil(this.scheduleIdle());
    };
    const abort = () => {
      void reader?.cancel().catch(() => {});
      release();
    };
    lifetime.signal.addEventListener('abort', abort, { once: true });
    let streamReturned = false;
    try {
      lifetime.signal.throwIfAborted();
      await this.ctx.storage.deleteAlarm();
      const body =
        request.method === 'POST' ? await readBody(request) : undefined;
      const startup = scope(
        lifetime.signal,
        this.options.coldStartMs,
        503,
        'Service is starting; retry later.',
      );
      let port;
      try {
        port = await this.ready(startup.signal);
      } finally {
        startup.close();
      }
      const submitted = scope(
        lifetime.signal,
        this.options.requestMs,
        504,
        'Request deadline exceeded.',
      );
      let response;
      try {
        submitted.signal.throwIfAborted();
        response = await abortable(
          port.fetch(`${INTERNAL_ORIGIN}${checked.path}`, {
            method: request.method,
            headers: requestHeaders(request),
            body,
            signal: submitted.signal,
          }),
          submitted.signal,
        );
      } catch (error) {
        submitted.close();
        throw error instanceof Failure
          ? error
          : fail(502, 'Service request failed.');
      }
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(SAFE_HEADERS))
        headers.set(name, value);
      headers.delete('set-cookie');
      let completed = false,
        outputController;
      const finish = () => {
        if (completed) return;
        completed = true;
        submitted.close();
        submitted.signal.removeEventListener('abort', interrupted);
        lifetime.signal.removeEventListener('abort', abort);
        release();
      };
      const interrupted = () => {
        if (completed) return;
        outputController?.error(new Error('Service response interrupted.'));
        void reader?.cancel().catch(() => {});
        finish();
      };
      if (!response.body) {
        finish();
        return new Response(null, { status: response.status, headers });
      }
      reader = response.body.getReader();
      let size = 0;
      const responseReader = reader;
      const maxResponseBytes = this.options.maxResponseBytes;
      const bodyStream = new ReadableStream({
        start(controller) {
          outputController = controller;
          submitted.signal.addEventListener('abort', interrupted, {
            once: true,
          });
          if (submitted.signal.aborted) interrupted();
        },
        async pull(controller) {
          try {
            const { done, value } = await abortable(
              responseReader.read(),
              submitted.signal,
            );
            if (completed) return;
            if (done) {
              controller.close();
              finish();
              return;
            }
            size += value.byteLength;
            if (size > maxResponseBytes)
              throw fail(502, 'Service response exceeds the limit.');
            controller.enqueue(value);
          } catch {
            if (!completed) submitted.controller.abort();
          }
        },
        cancel() {
          finish();
          submitted.controller.abort();
          void responseReader.cancel().catch(() => {});
        },
      });
      streamReturned = true;
      return new Response(bodyStream, { status: response.status, headers });
    } catch (error) {
      return responseError(
        error instanceof Failure ? error.status : 503,
        error instanceof Failure
          ? error.message
          : 'Service temporarily unavailable.',
      );
    } finally {
      if (!streamReturned) {
        lifetime.signal.removeEventListener('abort', abort);
        release();
      }
    }
  }
  async scheduleIdle() {
    try {
      await this.ctx.storage.setAlarm(Date.now() + this.options.idleMs);
    } catch {
      // monitor() can keep the DO active, so an alarm failure must not silently
      // leave a container running. Other active requests finish first.
      if (
        this.active === 0 &&
        (this.ctx.container?.running || this.bootRequested)
      ) {
        this.stopping = this.ctx.container
          .destroy()
          .then(() => {
            this.bootRequested = false;
          })
          .catch(() => {
            if (this.ctx.container.running) this.ctx.container.signal(9);
          });
        await this.stopping;
      }
    }
  }
  async alarm() {
    if (this.active) {
      await this.ctx.storage.setAlarm(Date.now() + this.options.idleMs);
      return;
    }
    if (this.ctx.container?.running || this.bootRequested) {
      this.stopping = this.ctx.container
        .destroy()
        .then(() => {
          this.bootRequested = false;
        })
        .catch(() =>
          this.ctx.storage.setAlarm(Date.now() + this.options.idleMs),
        );
      await this.stopping;
    }
  }
}
