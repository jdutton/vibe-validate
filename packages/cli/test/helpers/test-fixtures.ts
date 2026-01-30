/**
 * Test Fixtures - Shared utilities for test file and directory management
 *
 * Eliminates duplication of temp directory setup/teardown across test files.
 */

import { rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';

/**
 * Create a temporary test directory
 *
 * @param prefix - Directory name prefix
 * @returns Path to created directory (normalized, no Windows 8.3 short names)
 */
export function createTempTestDir(prefix: string): string {
  const targetDir = join(normalizedTmpdir(), `${prefix}-${Date.now()}`);
  // Use mkdirSyncReal to get normalized path (prevents Windows RUNNER~1 issues)
  return mkdirSyncReal(targetDir, { recursive: true });
}

/**
 * Clean up a temporary test directory
 *
 * @param dir - Directory to remove
 */
export function cleanupTempTestDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Higher-order function for tests requiring temp directory
 *
 * Usage:
 * ```typescript
 * it('test name', withTempDir('test-prefix', (testDir) => {
 *   // Test code here using testDir
 * }));
 * ```
 *
 * @param prefix - Directory name prefix
 * @param testFn - Test function to execute with testDir
 * @returns Test function with setup/teardown
 */
export function withTempDir(
  prefix: string,
  testFn: (_dir: string) => void | Promise<void>
): () => Promise<void> {
  return async () => {
    const testDir = createTempTestDir(prefix);
    try {
      await testFn(testDir);
    } finally {
      cleanupTempTestDir(testDir);
    }
  };
}

/**
 * Write a config file to test directory
 *
 * @param testDir - Test directory path
 * @param content - Config file content (YAML string)
 * @param filename - Config filename (default: vibe-validate.config.yaml)
 */
export function writeTestConfig(
  testDir: string,
  content: string,
  filename = 'vibe-validate.config.yaml'
): void {
  writeFileSync(join(testDir, filename), content);
}
