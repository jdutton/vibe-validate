/**
 * Temporary file management utilities
 *
 * Provides organized temp directory structure for vibe-validate output files:
 * - /tmp/vibe-validate/runs/{YYYY-MM-DD}/{shortHash-HH-mm-ss}/
 * - Cleanup utilities for old temp files
 * - Storage size calculation
 */

import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { getTempDir } from '@vibe-validate/core';
import { normalizedTmpdir } from '@vibe-validate/utils';

/**
 * Get the root temporary directory for vibe-validate
 * @returns Path to /tmp/vibe-validate (or OS equivalent)
 */
export function getVibeValidateTempDir(): string {
  return join(normalizedTmpdir(), 'vibe-validate');
}

/**
 * Get the organized output directory for a specific run
 * @param treeHash - Git tree hash or identifier
 * @returns Path like /tmp/vibe-validate/runs/2025-11-05/abc123-17-30-45/
 */
export function getRunOutputDir(treeHash: string): string {
  return getTempDir('runs', treeHash);
}

/**
 * Ensure a directory exists (create if needed)
 * Re-exports shared utility from @vibe-validate/core
 */
export { ensureDir } from '@vibe-validate/core';

/**
 * Get the size of a directory recursively (in bytes)
 */
async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        const stats = await stat(fullPath);
        totalSize += stats.size;
      }
    }
  } catch (err: unknown) {
    // Ignore errors (directory might not exist or be inaccessible)
    if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
      // Log unexpected errors but don't throw
      console.warn(`Warning: Could not read directory ${dirPath}:`, err);
    }
  }

  return totalSize;
}

/**
 * Count the number of run directories
 */
async function countRunDirectories(runsDir: string): Promise<number> {
  let count = 0;

  try {
    const dateDirs = await readdir(runsDir, { withFileTypes: true });

    for (const dateDir of dateDirs) {
      if (dateDir.isDirectory()) {
        const dateDirPath = join(runsDir, dateDir.name);
        const runDirs = await readdir(dateDirPath, { withFileTypes: true });
        count += runDirs.filter(d => d.isDirectory()).length;
      }
    }
  } catch (err: unknown) {
    // Ignore errors (directory might not exist)
    if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
      console.warn(`Warning: Could not count run directories:`, err);
    }
  }

  return count;
}

/**
 * Get temp file storage information
 */
export async function getTempStorageInfo(): Promise<{
  sizeBytes: number;
  runCount: number;
  path: string;
}> {
  const tempDir = getVibeValidateTempDir();
  const runsDir = join(tempDir, 'runs');

  const [sizeBytes, runCount] = await Promise.all([
    getDirectorySize(runsDir),
    countRunDirectories(runsDir),
  ]);

  return {
    sizeBytes,
    runCount,
    path: runsDir,
  };
}

/**
 * Format bytes as human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Options for cleaning up temp files
 */
export interface CleanupOptions {
  /** Delete files older than this many days (default: 7) */
  olderThanDays?: number;
  /** Dry run: show what would be deleted without actually deleting */
  dryRun?: boolean;
  /** Delete all temp files regardless of age */
  deleteAll?: boolean;
}

/**
 * Result of cleanup operation
 */
export interface CleanupResult {
  /** Number of run directories deleted */
  deletedCount: number;
  /** Number of bytes freed */
  freedBytes: number;
  /** Paths that were deleted (or would be deleted in dry run) */
  deletedPaths: string[];
  /** Errors encountered during cleanup */
  errors: Array<{ path: string; error: string }>;
}

/**
 * Clean up old temporary files
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Cleanup logic requires nested loops and error handling for directory traversal
export async function cleanupOldTempFiles(
  options: CleanupOptions = {}
): Promise<CleanupResult> {
  const {
    olderThanDays = 7,
    dryRun = false,
    deleteAll = false,
  } = options;

  const result: CleanupResult = {
    deletedCount: 0,
    freedBytes: 0,
    deletedPaths: [],
    errors: [],
  };

  const tempDir = getVibeValidateTempDir();
  const runsDir = join(tempDir, 'runs');

  try {
    const dateDirs = await readdir(runsDir, { withFileTypes: true });
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    for (const dateDir of dateDirs) {
      if (!dateDir.isDirectory()) continue;

      const dateDirPath = join(runsDir, dateDir.name);

      try {
        const runDirs = await readdir(dateDirPath, { withFileTypes: true });

        for (const runDir of runDirs) {
          if (!runDir.isDirectory()) continue;

          const runDirPath = join(dateDirPath, runDir.name);

          try {
            const stats = await stat(runDirPath);
            const shouldDelete = deleteAll || stats.mtime < cutoffDate;

            if (shouldDelete) {
              const dirSize = await getDirectorySize(runDirPath);

              if (!dryRun) {
                await rm(runDirPath, { recursive: true, force: true });
              }

              result.deletedCount++;
              result.freedBytes += dirSize;
              result.deletedPaths.push(runDirPath);
            }
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            result.errors.push({ path: runDirPath, error: errorMsg });
          }
        }

        // Try to remove empty date directories
        if (!dryRun) {
          try {
            const remaining = await readdir(dateDirPath);
            if (remaining.length === 0) {
              await rm(dateDirPath, { recursive: true });
            }
          } catch {
            // Ignore errors when cleaning up empty directories
          }
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        result.errors.push({ path: dateDirPath, error: errorMsg });
      }
    }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      // Runs directory doesn't exist - nothing to clean up
      return result;
    }

    const errorMsg = err instanceof Error ? err.message : String(err);
    result.errors.push({ path: runsDir, error: errorMsg });
  }

  return result;
}
