// Run the local-only Wrangler config through a private, short-lived Unix socket.
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createPodmanApi } from './podman-api.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const podman = process.env.PODMAN_BIN || 'podman';
const run = (args) => execFileSync(podman, args, { encoding: 'utf8' }).trim();
let temporary, api, child;
try {
  const info = JSON.parse(run(['info', '--format', 'json']));
  const configured =
    process.env.WRANGLER_DOCKER_HOST || process.env.DOCKER_HOST;
  const upstream =
    configured ||
    `unix://${run(['machine', 'inspect', '--format', '{{.ConnectionInfo.PodmanSocket.Path}}'])}`;
  if (!upstream.startsWith('unix:///'))
    throw new Error(
      'Podman local development requires a local unix:/// API socket.',
    );
  temporary = mkdtempSync(join(tmpdir(), 'tb-podman-'));
  const socket = join(temporary, 'api.sock');
  api = createPodmanApi({
    socketPath: upstream.slice('unix://'.length),
    cgroupV2: info.host.cgroupVersion === 'v2',
  });
  api.server.listen(socket);
  await once(api.server, 'listening');
  chmodSync(socket, 0o600);
  console.log(
    'Starting local Wrangler with the Podman API compatibility adapter.',
  );
  child = spawn(
    process.execPath,
    [
      join(directory, 'node_modules/wrangler/bin/wrangler.js'),
      'dev',
      '--config',
      'wrangler.local.jsonc',
      '--local',
      '--port',
      '8787',
    ],
    {
      cwd: directory,
      stdio: 'inherit',
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_DOCKER_BIN: join(directory, 'wrangler-podman.mjs'),
        WRANGLER_DOCKER_HOST: `unix://${socket}`,
      },
    },
  );
  const stop = (signal) => child.kill(signal);
  const interrupt = () => stop('SIGINT');
  const terminate = () => stop('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  const [code, signal] = await once(child, 'exit');
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await api?.close();
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
