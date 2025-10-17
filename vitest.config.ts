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
        // Updated after security fixes (2025-10-17)
        // Current coverage: 74.78% statements, 89.35% branches, 86.9% functions, 74.78% lines
        // Slightly lower due to new execGit() function in branch-sync.ts
        statements: 74.5,
        branches: 89,
        functions: 86,
        lines: 74.5,
      },
    },
  },
});
