import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['dist/**/*.js'],
      exclude: ['dist/sandbox-worker.js', 'dist/cli.js', 'dist/index.js'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
    maxWorkers: 2,
  },
});
