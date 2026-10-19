import test from 'node:test';
import assert from 'node:assert/strict';
import { podmanArgs } from '../wrangler-podman.mjs';

test('Wrangler builds retain target architecture, tag and context without Docker-only flags', () => {
  assert.deepEqual(
    podmanArgs([
      'build',
      '--load',
      '-t',
      'probe:test',
      '--platform',
      'linux/amd64',
      '--provenance=false',
      '-f',
      '-',
      '.',
    ]),
    [
      'build',
      '--format=docker',
      '-t',
      'probe:test',
      '--platform',
      'linux/amd64',
      '-f',
      '-',
      '.',
    ],
  );
});
test('non-build operations and build argument values pass through unchanged', () => {
  for (const args of [
    ['version'],
    ['login', '--password-stdin', 'registry.example'],
    ['push', 'probe:test'],
  ])
    assert.deepEqual(podmanArgs(args), args);
  assert.deepEqual(podmanArgs(['build', '--build-arg', '--load', '.']), [
    'build',
    '--format=docker',
    '--build-arg',
    '--load',
    '.',
  ]);
  assert.ok(
    podmanArgs(['build', '--provenance=true', '.']).includes(
      '--provenance=true',
    ),
    'do not silently discard requested attestations',
  );
});

import { runAdapter } from '../wrangler-podman.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Wrangler receives verified push digest, never the local manifest digest', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'podman-adapter-test-'));
  const tag = 'registry.cloudflare.com/account/probe:release';
  const digest = 'sha256:' + 'a'.repeat(64),
    calls = [],
    output = [];
  const run = (_, args) => {
    calls.push(args);
    if (args[0] === 'push') writeFileSync(args[2], digest);
    return { status: 0 };
  };
  const options = { stateDir, run, output: (s) => output.push(s) };
  const inspect = (name) => [
    'image',
    'inspect',
    name,
    '--format',
    '{{ json .RepoDigests }}',
  ];
  try {
    runAdapter(inspect('probe:local'), options);
    assert.equal(output.pop(), '[]');
    assert.equal(calls.length, 0);
    assert.throws(
      () => runAdapter(inspect(tag), options),
      /No verified push digest/,
    );
    assert.equal(runAdapter(['push', tag], options), 0);
    assert.deepEqual(calls[1], [
      'manifest',
      'inspect',
      'registry.cloudflare.com/account/probe@' + digest,
    ]);
    runAdapter(inspect(tag), options);
    assert.deepEqual(JSON.parse(output.pop()), [
      'registry.cloudflare.com/account/probe@' + digest,
    ]);
    assert.equal(
      runAdapter(['push', tag], { ...options, run: () => ({ status: 125 }) }),
      125,
    );
    assert.throws(
      () => runAdapter(inspect(tag), options),
      /No verified push digest/,
      'failed replacement must invalidate old digest',
    );
    assert.throws(
      () =>
        runAdapter(['push', tag], {
          ...options,
          run: (_, args) => {
            if (args[0] === 'push') {
              writeFileSync(args[2], digest);
              return { status: 0 };
            }
            return { status: 1 };
          },
        }),
      /could not be read/,
    );
    assert.throws(
      () => runAdapter(inspect(tag), options),
      /No verified push digest/,
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
