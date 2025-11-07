/**
 * Shared test helpers for integration tests
 *
 * Provides utilities for setting up test environments with temp directories,
 * git repositories, and cleanup.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Creates a temporary test directory with a unique name
 *
 * @param prefix - Prefix for the temp directory (e.g., 'vibe-validate-test')
 * @returns Absolute path to the created temp directory
 *
 * @example
 * ```typescript
 * const testDir = createTempTestDir('my-test');
 * // Returns: /tmp/my-test-1699564321123
 * ```
 */
export function createTempTestDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Removes a test directory and all its contents
 *
 * Safe to call even if directory doesn't exist.
 *
 * @param dir - Directory to remove
 *
 * @example
 * ```typescript
 * cleanupTempTestDir(testDir);
 * ```
 */
export function cleanupTempTestDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Initializes a git repository in the specified directory
 *
 * Sets up a bare git repo with test user credentials. This is needed
 * for many vibe-validate commands that require a git context.
 *
 * @param cwd - Directory to initialize as git repo
 *
 * @example
 * ```typescript
 * const testDir = createTempTestDir('my-test');
 * initializeGitRepo(testDir);
 * // Now testDir is a git repository
 * ```
 */
export function initializeGitRepo(cwd: string): void {
  execSync('git init', { cwd, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd, stdio: 'ignore' });
}

/**
 * Complete test environment setup: creates temp dir and initializes git
 *
 * Combines createTempTestDir and initializeGitRepo for convenience.
 *
 * @param prefix - Prefix for the temp directory
 * @returns Absolute path to the created and initialized test directory
 *
 * @example
 * ```typescript
 * const testDir = setupTestEnvironment('my-test');
 * // testDir is now a temp directory with initialized git repo
 * ```
 */
export function setupTestEnvironment(prefix: string): string {
  const dir = createTempTestDir(prefix);
  initializeGitRepo(dir);
  return dir;
}
