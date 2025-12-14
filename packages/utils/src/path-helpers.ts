/**
 * Path Helpers for Cross-Platform Testing
 *
 * Windows-safe path utilities that handle 8.3 short names (e.g., RUNNER~1).
 * These helpers ensure tests work correctly on both Unix and Windows.
 *
 * @package @vibe-validate/utils
 */

import { tmpdir } from 'node:os';
import { mkdirSync, realpathSync } from 'node:fs';

/**
 * Get normalized temp directory path
 *
 * On Windows, tmpdir() may return 8.3 short names like:
 * - C:\Users\RUNNER~1\AppData\Local\Temp
 *
 * This function returns the real (long) path:
 * - C:\Users\runneradmin\AppData\Local\Temp
 *
 * **Why this matters:**
 * - Node.js operations create directories with LONG names
 * - Tests using SHORT paths from tmpdir() will fail existsSync() checks
 * - This is a "works on Mac, fails on Windows CI" bug pattern
 *
 * @returns Normalized temp directory path (resolves short names on Windows)
 *
 * @example
 * ```typescript
 * // ❌ WRONG - May return short path on Windows
 * const testDir = join(tmpdir(), 'test-dir');
 *
 * // ✅ RIGHT - Always returns real path
 * const testDir = join(normalizedTmpdir(), 'test-dir');
 * ```
 */
export function normalizedTmpdir(): string {
  const temp = tmpdir();
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Safe: temp is from tmpdir() (OS-provided system temp directory), not user input
    return realpathSync(temp);
  } catch {
    // Fallback: if realpathSync fails, return original
    // (shouldn't happen, but safety first)
    return temp;
  }
}

/**
 * Create directory and return normalized path
 *
 * Combines mkdirSync + realpathSync to ensure the returned path
 * matches the actual filesystem path (resolves Windows short names).
 *
 * **Why this matters:**
 * - After mkdirSync(), the path might not match what filesystem uses
 * - On Windows, short path input creates long path output
 * - Subsequent existsSync() checks with original path may fail
 *
 * @param path - Directory path to create
 * @param options - Options for mkdirSync (e.g., recursive: true)
 * @returns Real (normalized) path to the created directory
 *
 * @example
 * ```typescript
 * // ❌ WRONG - Path mismatch on Windows
 * const testDir = join(tmpdir(), 'test-dir');
 * mkdirSync(testDir, { recursive: true });
 * // testDir might be: C:\Users\RUNNER~1\...\test-dir
 * // But filesystem created: C:\Users\runneradmin\...\test-dir
 *
 * // ✅ RIGHT - Normalized path guaranteed
 * const testDir = mkdirSyncReal(
 *   join(tmpdir(), 'test-dir'),
 *   { recursive: true }
 * );
 * // testDir is now: C:\Users\runneradmin\...\test-dir (real path)
 * ```
 */
export function mkdirSyncReal(
  path: string,
  options?: Parameters<typeof mkdirSync>[1]
): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Safe: path is function parameter from test setup (tmpdir + test name), not user input
  mkdirSync(path, options);

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Safe: path is function parameter from test setup (tmpdir + test name), not user input
    return realpathSync(path);
  } catch {
    // Fallback: if realpathSync fails, return original
    // (might happen if directory creation failed)
    return path;
  }
}

/**
 * Normalize any path (resolve short names on Windows)
 *
 * Utility to normalize paths without creating directories.
 * Useful when you have an existing path that might contain short names.
 *
 * @param path - Path to normalize
 * @returns Real (normalized) path, or original if normalization fails
 *
 * @example
 * ```typescript
 * const shortPath = 'C:\\PROGRA~1\\nodejs';
 * const longPath = normalizePath(shortPath);
 * // Result: 'C:\\Program Files\\nodejs'
 * ```
 */
export function normalizePath(path: string): string {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Safe: path is function parameter from test setup (tmpdir + test name), not user input
    return realpathSync(path);
  } catch {
    return path;
  }
}
