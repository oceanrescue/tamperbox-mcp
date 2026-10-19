import { Ajv, type AnySchema, type ValidateFunction } from 'ajv';
import bundled from './openapi.json' with { type: 'json' };
import { SafeError } from './errors.js';
import { assertJsonDepth } from './json.js';

type JsonObject = Record<string, any>;
export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, JsonObject>;
  components?: JsonObject;
  [key: string]: unknown;
}
export interface ApiRequest {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
}
export interface ApiOperation {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  tags: string[];
  websiteToolIds: string[];
  inputSchema: AnySchema;
  outputSchema: AnySchema;
  parameters: unknown[];
  requestBody?: unknown;
  responses: unknown;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const spec: Readonly<OpenApiDocument> = freeze(bundled);
const ajv = new Ajv({ strict: false, allErrors: false, ownProperties: true });
/** Resolve only bundled references: discovery must never fetch URLs. */
function resolve(value: any, ancestors = new Set<string>()): any {
  if (Array.isArray(value)) return value.map((v) => resolve(v, ancestors));
  if (!value || typeof value !== 'object') return value;
  if (typeof value.$ref === 'string') {
    const ref = value.$ref;
    if (!ref.startsWith('#/') || ancestors.has(ref))
      throw new Error('Unsupported API contract reference.');
    let target: any = spec;
    for (const part of ref.slice(2).split('/')) {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!target || !Object.hasOwn(target, key))
        throw new Error('Invalid API contract reference.');
      target = target[key];
    }
    const next = new Set(ancestors);
    next.add(ref);
    const { $ref: _, ...siblings } = value;
    return { ...resolve(target, next), ...resolve(siblings, ancestors) };
  }
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, resolve(v, ancestors)]),
  );
}
const object = (properties: JsonObject, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const compiled: Array<{
  op: ApiOperation;
  match: RegExp;
  pathNames: string[];
  input: ValidateFunction;
  pathInput: ValidateFunction;
  outputs: Map<string, ValidateFunction>;
}> = [];
export const operations: readonly ApiOperation[] = freeze(
  Object.entries(spec.paths).flatMap(([path, rawItem]) => {
    const item = resolve(rawItem) as JsonObject;
    return Object.entries(item)
      .filter(([method]) =>
        ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(
          method,
        ),
      )
      .map(([method, raw]) => {
        const rawOp = raw as JsonObject;
        if (typeof rawOp.operationId !== 'string')
          throw new Error('API operation requires operationId.');
        const parameters = [
          ...(item.parameters ?? []),
          ...(rawOp.parameters ?? []),
        ] as JsonObject[];
        const query: JsonObject = {},
          pathProperties: JsonObject = {};
        const requiredQuery: string[] = [],
          requiredPath: string[] = [];
        for (const p of parameters) {
          if (!['query', 'path'].includes(p.in))
            throw new Error('Unsupported API parameter location.');
          const props = p.in === 'query' ? query : pathProperties;
          props[p.name] = p.schema;
          if (p.required)
            (p.in === 'query' ? requiredQuery : requiredPath).push(p.name);
        }
        const body = rawOp.requestBody?.content?.['application/json']?.schema;
        if (rawOp.requestBody && !body)
          throw new Error('API request must use JSON.');
        const required = ['method', 'path'];
        if (requiredQuery.length) required.push('query');
        if (rawOp.requestBody?.required) required.push('body');
        const inputSchema = object(
          {
            method: { const: method.toUpperCase() },
            path: { type: 'string' },
            query: object(query, requiredQuery),
            ...(body ? { body } : {}),
          },
          required,
        );
        const outputs = new Map<string, ValidateFunction>();
        for (const [status, response] of Object.entries(
          rawOp.responses ?? {},
        ) as Array<[string, JsonObject]>) {
          if (/^2\d\d$/.test(status) || status === '2XX') {
            const schema = response.content?.['application/json']?.schema;
            if (!schema)
              throw new Error('API success response must describe JSON.');
            outputs.set(status, ajv.compile(schema));
          }
        }
        if (!outputs.size)
          throw new Error('API operation must describe successful responses.');
        const op: ApiOperation = {
          operationId: rawOp.operationId,
          method: method.toUpperCase(),
          path,
          summary: rawOp.summary ?? '',
          description: rawOp.description ?? '',
          tags: rawOp.tags ?? [],
          websiteToolIds: rawOp['x-tamperbox-website-tool-ids'] ?? [],
          inputSchema,
          outputSchema:
            rawOp.responses['200']?.content?.['application/json']?.schema ?? {},
          parameters,
          requestBody: rawOp.requestBody,
          responses: rawOp.responses,
        };
        const pathNames: string[] = [];
        const pattern = path
          .split('/')
          .map((segment) => {
            const parameter = /^\{([A-Za-z][\w]*)\}$/.exec(segment);
            if (parameter) {
              pathNames.push(parameter[1]!);
              return '([^/]+)';
            }
            return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('/');
        compiled.push({
          op,
          match: new RegExp(`^${pattern}$`),
          pathNames,
          input: ajv.compile(inputSchema),
          pathInput: ajv.compile(object(pathProperties, requiredPath)),
          outputs,
        });
        return op;
      });
  }),
);
if (new Set(operations.map((op) => op.operationId)).size !== operations.length)
  throw new Error('Duplicate API operation IDs.');
function invalid(validator?: ValidateFunction): never {
  const validation = (validator?.errors ?? []).slice(0, 1).map((error) => ({
    path: error.instancePath.slice(0, 256),
    keyword: error.keyword,
    message: (error.message ?? 'Invalid value.').slice(0, 256),
  }));
  const first = validation[0];
  throw new SafeError(
    'invalid_arguments',
    first
      ? `Invalid arguments: ${first.path || '/'} ${first.message}.`
      : 'Expected a documented method, path, optional query, and JSON body.',
    undefined,
    validation.length ? { validation } : undefined,
  );
}
export function requestOperation(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'request';
  const request = value as ApiRequest;
  if (typeof request.method !== 'string' || typeof request.path !== 'string')
    return 'request';
  return (
    compiled.find(
      (entry) =>
        entry.op.method === request.method && entry.match.test(request.path),
    )?.op.operationId ?? 'request'
  );
}
export function validateRequest(value: unknown) {
  assertJsonDepth(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const request = value as ApiRequest;
  if (typeof request.method !== 'string' || typeof request.path !== 'string')
    invalid();
  // Paths are selected from the bundled API, never normalized or used as URLs.
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(request.path)) invalid();
  const entry = compiled.find(
    (e) => e.op.method === request.method && e.match.test(request.path),
  );
  if (!entry)
    throw new SafeError(
      'unknown_operation',
      'Use a method and path returned by search.',
    );
  if (!entry.input(request)) invalid(entry.input);
  const captures = entry.match.exec(request.path)!;
  const pathArgs = Object.fromEntries(
    entry.pathNames.map((name, i) => [name, captures[i + 1]!]),
  );
  if (!entry.pathInput(pathArgs)) invalid(entry.pathInput);
  // Deliberately support scalar query values only, with unambiguous URL encoding.
  for (const value of Object.values(request.query ?? {})) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) invalid();
  }
  return {
    request,
    operation: entry.op,
    pathArgs,
    validateResponse: (status: number, result: unknown) => {
      const validate =
        entry.outputs.get(String(status)) ?? entry.outputs.get('2XX');
      if (!validate?.(result))
        throw new SafeError(
          'upstream_schema',
          'Tamperbox API returned an unexpected response shape.',
        );
    },
  };
}
