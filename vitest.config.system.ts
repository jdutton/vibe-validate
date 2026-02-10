import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for SYSTEM TESTS
 *
 * System tests are end-to-end tests that:
 * - Execute real CLI commands (vv validate, vv state, etc.)
 * - Test the full command stack (no mocks)
 * - Verify CLI works from different directories
 * - Validate npm package integrity for releases
 * - Must be cross-platform (Windows + Unix)
 *
 * Run with: pnpm test:system
 *
 * INCLUDED TESTS:
 * - packaging.system.test.ts: npm package integrity (CRITICAL for releases)
 * - subdirectory-behavior.system.test.ts: CLI commands work from any directory
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      // End-to-end CLI command tests
      'packages/cli/test/packaging.system.test.ts',
      'packages/cli/test/commands/subdirectory-behavior.system.test.ts',
    ],
    testTimeout: 30000, // 30 seconds per test
    hookTimeout: 60000, // 60 seconds for setup/teardown (pnpm pack + npm install)
    fileParallelism: true,
    maxConcurrency: 2, // Limit concurrency (both tests are heavy)
    coverage: {
      enabled: false, // System tests don't contribute to unit test coverage metrics
    },
  },
});
