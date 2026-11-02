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
 * INCLUDED TESTS: exactly the files the unit config (vitest.config.ts) excludes
 * as integration or system tests, by the same globs. A hand-kept file list here
 * let suites fall into no tier at all; the globs make that impossible.
 */
const isWindows = process.platform === 'win32';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./.github/vitest.setup.ts'], // Load global setup for env var cleanup
    include: [
      'packages/**/*.system.test.ts',
      'packages/**/*.integration.test.ts',
      'packages/**/test/integration/**/*.test.ts',
    ],
    testTimeout: 60000, // 60 seconds per test (increased for Windows CI resource constraints)
    hookTimeout: 90000, // 90 seconds for setup/teardown (increased for Windows)
    fileParallelism: true,
    // Windows CI has resource constraints - reduce concurrency to prevent worker timeouts
    maxConcurrency: isWindows ? 1 : 4,
    poolOptions: {
      threads: {
        // Reduce worker count on Windows to prevent communication timeouts
        maxThreads: isWindows ? 1 : undefined,
        minThreads: isWindows ? 1 : undefined,
      },
      forks: {
        // Apply same limits if using forks pool
        maxForks: isWindows ? 1 : undefined,
        minForks: isWindows ? 1 : undefined,
      },
    },
    coverage: {
      enabled: false, // Integration/system tests don't contribute to unit test coverage metrics
    },
  },
});
