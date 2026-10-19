import { assertJsonDepth } from './json.js';
import { validateInput, validateOutput } from './catalog.js';
import { SafeError } from './errors.js';
import { validateRequest, type ApiRequest } from './spec.js';
export interface Caller {
  call(name: string, args: unknown, signal?: AbortSignal): Promise<unknown>;
}
export interface RequestCaller {
  request(request: ApiRequest, signal?: AbortSignal): Promise<unknown>;
}
export interface ClientOptions {
  baseUrl?: string;
  allowLocalHttp?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
export function apiOrigin(
  value = 'https://api.tamperbox.dev',
  allowLocalHttp = false,
): string {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' &&
      !(allowLocalHttp && local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new SafeError(
      'configuration',
      'API URL must be an HTTPS origin; loopback HTTP requires explicit opt-in.',
    );
  return url.origin;
}
export class ApiClient implements Caller, RequestCaller {
  private readonly origin: string;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: ClientOptions = {}) {
    this.origin = apiOrigin(options.baseUrl, options.allowLocalHttp);
    this.fetcher = options.fetch ?? fetch;
  }
  /** @deprecated Legacy library facade. Use request() for the complete documented API. */
  async call(
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    assertJsonDepth(args);
    const op = validateInput(name, args);
    const body = JSON.stringify(args);
    if (Buffer.byteLength(body) > 1048576)
      throw new SafeError('input_size', 'API arguments exceed 1 MiB.');
    let url = this.origin + op.path;
    if (name === 'find')
      url +=
        '?' + new URLSearchParams(args as Record<string, string>).toString();
    return this.send(
      url,
      op.method,
      op.method === 'POST' ? body : undefined,
      signal,
      (_status, result) => validateOutput(name, result),
    );
  }
  async request(request: ApiRequest, signal?: AbortSignal): Promise<unknown> {
    const resolved = validateRequest(request);
    if (Buffer.byteLength(JSON.stringify(request)) > 1048576)
      throw new SafeError('input_size', 'API arguments exceed 1 MiB.');
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query ?? {}))
      query.set(key, String(value));
    const url =
      this.origin + request.path + (query.size ? '?' + query.toString() : '');
    return this.send(
      url,
      request.method,
      request.body === undefined ? undefined : JSON.stringify(request.body),
      signal,
      resolved.validateResponse,
    );
  }
  private async send(
    url: string,
    method: string,
    body: string | undefined,
    signal: AbortSignal | undefined,
    validate: (status: number, result: unknown) => void,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      combined.throwIfAborted();
      response = await this.fetcher(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body } : {}),
        redirect: 'error',
        signal: combined,
      });
    } catch {
      throw new SafeError(
        combined.aborted ? 'upstream_timeout' : 'upstream_network',
        combined.aborted
          ? 'Tamperbox API request was cancelled or timed out.'
          : 'Tamperbox API request failed.',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SafeError(
        'upstream_http',
        `Tamperbox API returned HTTP ${response.status}.`,
        response.status,
      );
    }
    const max = this.options.maxResponseBytes ?? 2097152;
    if (
      !/^application\/json(?:;|$)/i.test(
        response.headers.get('content-type') ?? '',
      ) ||
      Number(response.headers.get('content-length')) > max
    ) {
      await response.body?.cancel();
      throw new SafeError(
        'upstream_response',
        'Tamperbox API returned an unsupported or oversized response.',
      );
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new SafeError(
        'upstream_response',
        'Tamperbox API returned an empty response.',
      );
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
          await reader.cancel();
          throw new SafeError(
            'output_size',
            'API response exceeds the configured byte limit.',
          );
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof SafeError) throw error;
      throw new SafeError(
        'upstream_response',
        'Tamperbox API response could not be read.',
      );
    } finally {
      reader.releaseLock();
    }
    let result: unknown;
    try {
      result = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      throw new SafeError(
        'upstream_json',
        'Tamperbox API returned invalid JSON.',
      );
    }
    assertJsonDepth(result);
    validate(response.status, result);
    return result;
  }
}
