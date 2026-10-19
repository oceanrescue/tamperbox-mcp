import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

class InputError extends Error {}

async function readCode() {
  if (process.stdin.isTTY)
    throw new InputError('Pipe a JavaScript function body into this script.');
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 64 * 1024)
      throw new InputError('Code must not exceed 64 KiB of UTF-8 input.');
    chunks.push(chunk);
  }
  const code = Buffer.concat(chunks).toString('utf8');
  if (!code.trim())
    throw new InputError('Pipe a JavaScript function body into this script.');
  return code;
}

try {
  // EOF here finishes reading the script; the MCP connection opens afterwards.
  const code = await readCode();
  const client = new Client({ name: 'tamperbox-stdio-example', version: '1' });
  const env = {};
  for (const name of ['TAMPERBOX_API_BASE_URL', 'TAMPERBOX_ALLOW_LOCAL_HTTP'])
    if (process.env[name] !== undefined) env[name] = process.env[name];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url))],
    env,
    stderr: 'pipe',
  });
  // Drain server diagnostics without exposing configuration in startup errors.
  transport.stderr?.resume();
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'execute',
      arguments: { code },
    });
    process.stdout.write(
      JSON.stringify(result.structuredContent ?? result) + '\n',
    );
    if (result.isError) process.exitCode = 1;
  } finally {
    await client.close();
  }
} catch (error) {
  process.stderr.write(
    (error instanceof InputError
      ? error.message
      : 'Could not execute code. Check the build and server configuration.') +
      '\n',
  );
  process.exitCode = 1;
}
