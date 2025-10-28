import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.system.test.ts', // System tests run separately with pnpm test:system
    ],
    // Prevent Vitest worker timeouts by limiting concurrency
    maxConcurrency: 5,
    fileParallelism: false,
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        // Only exclude true build artifacts and type definitions
        'packages/*/src/**/*.d.ts',
        'packages/*/dist/**',
        'packages/*/src/index.ts',  // Re-exports only
        'packages/*/src/types.ts',   // Type definitions only
        // Build-time scripts (not runtime code)
        'packages/*/src/scripts/**/*.ts',
        'packages/config/src/schema-export.ts',  // Build-time JSON schema generation
        // CLI entry point and commands tested via integration tests
        'packages/cli/src/bin.ts',  // CLI entry point
        'packages/cli/src/commands/init.ts',  // Tested via integration
        'packages/cli/src/commands/watch-pr.ts',  // Tested via integration
        // CI provider services tested via integration tests
        'packages/cli/src/services/ci-provider-registry.ts',
        'packages/cli/src/services/ci-provider.ts',
        // Zod schemas (type definitions with validation)
        'packages/cli/src/schemas/**/*.ts',
      ],
      thresholds: {
        // v0.14.2: Enforced quality gates at 80% minimum
        // Current (Oct 28 2025): 78.48% statements, 84.39% branches, 87.3% functions, 78.48% lines
        //
        // Strategy:
        // - CLI commands (bin.ts, init.ts, cleanup.ts, sync-check.ts, watch-pr.ts) have 0% unit test coverage
        //   These are tested via integration tests (see packages/cli/test/integration/)
        // - All utility modules (git-helpers, extractors/utils, etc.) have 100% coverage
        // - Core validation logic (runner.ts, process-utils.ts) has 95%+ coverage
        //
        // Thresholds set to 80% minimum to enforce quality gates
        statements: 80,
        branches: 80,
        functions: 87,  // Already above target
        lines: 80,
      },
    },
  },
});
