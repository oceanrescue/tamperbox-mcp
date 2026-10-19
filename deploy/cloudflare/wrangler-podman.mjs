#!/usr/bin/env node
// Compatibility adapter for Wrangler 4.x's Docker build command and Podman 5.x.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export function podmanArgs(args) {
  if (args[0] !== 'build') return args;
  const result = ['build', '--format=docker'];
  const takesValue = new Set([
    '-t',
    '--tag',
    '--platform',
    '--build-arg',
    '-f',
    '--file',
    '--network',
    '--label',
    '--secret',
    '--target',
  ]);
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    // Podman stores builds locally already; Wrangler disables provenance itself.
    if (arg === '--load' || arg === '--provenance=false') continue;
    result.push(arg);
    if (takesValue.has(arg) && i + 1 < args.length) result.push(args[++i]);
  }
  return result;
}

// Podman's local RepoDigests can describe the uncompressed local manifest, not
// the manifest uploaded to the registry. Never let Wrangler deploy that digest.
export function runAdapter(
  input,
  {
    binary = process.env.PODMAN_BIN || 'podman',
    stateDir = fileURLToPath(
      new URL('./.artifacts/podman-push-digests', import.meta.url),
    ),
    run = spawnSync,
    output = console.log,
  } = {},
) {
  const invoke = (args, options = {}) =>
    run(binary, args, { stdio: 'inherit', ...options });
  const stateFile = (tag) =>
    resolve(stateDir, createHash('sha256').update(tag).digest('hex') + '.json');
  const args = podmanArgs(input);
  if (
    args[0] === 'push' &&
    args.length === 2 &&
    args[1].startsWith('registry.cloudflare.com/')
  ) {
    const tag = args[1];
    mkdirSync(stateDir, { recursive: true });
    rmSync(stateFile(tag), { force: true });
    const temp = mkdtempSync(resolve(tmpdir(), 'wrangler-podman-'));
    try {
      const digestFile = resolve(temp, 'digest');
      const result = invoke(['push', '--digestfile', digestFile, tag]);
      if (result.error) throw result.error;
      if (result.status !== 0) return result.status ?? 1;
      const digest = readFileSync(digestFile, 'utf8').trim();
      if (!/^sha256:[a-f0-9]{64}$/.test(digest))
        throw Error('Podman push returned an invalid registry digest.');
      // Verify the exact digest remotely before reporting success to Wrangler.
      const repository = tag.replace(/:[^/:]+$/, '');
      const ref = repository + '@' + digest;
      const verify = invoke(['manifest', 'inspect', ref], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      if (verify.error) throw verify.error;
      if (verify.status !== 0)
        throw Error(
          'Pushed image digest could not be read from the registry; refusing deployment.',
        );
      const pending = stateFile(tag) + '.' + process.pid;
      writeFileSync(pending, JSON.stringify({ tag, ref }));
      renameSync(pending, stateFile(tag));
      return 0;
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  if (
    args[0] === 'image' &&
    args[1] === 'inspect' &&
    args.length === 5 &&
    args[3] === '--format' &&
    args[4].replace(/\s/g, '') === '{{json.RepoDigests}}'
  ) {
    const tag = args[2];
    // For local build tags, force a push. Local digest cache cannot establish
    // registry presence. After push, return only the verified destination digest.
    if (!tag.startsWith('registry.cloudflare.com/')) {
      output('[]');
      return 0;
    }
    let saved;
    try {
      saved = JSON.parse(readFileSync(stateFile(tag), 'utf8'));
    } catch {}
    if (
      !saved ||
      saved.tag !== tag ||
      !saved.ref?.startsWith(tag.replace(/:[^/:]+$/, '') + '@sha256:')
    ) {
      throw Error(
        'No verified push digest for this image. Push it through the adapter first.',
      );
    }
    output(JSON.stringify([saved.ref]));
    return 0;
  }
  if (args[0] === 'build') {
    // Wrangler sends the Dockerfile on stdin, so select its exclusions explicitly.
    const ignore = fileURLToPath(
      new URL('../../.dockerignore', import.meta.url),
    );
    if (!existsSync(ignore))
      throw Error('The MCP root .dockerignore is required.');
    args.splice(1, 0, '--ignorefile', ignore);
  }
  const result = invoke(args);
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.exitCode = runAdapter(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
