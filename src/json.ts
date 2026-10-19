import { SafeError } from './errors.js';
/** Iterative traversal keeps hostile nesting away from schema and MCP serializers. */
export function assertJsonDepth(value: unknown, maxDepth = 40): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.depth > maxDepth)
      throw new SafeError(
        'json_depth',
        'JSON nesting exceeds the supported depth.',
      );
    if (item.value !== null && typeof item.value === 'object') {
      for (const child of Object.values(item.value))
        stack.push({ value: child, depth: item.depth + 1 });
    }
  }
}
