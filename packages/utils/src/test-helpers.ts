/**
 * Shared Test Helpers
 *
 * Common utilities for tests across all packages
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizedTmpdir } from './path-helpers.js';

/**
 * Create a unique temporary test directory
 *
 * @returns Path to the created temporary directory
 *
 * @example
 * ```typescript
 * let testDir: string;
 * beforeEach(async () => {
 *   testDir = await createTempTestDir();
 * });
 * ```
 */
export async function createTempTestDir(): Promise<string> {
  // eslint-disable-next-line sonarjs/pseudo-random -- Safe for test directory uniqueness
  const testDir = join(normalizedTmpdir(), `vibe-validate-test-${Date.now()}-${Math.random()}`);
  await mkdir(testDir, { recursive: true });
  return testDir;
}
