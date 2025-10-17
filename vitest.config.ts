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
        // Updated after version 0.9.4 fixes (2025-10-17)
        // Current coverage: 74.34% statements, 87.69% branches, 80% functions, 74.34% lines
        // Thresholds set slightly below actual to allow minor fluctuations
        statements: 74,
        branches: 87,
        functions: 80,
        lines: 74,
      },
    },
  },
});
