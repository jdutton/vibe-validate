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
        // Updated after adding CLI command/bin.ts coverage (2025-10-16)
        // Current coverage: 75.76% statements, 87.79% branches, 80.72% functions, 75.76% lines
        statements: 75,
        branches: 87,
        functions: 80,
        lines: 75,
      },
    },
  },
});
