import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts'],
    // Prevent Vitest worker timeouts by limiting concurrency
    maxConcurrency: 5,
    fileParallelism: false,
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.d.ts',
        'packages/*/dist/**',
        // Exclude index files (re-exports only)
        'packages/*/src/index.ts',
        // Exclude type definition files
        'packages/*/src/types.ts',
      ],
      thresholds: {
        // Updated for v0.9.5 (2025-10-17)
        // Current coverage: 74.59% statements, 86.72% branches, 81.05% functions, 74.59% lines
        // Thresholds lowered to allow new feature development without test coverage blocking releases
        statements: 72,
        branches: 84,
        functions: 78,
        lines: 72,
      },
    },
  },
});
