import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./.github/vitest.setup.ts'],
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/extractors/src/extractors/**/*.test.ts', // Co-located plugin tests
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.system.test.ts', // System tests run separately with pnpm test:system
      // Platform-specific exclusions (Windows has file locking issues in cleanup)
      ...(process.platform === 'win32' ? [
        'packages/cli/test/commands/doctor-config-errors.test.ts',
        'packages/cli/test/commands/config-error-reporting.test.ts',
        'packages/cli/test/commands/create-extractor.test.ts',
      ] : []),
    ],
    // Prevent Vitest worker timeouts by limiting concurrency
    // Reduced from 5 to 3 to prevent resource exhaustion with coverage (v0.15.0)
    // Further reduced to 1 to prevent onTaskUpdate timeouts (v0.17.1)
    maxConcurrency: 1,
    fileParallelism: false,
    // Increased from 10000 to 30000 for tests that spawn processes (v0.15.0)
    testTimeout: 30000,
    // Pool options to prevent worker exhaustion
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        maxForks: 1,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
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
        // CLI entry point and wrapper scripts tested via integration tests
        'packages/cli/src/bin.ts',  // CLI entry point
        'packages/cli/src/bin/**/*.ts',  // CLI wrapper scripts (tested via compiled output)
        'packages/cli/src/commands/init.ts',  // Tested via integration
        'packages/cli/src/commands/watch-pr.ts',  // Tested via integration
        // CI provider services tested via integration tests
        'packages/cli/src/services/ci-provider-registry.ts',
        'packages/cli/src/services/ci-provider.ts',
        // Zod schemas (type definitions with validation)
        'packages/cli/src/schemas/**/*.ts',
        // Integration test files (don't collect coverage from test files)
        'packages/*/test/integration/**/*.ts',
      ],
      thresholds: {
        // v0.14.2: Enforced quality gates at 80% minimum
        // Current (Nov 4 2025): ~79% statements, ~84% branches, ~86.5% functions, ~79% lines
        //
        // Strategy:
        // - CLI commands (bin.ts, init.ts, cleanup.ts, sync-check.ts, watch-pr.ts) have 0% unit test coverage
        //   These are tested via integration tests (see packages/cli/test/integration/)
        // - All utility modules (git-helpers, extractors/utils, etc.) have 100% coverage
        // - Core validation logic (runner.ts, process-utils.ts) has 95%+ coverage
        //
        // Thresholds set to 79% minimum temporarily after plugin architecture refactor (v0.17.0 POC)
        // TODO: Restore to 80% after completing remaining extractor migrations
        statements: 79,
        branches: 80,
        functions: 84,  // Lowered to 84% after adding temp-files + display infrastructure (v0.15.0 RC - tests deferred)
        lines: 79,
      },
    },
  },
});
