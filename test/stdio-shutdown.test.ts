import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

async function within<T>(promise: Promise<T>, milliseconds = 1500): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`No completion within ${milliseconds} ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

async function checkShutdown(
  stop: (child: ChildProcessWithoutNullStreams) => void,
  workers: number,
  stalled = false,
) {
  let received = 0;
  let disconnected = 0;
  let ready!: () => void;
  let disconnectedAll!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const socketsClosed = new Promise<void>((resolve) => {
    disconnectedAll = resolve;
  });
  const upstream = createServer((_req, res) => {
    received++;
    if (stalled) {
      res.once('close', () => {
        if (++disconnected === workers) disconnectedAll();
      });
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ tools: [], provenance: {} }));
    }
    if (received === workers) ready();
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(0, '127.0.0.1', resolve);
  });
  const child = spawn(process.execPath, [cli], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      TAMPERBOX_API_BASE_URL: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`,
      TAMPERBOX_ALLOW_LOCAL_HTTP: 'true',
    },
  });
  const exited = once(child, 'exit');
  const closed = once(child, 'close');
  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  const lines = createInterface({ input: child.stdout });
  const send = (message: object) =>
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  try {
    const initialized = once(lines, 'line');
    send({
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'shutdown-regression', version: '1' },
      },
    });
    expect(JSON.parse((await within(initialized, 3000))[0]).id).toBe(0);
    send({ method: 'notifications/initialized' });
    if (stalled) {
      send({
        id: 1,
        method: 'tools/call',
        params: {
          name: 'execute',
          arguments: {
            timeoutMs: 30000,
            code: 'return await Promise.all(Array.from({length:12},()=>tamperbox.request({method:"GET",path:"/v1/find",query:{}})));',
          },
        },
      });
    } else {
      for (let i = 0; i < workers; i++) {
        send({
          id: i + 1,
          method: 'tools/call',
          params: {
            name: 'execute',
            arguments: {
              timeoutMs: 30000,
              code: 'void tamperbox.request({method:"GET",path:"/v1/find",query:{}}); while(true){}',
            },
          },
        });
      }
    }
    // Each busy guest posts a bridge call immediately before its loop. Seeing
    // all requests proves executions are running before the client disconnects.
    if (workers) await within(started, 3000);
    stop(child);
    expect(await within(exited)).toEqual([0, null]);
    await within(closed);
    if (stalled) await within(socketsClosed);
    expect(received).toBe(workers);
    expect(stderr).toBe('');
    for (const line of stdout.trim().split('\n'))
      expect(JSON.parse(line).jsonrpc).toBe('2.0');
  } finally {
    // The unfixed server would otherwise leave 30-second CPU loops behind.
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
    await closed;
    lines.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
}

it.each([1, 4])(
  'exits promptly when stdin ends with %i busy guests',
  async (workers) => {
    await checkShutdown((child) => child.stdin.end(), workers);
  },
);

it('exits promptly when the client destroys its stdin pipe during execution', async () => {
  await checkShutdown((child) => child.stdin.destroy(), 1);
});

it('disconnects pending upstream requests without starting queued calls on EOF', async () => {
  await checkShutdown((child) => child.stdin.end(), 4, true);
});

it('continues to exit cleanly on idle EOF', async () => {
  await checkShutdown((child) => child.stdin.end(), 0);
});

// Windows child.kill() forcibly terminates the process instead of delivering
// these POSIX signals to its JavaScript handlers. EOF cases run on every OS.
it.skipIf(process.platform === 'win32').each(['SIGINT', 'SIGTERM'] as const)(
  'continues to stop busy execution on %s',
  async (signal) => {
    await checkShutdown((child) => {
      child.kill(signal);
    }, 1);
  },
);
