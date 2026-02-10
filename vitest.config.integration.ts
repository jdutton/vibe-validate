import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for INTEGRATION TESTS
 *
 * Integration tests verify component integration:
 * - Git integration (tree hashing, history tracking)
 * - Cache operations (filesystem caching)
 * - Extractor quality (error extraction from real output)
 * - Run command with real extractors
 * - Must be cross-platform (Windows + Unix)
 *
 * Run with: pnpm test:integration
 *
 * These tests run IN PARALLEL with system tests and unit tests in the
 * validation pipeline for fast feedback.
 *
 * INCLUDED TESTS:
 * - tree-hash.integration.test.ts: git tree hash with real repos
 * - history-recording.test.ts: git notes history tracking
 * - cache-manager.integration.test.ts: real filesystem cache operations
 * - watch-pr-extraction.integration.test.ts: extractor quality validation
 * - run.integration.test.ts: run command with real extractors
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      // Git integration
      'packages/git/test/tree-hash.integration.test.ts',
      'packages/cli/test/integration/history-recording.test.ts',

      // Cache and extractors
      'packages/cli/test/integration/cache-manager.integration.test.ts',
      'packages/cli/test/integration/watch-pr-extraction.integration.test.ts',

      // Command integration
      'packages/cli/test/commands/run.integration.test.ts',
    ],
    testTimeout: 30000, // 30 seconds per test
    hookTimeout: 10000, // 10 seconds for setup/teardown
    fileParallelism: true,
    maxConcurrency: 4, // Balance speed vs resource usage
    coverage: {
      enabled: false, // Integration tests don't contribute to unit test coverage metrics
    },
  },
});
