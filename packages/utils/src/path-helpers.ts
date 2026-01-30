/**
 * Path Helpers for Cross-Platform Testing
 *
 * Windows-safe path utilities that handle 8.3 short names (e.g., RUNNER~1).
 * These helpers ensure tests work correctly on both Unix and Windows.
 *
 * @package @vibe-validate/utils
 */

import { mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';



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
    // Use native OS realpath for better Windows compatibility
    return realpathSync.native(temp);
  } catch {
    // Fallback to regular realpathSync
    try {
       
      return realpathSync(temp);
    } catch {
      // Last resort: return original
      return temp;
    }
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
   
  mkdirSync(path, options);

  try {
    // Use native OS realpath for better Windows compatibility
    return realpathSync.native(path);
  } catch {
    // Fallback to regular realpathSync
    try {
       
      return realpathSync(path);
    } catch {
      // Last resort: return original
      return path;
    }
  }
}

/**
 * Normalize any path (resolve short names on Windows)
 *
 * Utility to normalize paths without creating directories.
 * Accepts multiple path segments like path.resolve() for convenience.
 *
 * @param paths - Path segments to join and normalize
 * @returns Real (normalized) path, or resolved path if normalization fails
 *
 * @example
 * ```typescript
 * // Single path
 * const shortPath = 'C:\\PROGRA~1\\nodejs';
 * const longPath = normalizePath(shortPath);
 * // Result: 'C:\\Program Files\\nodejs'
 *
 * // Multiple segments (like path.resolve)
 * const cliPath = normalizePath(__dirname, '../../dist/bin.js');
 * // Resolves to absolute path AND normalizes short names
 * ```
 */
export function normalizePath(...paths: string[]): string {
  // First resolve to absolute path (handles multiple segments)
  const resolved = paths.length === 1
    ? paths[0]
    : resolve(...paths);

  try {
    // Use native OS realpath for better Windows compatibility
    return realpathSync.native(resolved);
  } catch {
    // Fallback to regular realpathSync
    try {
       
      return realpathSync(resolved);
    } catch {
      // Last resort: return resolved path (better than original input)
      return resolved;
    }
  }
}

/**
 * Convert a path to forward slashes
 *
 * Windows accepts both forward slashes and backslashes as path separators.
 * This function normalizes all paths to use forward slashes for consistency.
 * Useful for glob pattern matching, cross-platform comparisons, and string operations.
 *
 * @param p - Path to convert
 * @returns Path with forward slashes
 *
 * @example
 * ```typescript
 * toForwardSlash('C:\\Users\\docs\\README.md')
 * // Returns: 'C:/Users/docs/README.md'
 *
 * toForwardSlash('/project/docs/README.md')
 * // Returns: '/project/docs/README.md' (unchanged)
 * ```
 */
export function toForwardSlash(p: string): string {
  return p.replaceAll('\\', '/');
}
