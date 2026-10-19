/** Host errors exclude inputs, credentials and upstream bodies. Guest diagnostics are caller-visible. */
export interface ErrorDetails {
  name?: string;
  message?: string;
  line?: number;
  operation?: string;
  validation?: Array<{ path: string; keyword: string; message: string }>;
}
export class SafeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = 'SafeError';
  }
}
export function safeError(error: unknown): SafeError {
  return error instanceof SafeError
    ? error
    : new SafeError('internal', 'Operation failed.');
}
