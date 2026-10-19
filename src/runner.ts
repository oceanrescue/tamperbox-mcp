import { assertJsonDepth } from './json.js';
import { Worker } from 'node:worker_threads';
import { SafeError, safeError, type ErrorDetails } from './errors.js';
import { spec, operations, validateRequest, requestOperation } from './spec.js';
import type { Caller, RequestCaller } from './client.js';
export interface RunnerOptions {
  maxCalls?: number;
  maxConcurrent?: number;
  maxParallelCalls?: number;
}
export interface ExecutionOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface ExecutionResult {
  result: unknown;
  /** Bridge calls attempted, including host-validation failures; not upstream HTTP requests. */
  apiCalls: number;
}
/** Host-side broker. No API URLs, secrets or Node capabilities enter the guest VM. */
export class CodeRunner {
  private active = 0;
  constructor(
    private readonly client: Caller | RequestCaller,
    private readonly options: RunnerOptions = {},
  ) {}
  async execute(
    code: string,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult> {
    return this.run(code, options, false);
  }
  async search(
    code: string,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult> {
    return this.run(code, options, true);
  }
  private async run(
    code: string,
    { timeoutMs = 15000, signal }: ExecutionOptions,
    search: boolean,
  ): Promise<ExecutionResult> {
    if (typeof code !== 'string' || Buffer.byteLength(code) > 65536)
      throw new SafeError(
        'code_size',
        'Code must be a string of at most 64 KiB.',
      );
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
      throw new SafeError(
        'invalid_timeout',
        'Timeout must be between 1 and 30000 milliseconds.',
      );
    if (signal?.aborted)
      throw new SafeError('cancelled', 'Execution cancelled.');
    if (this.active >= (this.options.maxConcurrent ?? 4))
      throw new SafeError('busy', 'Execution capacity reached; retry later.');
    this.active++;
    const abort = new AbortController();
    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL('./sandbox-worker.js', import.meta.url), {
        workerData: {
          code,
          timeoutMs,
          ...(search ? { discovery: { spec, operations } } : {}),
        },
        resourceLimits: {
          maxOldGenerationSizeMb: 64,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
        stdout: true,
        stderr: true,
        env: {},
        execArgv: [],
      });
      const current = worker;
      // Drain any runtime diagnostics without logging user data.
      current.stdout?.resume();
      current.stderr?.resume();
      return await new Promise<ExecutionResult>((resolve, reject) => {
        let settled = false,
          calls = 0,
          inFlight = 0;
        const queue: Array<() => void> = [];
        const dispatch = () => {
          while (
            !settled &&
            inFlight < (this.options.maxParallelCalls ?? 4) &&
            queue.length
          ) {
            inFlight++;
            queue.shift()!();
          }
        };
        const finish = (error?: SafeError, result?: unknown) => {
          if (settled) return;
          settled = true;
          queue.length = 0;
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          abort.abort();
          if (error) reject(error);
          else resolve({ result, apiCalls: calls });
        };
        const cancel = () =>
          finish(new SafeError('cancelled', 'Execution cancelled.'));
        const timer = setTimeout(
          () =>
            finish(
              new SafeError(
                'execution_timeout',
                'Code exceeded its execution deadline.',
              ),
            ),
          timeoutMs,
        );
        signal?.addEventListener('abort', cancel, { once: true });
        current.on('error', () =>
          finish(
            new SafeError(
              'sandbox_failure',
              'Sandbox terminated unexpectedly.',
            ),
          ),
        );
        current.on('exit', () => {
          if (!settled)
            finish(
              new SafeError(
                'sandbox_failure',
                'Sandbox terminated unexpectedly.',
              ),
            );
        });
        current.on(
          'message',
          (message: {
            type: string;
            id: number;
            name: string;
            args: string;
            json: string;
            code?: string;
            details?: ErrorDetails;
          }) => {
            if (settled) return;
            if (message.type === 'result') {
              try {
                const value: unknown = JSON.parse(message.json);
                assertJsonDepth(value);
                finish(undefined, value);
              } catch (error) {
                finish(
                  error instanceof SafeError
                    ? error
                    : new SafeError(
                        'sandbox_failure',
                        'Sandbox returned invalid data.',
                      ),
                );
              }
              return;
            }
            if (message.type === 'error') {
              finish(
                new SafeError(
                  message.code === 'output_size'
                    ? 'output_size'
                    : message.code === 'execution_timeout'
                      ? 'execution_timeout'
                      : 'execution_error',
                  message.code === 'output_size'
                    ? 'Code result exceeds 2 MiB.'
                    : message.code === 'execution_timeout'
                      ? 'Code exceeded its execution deadline.'
                      : message.details
                        ? 'Guest code failed. See diagnostic details.'
                        : 'Guest code failed; diagnostic details are unavailable.',
                  undefined,
                  message.details,
                ),
              );
              return;
            }
            if (message.type !== 'call') {
              finish(
                new SafeError(
                  'sandbox_failure',
                  'Sandbox returned an invalid message.',
                ),
              );
              return;
            }
            if (search) {
              finish(
                new SafeError(
                  'sandbox_failure',
                  'Search cannot make API requests.',
                ),
              );
              return;
            }
            if (++calls > (this.options.maxCalls ?? 20)) {
              finish(
                new SafeError(
                  'call_limit',
                  'Code exceeded its API call limit.',
                ),
              );
              return;
            }
            queue.push(() => {
              void (async () => {
                let operation = 'request';
                try {
                  if (Buffer.byteLength(message.args) > 1048576)
                    throw new SafeError(
                      'input_size',
                      'API arguments exceed 1 MiB.',
                    );
                  const args: unknown = JSON.parse(message.args);
                  if (message.name !== 'request')
                    throw new SafeError(
                      'unknown_operation',
                      'Use tamperbox.request.',
                    );
                  operation = requestOperation(args);
                  const resolved = validateRequest(args);
                  operation = resolved.operation.operationId;
                  const value =
                    'request' in this.client
                      ? await this.client.request(
                          resolved.request,
                          abort.signal,
                        )
                      : await this.client.call(
                          operation,
                          resolved.request.body ?? {
                            ...resolved.pathArgs,
                            ...resolved.request.query,
                          },
                          abort.signal,
                        );
                  const json = JSON.stringify(value);
                  if (json === undefined || Buffer.byteLength(json) > 2097152)
                    throw new SafeError(
                      'output_size',
                      'API result exceeds 2 MiB.',
                    );
                  if (!settled) current.postMessage({ id: message.id, json });
                } catch (error) {
                  if (!settled) {
                    const safe = safeError(error);
                    current.postMessage({
                      id: message.id,
                      error: {
                        code: safe.code,
                        message: safe.message,
                        operation,
                        status: safe.status,
                        details: safe.details,
                      },
                    });
                  }
                } finally {
                  inFlight--;
                  dispatch();
                }
              })();
            });
            dispatch();
          },
        );
      });
    } finally {
      abort.abort();
      await worker?.terminate();
      this.active--;
    }
  }
}
