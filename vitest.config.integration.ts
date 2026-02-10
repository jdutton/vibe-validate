import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for INTEGRATION & SYSTEM TESTS
 *
 * This config runs both integration and system tests together in a single
 * Vitest process for optimal performance (shared parallelization, single
 * startup overhead).
 *
 * INTEGRATION TESTS - Component integration:
 * - Git integration (tree hashing, history tracking)
 * - Cache operations (filesystem caching)
 * - Extractor quality (error extraction from real output)
 * - Run command with real extractors
 *
 * SYSTEM TESTS - End-to-end CLI:
 * - CLI commands work from any directory
 * - npm package integrity (CRITICAL for releases)
 *
 * Run with: pnpm test:integration
 *
 * All tests must be cross-platform (Windows + Unix).
 *
 * INCLUDED TESTS (89 total):
 * - packaging.system.test.ts: npm package integrity (14 tests, ALL SKIPPED - see test file for reason)
 * - subdirectory-behavior.system.test.ts: CLI from subdirectories (26 tests)
 * - tree-hash.integration.test.ts: git tree hash with real repos (11 tests)
 * - history-recording.test.ts: git notes history tracking (3 tests)
 * - cache-manager.integration.test.ts: real filesystem cache operations (9 tests)
 * - watch-pr-extraction.integration.test.ts: extractor quality validation (6 tests)
 * - run.integration.test.ts: run command with real extractors (34 tests)
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      // System tests (end-to-end CLI)
      'packages/cli/test/packaging.system.test.ts',
      'packages/cli/test/commands/subdirectory-behavior.system.test.ts',

      // Integration tests (component integration)
      'packages/git/test/tree-hash.integration.test.ts',
      'packages/cli/test/integration/history-recording.test.ts',
      'packages/cli/test/integration/cache-manager.integration.test.ts',
      'packages/cli/test/integration/watch-pr-extraction.integration.test.ts',
      'packages/cli/test/commands/run.integration.test.ts',
    ],
    testTimeout: 30000, // 30 seconds per test
    hookTimeout: 60000, // 60 seconds for setup/teardown (pnpm pack + npm install in system tests)
    fileParallelism: true,
    maxConcurrency: 4, // Balance speed vs resource usage
    coverage: {
      enabled: false, // Integration/system tests don't contribute to unit test coverage metrics
    },
  },
});
