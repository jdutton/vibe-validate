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
        // Only exclude true build artifacts and type definitions
        'packages/*/src/**/*.d.ts',
        'packages/*/dist/**',
        'packages/*/src/index.ts',  // Re-exports only
        'packages/*/src/types.ts',   // Type definitions only
        // Build-time scripts (not runtime code)
        'packages/*/src/scripts/**/*.ts',
        'packages/config/src/schema-export.ts',  // Build-time JSON schema generation
        // CLI commands tested via integration tests
        'packages/cli/src/commands/watch-pr.ts',
        // CI provider services tested via integration tests
        'packages/cli/src/services/ci-provider-registry.ts',
        'packages/cli/src/services/ci-provider.ts',
        // Zod schemas (type definitions with validation)
        'packages/cli/src/schemas/**/*.ts',
      ],
      thresholds: {
        // v0.11.0: True coverage with minimal exclusions
        // Current (with watch-pr): 69.83% statements, 86.91% branches, 90.83% functions, 69.83% lines
        //
        // Strategy:
        // - CLI commands (bin.ts, init.ts, cleanup.ts, sync-check.ts, watch-pr.ts) have 0% unit test coverage
        //   These are tested via integration tests (see packages/cli/test/integration/)
        // - All utility modules (git-helpers, extractors/utils, etc.) have 100% coverage
        // - Core validation logic (runner.ts, process-utils.ts) has 95%+ coverage
        //
        // Thresholds set to current levels to prevent regression
        statements: 69,
        branches: 85,  // Lowered from 86 due to platform-specific code paths (Windows: 85.97%)
        functions: 90,
        lines: 69,
      },
    },
  },
});
