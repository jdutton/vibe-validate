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
        // Exclude CLI commands from coverage (testing deferred to Phase 3.3)
        'packages/cli/src/commands/**',
        'packages/cli/src/bin.ts',
        // Exclude index files (re-exports only)
        'packages/*/src/index.ts',
        // Exclude type definition files
        'packages/*/src/types.ts',
      ],
      thresholds: {
        // Current: 65% statements, 87% branches, 73% functions, 65% lines
        // Goal: Reach 80% across all metrics
        statements: 65,
        branches: 80,
        functions: 73,
        lines: 65,
      },
    },
  },
});
