#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient } from './client.js';
import { CodeRunner } from './runner.js';
import { createServer, VERSION } from './server.js';
import { createHttpServer } from './http.js';
import { parseConfig } from './config.js';
import { safeError } from './errors.js';
const help = `tamperbox-mcp ${VERSION}
Usage: tamperbox-mcp [--transport stdio|http] [--host 127.0.0.1] [--port 3000] [--public]

Default: stdio. HTTP endpoint: /mcp; health: /health.
Non-loopback binding requires --public or TAMPERBOX_MCP_TOKEN.
Environment:
  TAMPERBOX_API_BASE_URL      HTTPS API origin (default https://api.tamperbox.dev)
  TAMPERBOX_ALLOW_LOCAL_HTTP  true permits loopback HTTP API for local testing
  TAMPERBOX_MCP_TOKEN         Optional inbound bearer token; never sent upstream
  TAMPERBOX_ALLOWED_HOSTS     Comma-separated HTTP hostnames (no ports)
  TAMPERBOX_ALLOWED_ORIGINS   Comma-separated exact browser origins
  TAMPERBOX_PUBLIC_HTTP       true explicitly permits public binding
  HOST / PORT                HTTP listening address / port
`;
try {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--help') process.stdout.write(help);
  else if (argv.length === 1 && argv[0] === '--version')
    process.stdout.write(VERSION + '\n');
  else {
    const config = parseConfig(argv, process.env);
    const runner = new CodeRunner(
      new ApiClient({
        baseUrl: config.apiBaseUrl,
        allowLocalHttp: config.allowLocalHttp,
      }),
    );
    if (config.transport === 'stdio') {
      const server = createServer(runner);
      let closing = false;
      const close = () => {
        if (closing) return;
        closing = true;
        void server.close().finally(() => process.exit(0));
      };
      // The SDK transport does not forward stdin EOF/closure to the server.
      // Closing the server aborts in-flight handlers before the process exits.
      process.stdin.once('end', close);
      process.stdin.once('close', close);
      process.once('SIGINT', close);
      process.once('SIGTERM', close);
      await server.connect(new StdioServerTransport());
    } else {
      const server = createHttpServer(runner, {
        allowedHosts: config.allowedHosts,
        allowedOrigins: config.allowedOrigins,
        bearerToken: config.bearerToken,
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      process.stderr.write(`tamperbox-mcp listening on port ${config.port}\n`);
      const close = () => {
        server.close(() => process.exit(0));
        setTimeout(() => {
          server.closeAllConnections();
          process.exit(0);
        }, 5000).unref();
      };
      process.once('SIGINT', close);
      process.once('SIGTERM', close);
    }
  }
} catch (error) {
  process.stderr.write(safeError(error).message + '\n');
  process.exitCode = 1;
}
