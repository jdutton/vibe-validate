/**
 * Test Fixtures - Shared utilities for test file and directory management
 *
 * Eliminates duplication of temp directory setup/teardown across test files.
 */

import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Create a temporary test directory
 *
 * @param prefix - Directory name prefix
 * @returns Path to created directory
 */
export function createTempTestDir(prefix: string): string {
  const testDir = join(tmpdir(), `${prefix}-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  return testDir;
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
  testFn: (testDir: string) => void | Promise<void>
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
