import { apiOrigin } from './client.js';
import { SafeError } from './errors.js';
function invalid(): never {
  throw new SafeError(
    'configuration',
    'Invalid configuration. Run tamperbox-mcp --help.',
  );
}
function bool(value: string | undefined): boolean {
  if (value !== undefined && !['true', 'false'].includes(value)) invalid();
  return value === 'true';
}
export function parseConfig(argv: string[], env: NodeJS.ProcessEnv) {
  const values: Record<string, string> = {};
  let publicHttp = bool(env.TAMPERBOX_PUBLIC_HTTP);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--public') {
      publicHttp = true;
      continue;
    }
    if (
      !['--transport', '--host', '--port'].includes(flag) ||
      !argv[i + 1] ||
      argv[i + 1]!.startsWith('--') ||
      values[flag] !== undefined
    )
      invalid();
    values[flag] = argv[++i]!;
  }
  const transport = values['--transport'] ?? 'stdio';
  if (!['stdio', 'http'].includes(transport)) invalid();
  const host = values['--host'] ?? env.HOST ?? '127.0.0.1';
  if (!/^(?:[a-zA-Z0-9.-]+|::1|::)$/.test(host)) invalid();
  const portText = values['--port'] ?? env.PORT ?? '3000';
  if (!/^\d+$/.test(portText)) invalid();
  const port = Number(portText);
  if (port < 1 || port > 65535) invalid();
  const bearerToken = env.TAMPERBOX_MCP_TOKEN || undefined;
  if (bearerToken && /[\s\u0000-\u001f\u007f]/u.test(bearerToken)) invalid();
  if (
    !['localhost', '127.0.0.1', '::1'].includes(host) &&
    !publicHttp &&
    !bearerToken
  )
    throw new SafeError(
      'configuration',
      'Non-loopback binding requires --public or TAMPERBOX_MCP_TOKEN.',
    );
  const allowedOrigins = (env.TAMPERBOX_ALLOWED_ORIGINS ?? '')
    .split(',')
    .filter(Boolean)
    .map((value) => {
      try {
        const url = new URL(value);
        if (
          url.origin !== value ||
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password
        )
          invalid();
        return value;
      } catch {
        invalid();
      }
    });
  const allowedHosts = (
    env.TAMPERBOX_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1]'
  ).split(',');
  if (
    allowedHosts.some(
      (value) => !value || !/^(?:[a-zA-Z0-9.-]+|\[::1\])$/.test(value),
    )
  )
    invalid();
  const allowLocalHttp = bool(env.TAMPERBOX_ALLOW_LOCAL_HTTP);
  let apiBaseUrl: string;
  try {
    apiBaseUrl = apiOrigin(env.TAMPERBOX_API_BASE_URL, allowLocalHttp);
  } catch {
    invalid();
  }
  return {
    transport,
    host,
    port,
    publicHttp,
    bearerToken,
    allowedHosts,
    allowedOrigins,
    allowLocalHttp,
    apiBaseUrl,
  };
}
