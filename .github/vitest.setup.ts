/**
 * Global Vitest Setup
 *
 * Runs before each test to ensure clean environment and prevent test pollution.
 * Critical for integration tests that spawn child processes which inherit env vars.
 */

import { beforeEach } from 'vitest';

beforeEach(() => {
  // Clean up vibe-validate environment variables to prevent cross-test pollution
  // These can be set by tests and persist across test files, causing failures
  delete process.env.VV_FORCE_EXECUTION;
  delete process.env.VV_CONTEXT;
  delete process.env.CLAUDE_CODE;

  // Don't delete CI env var as it may be legitimately set in CI environment
  // Tests should check for CI and handle it appropriately
});
