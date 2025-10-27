import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for SYSTEM TESTS
 *
 * System tests are slow (30s-10min total) end-to-end tests that:
 * - Execute real commands (not mocked)
 * - Test full workflows against extractors-test-bed
 * - Verify extraction quality with real test framework output
 * - May depend on project state (git, config files)
 *
 * Run with: pnpm test:system
 *
 * These tests are separate from fast unit tests to keep development
 * feedback loops quick (<10s).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/*/test/**/*.system.test.ts',
      'packages/*/test/integration/**/*.test.ts', // Existing integration tests
    ],
    testTimeout: 120000, // 2 minutes per test (real commands are slow)
    hookTimeout: 30000, // 30 seconds for setup/teardown
    fileParallelism: true,
    maxConcurrency: 3, // Lower concurrency for resource-intensive tests
    coverage: {
      enabled: false, // System tests don't contribute to unit test coverage metrics
    },
  },
});
