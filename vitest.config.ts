import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts'],
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
        // Updated after re-enabling post-merge-cleanup.ts coverage (2025-10-16)
        // Current coverage: 74.39% statements, 89.23% branches, 87.05% functions, 74.39% lines
        // post-merge-cleanup.ts: 95.2% coverage (18/18 tests passing)
        statements: 74,
        branches: 89,
        functions: 87,
        lines: 74,
      },
    },
  },
});
