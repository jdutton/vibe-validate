import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for INTEGRATION TESTS
 *
 * Integration tests are fast (<30s total) tests that:
 * - Execute real commands (not mocked)
 * - Test integration between components
 * - Verify critical workflows (packaging, git, caching, extractors)
 * - Must be cross-platform (Windows + Unix)
 *
 * Run with: pnpm test:integration
 *
 * These tests run IN PARALLEL with unit tests in the validation pipeline
 * to provide comprehensive coverage without significantly impacting feedback time.
 *
 * INCLUDED TESTS:
 * - packaging.system.test.ts: npm package integrity (CRITICAL for releases)
 * - tree-hash.integration.test.ts: git tree hash with real repos
 * - history-recording.test.ts: git notes history tracking
 * - cache-manager.integration.test.ts: real filesystem cache operations
 * - watch-pr-extraction.integration.test.ts: extractor quality validation
 * - run.integration.test.ts: run command with real extractors
 * - subdirectory-behavior.system.test.ts: subdirectory support regression tests
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      // Critical for releases
      'packages/cli/test/packaging.system.test.ts',

      // Git integration
      'packages/git/test/tree-hash.integration.test.ts',
      'packages/cli/test/integration/history-recording.test.ts',

      // Cache and extractors
      'packages/cli/test/integration/cache-manager.integration.test.ts',
      'packages/cli/test/integration/watch-pr-extraction.integration.test.ts',

      // Command integration
      'packages/cli/test/commands/run.integration.test.ts',
      'packages/cli/test/commands/subdirectory-behavior.system.test.ts',
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
