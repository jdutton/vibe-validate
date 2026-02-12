/**
 * Shared vitest mock setup for validate workflow tests
 *
 * This file contains the vi.mock() calls that must be at module scope.
 * Import this at the top of test files that need these mocks.
 */

import { vi } from 'vitest';

// Mock git module
vi.mock('@vibe-validate/git');

// Mock history module
vi.mock('@vibe-validate/history');

// Mock core module with runValidation as vi.fn()
vi.mock('@vibe-validate/core', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Need dynamic import for mocking
  const actual: typeof import('@vibe-validate/core') = await importOriginal();
  return {
    ...actual,
    runValidation: vi.fn(),
  };
});
