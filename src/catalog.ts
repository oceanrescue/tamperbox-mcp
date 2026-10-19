import { Ajv, type AnySchema } from 'ajv';
import contract from './api-contract.json' with { type: 'json' };
import { SafeError } from './errors.js';
export interface Operation {
  name: string;
  description: string;
  method: 'GET' | 'POST';
  path: string;
  inputSchema: AnySchema;
  outputSchema: AnySchema;
  example: Record<string, unknown>;
}
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: 'object', properties, required, additionalProperties: false });
/** @deprecated Legacy library facade. Use spec/operations and ApiClient.request for the complete API. */
export const catalog: Operation[] = [
  ...contract.operations.map((op) => ({
    name: op.id,
    description: op.description,
    method: 'POST' as const,
    path: `/v1/tools/${op.id}`,
    inputSchema: op.inputSchema,
    outputSchema: op.outputSchema,
    example: {
      input: op.example,
      ...(op.id === 'api_convert'
        ? { options: { target: 'openapi-json' } }
        : {}),
    },
  })),
  {
    name: 'pipeline',
    description:
      'Execute 1–20 ordered transforms. Return selected named artifacts and provenance.',
    method: 'POST',
    path: '/v1/pipeline',
    inputSchema: contract.pipelineSchema,
    outputSchema: contract.pipelineResultSchema,
    example: {
      version: 1,
      input: { mediaType: 'application/json', value: '{}' },
      steps: [{ id: 'format', tool: 'json_format' }],
    },
  },
  {
    name: 'find',
    description:
      'Search the upstream tool directory by keywords or media types. Do not send secrets as queries.',
    method: 'GET',
    path: '/v1/find',
    inputSchema: contract.findSchema,
    outputSchema: {
      type: 'object',
      required: ['tools', 'provenance'],
      properties: { tools: { type: 'array' }, provenance: { type: 'object' } },
    },
    example: { query: 'json' },
  },
  {
    name: 'recipe',
    description: 'Read the published jwt-to-yaml pipeline recipe.',
    method: 'GET',
    path: '/v1/recipes/jwt-to-yaml',
    inputSchema: object({ id: { type: 'string', enum: ['jwt-to-yaml'] } }),
    outputSchema: {
      type: 'object',
      required: ['id', 'version', 'steps'],
      properties: {
        id: { const: 'jwt-to-yaml' },
        version: { const: 1 },
        steps: { type: 'array' },
      },
    },
    example: { id: 'jwt-to-yaml' },
  },
];
const ajv = new Ajv({ strict: false, allErrors: false, ownProperties: true });
const byName = new Map(
  catalog.map((op) => [
    op.name,
    {
      op,
      input: ajv.compile(op.inputSchema),
      output: ajv.compile(op.outputSchema),
    },
  ]),
);
export function validateInput(name: string, args: unknown): Operation {
  const entry = byName.get(name);
  if (!entry)
    throw new SafeError(
      'unknown_operation',
      'Use an operation returned by tamperbox_discover.',
    );
  if (!entry.input(args)) {
    const validation = (entry.input.errors ?? []).slice(0, 1).map((error) => ({
      path: error.instancePath.slice(0, 256),
      keyword: error.keyword,
      message: (error.message ?? 'Invalid value.').slice(0, 256),
    }));
    const first = validation[0];
    throw new SafeError(
      'invalid_arguments',
      first
        ? `Invalid arguments: ${first.path || '/'} ${first.message}.`
        : 'Arguments do not match the operation schema.',
      undefined,
      { validation },
    );
  }
  return entry.op;
}
export function validateOutput(name: string, value: unknown): void {
  if (!byName.get(name)?.output(value))
    throw new SafeError(
      'upstream_schema',
      'Tamperbox API returned an unexpected response shape.',
    );
}
/** @deprecated Use CodeRunner.search to query the complete OpenAPI specification. */
export function discover({
  query = '',
  names = [],
}: { query?: string; names?: string[] } = {}) {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  return {
    engineVersion: contract.engineVersion,
    operations: catalog.filter(
      (op) =>
        (names.length === 0 || names.includes(op.name)) &&
        words.every((word) =>
          `${op.name} ${op.description}`.toLowerCase().includes(word),
        ),
    ),
    usage:
      'Call await tamperbox.<name>(arguments) inside tamperbox_execute. Code is an async function body; use return to select JSON output. Only these operations are available. Inputs to API calls are transmitted to the configured Tamperbox API.',
  };
}
