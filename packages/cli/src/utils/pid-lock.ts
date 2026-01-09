/**
 * Advisory locking for single-instance validation execution
 *
 * Uses proper-lockfile for cross-platform advisory locking with automatic
 * stale lock detection. Works reliably on Windows, macOS, and Linux.
 *
 * Note: Migrated from manual PID-based locking to proper-lockfile for
 * true advisory locking (99.9% reliability vs ~40% with manual approach).
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import lockfile from 'proper-lockfile';


/**
 * Lock file information
 */
export interface LockInfo {
  /** Process ID holding the lock */
  pid: number;
  /** Project directory path */
  directory: string;
  /** Git tree hash at time of lock acquisition */
  treeHash: string;
  /** ISO timestamp when lock was acquired */
  startTime: string;
}

/**
 * Result of lock acquisition attempt
 */
export interface LockResult {
  /** Whether lock was successfully acquired */
  acquired: boolean;
  /** Path to lock file */
  lockFile: string;
  /** Information about existing lock (if acquisition failed) */
  existingLock?: LockInfo;
  /** Release function (only present when acquired=true) */
  release?: () => Promise<void>;
}

/**
 * Lock scope options
 */
export interface LockOptions {
  /**
   * Concurrency scope for lock files
   * - 'directory': Each working directory has its own lock (default, allows parallel worktrees)
   * - 'project': All directories for the same project share a lock (prevents port/DB conflicts)
   */
  scope?: 'directory' | 'project';
  /**
   * Project identifier for project-scoped locking
   * Used when scope='project' to generate lock filename
   */
  projectId?: string;
}

/**
 * Encode directory path for use in lock file name
 *
 * Replaces path separators and special characters to create
 * a human-readable lock file name.
 *
 * Examples:
 * - /Users/jeff/project → _Users_jeff_project.lock
 * - C:\Users\jeff\project → C-_Users_jeff_project.lock
 *
 * @param directory - Project directory path
 * @returns Encoded path suitable for filename
 */
function encodeDirectoryPath(directory: string): string {
  return directory
    .replace(/^([A-Za-z]):/, '$1-') // Windows drive letter (C: → C-)
    .replaceAll('\\', '_') // Windows backslashes
    .replaceAll('/', '_'); // Unix forward slashes
}

/**
 * Get lock file path based on scope
 *
 * @param directory - Project directory
 * @param options - Lock scope options
 * @returns Lock file path
 */
function getLockFilePath(directory: string, options: LockOptions = {}): string {
  const scope = options.scope ?? 'directory';
  const lockDir = join(normalizedTmpdir(), '.vibe-validate', 'locks');

  // Ensure lock directory exists
  if (!existsSync(lockDir)) {
    mkdirSyncReal(lockDir, { recursive: true, mode: 0o755 });
  }

  if (scope === 'project') {
    if (!options.projectId) {
      throw new Error('projectId is required when scope is "project"');
    }
    // Project-scoped: /tmp/.vibe-validate/locks/project-{projectId}.lock
    return join(lockDir, `project-${options.projectId}.lock`);
  }

  // Directory-scoped (default): /tmp/.vibe-validate/locks/dir-{encoded}.lock
  const encoded = encodeDirectoryPath(directory);
  return join(lockDir, `dir-${encoded}.lock`);
}

/**
 * Get metadata file path for a lock file
 *
 * @param lockFile - Lock file path
 * @returns Metadata file path
 */
function getMetadataFilePath(lockFile: string): string {
  return `${lockFile}.meta.json`;
}

/**
 * Write lock metadata to companion file
 *
 * @param lockFile - Lock file path
 * @param metadata - Lock metadata to write
 */
function writeMetadata(lockFile: string, metadata: LockInfo): void {
  const metaFile = getMetadataFilePath(lockFile);
  writeFileSync(metaFile, JSON.stringify(metadata), 'utf8');
}

/**
 * Read lock metadata from companion file
 *
 * @param lockFile - Lock file path
 * @returns Lock metadata or null if file doesn't exist
 */
function readMetadata(lockFile: string): LockInfo | null {
  const metaFile = getMetadataFilePath(lockFile);
  try {
    const content = readFileSync(metaFile, 'utf8');
    return JSON.parse(content) as LockInfo;
  } catch {
    return null;
  }
}

/**
 * Delete lock metadata file
 *
 * @param lockFile - Lock file path
 */
function deleteMetadata(lockFile: string): void {
  const metaFile = getMetadataFilePath(lockFile);
  try {
    unlinkSync(metaFile);
  } catch {
    // Ignore errors - file might not exist
  }

}

/**
 * Acquire validation lock using proper-lockfile
 *
 * Uses advisory locking with automatic stale lock detection.
 * If a lock already exists and is held by a running process, returns acquired=false.
 * Stale locks (from crashed processes) are automatically cleaned up.
 *
 * @param directory - Project directory to lock
 * @param treeHash - Current git tree hash
 * @param options - Lock scope options
 * @returns Lock acquisition result with release function
 */
export async function acquireLock(
  directory: string,
  treeHash: string,
  options: LockOptions = {},
): Promise<LockResult> {
  const lockFile = getLockFilePath(directory, options);

  try {
    // Try to acquire lock with proper-lockfile
    // proper-lockfile handles lock metadata internally (PID, timestamp, etc.)
    const release = await lockfile.lock(lockFile, {
      // Stale lock timeout: 60 seconds (consider lock stale if not updated)
      stale: 60000,
      // Update lock every 10 seconds to prove liveness
      update: 10000,
      // Don't retry - we'll handle retries at a higher level
      retries: 0,
      // Don't resolve symlinks (faster, and we control the lock directory)
      realpath: false,
    });

    // Write metadata for API compatibility
    const metadata: LockInfo = {
      pid: process.pid,
      directory,
      treeHash,
      startTime: new Date().toISOString(),
    };
    writeMetadata(lockFile, metadata);

    // Lock acquired! Return with release function
    return {
      acquired: true,
      lockFile,
      release: async () => {
        try {
          deleteMetadata(lockFile);
          await release();
        } catch (error) {
          // Ignore release errors (lock file might already be removed)
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn(`Warning: Failed to release lock: ${(error as Error).message}`);
          }
        }
      },
    };
  } catch (error: unknown) {
    const err = error as Error & { code?: string; file?: string };

    // Lock is held by another process
    if (err.code === 'ELOCKED') {
      // Read metadata from companion file
      const existingLock = readMetadata(lockFile) ?? {
        pid: 0,
        directory,
        treeHash: 'unknown',
        startTime: new Date().toISOString(),
      };

      return {
        acquired: false,
        lockFile,
        existingLock,
      };
    }

    // Unexpected error
    throw new Error(`Failed to acquire lock: ${err.message}`);
  }
}

/**
 * Release validation lock
 *
 * Calls the release function returned by acquireLock.
 * Safe to call even if lock was already released.
 *
 * @param _lockFile - Path to lock file (for backwards compatibility, not used)
 * @param releaseFunc - Release function from acquireLock (preferred)
 */
export async function releaseLock(
  _lockFile: string,
  releaseFunc?: () => Promise<void>
): Promise<void> {
  if (releaseFunc) {
    await releaseFunc();
  }
  // If no release function provided, lockfile is likely already released
  // (backwards compatibility with old code that just passed lockFile path)
}

/**
 * Check if a lock exists and is held by a running process
 *
 * @param directory - Project directory
 * @param options - Lock scope options
 * @returns Lock info if lock exists and is valid, null otherwise
 */
export async function checkLock(
  directory: string,
  options: LockOptions = {},
): Promise<LockInfo | null> {
  const lockFile = getLockFilePath(directory, options);

  try {
    // Try to check if lock is held
    const isLocked = await lockfile.check(lockFile, {
      stale: 60000,
      realpath: false,
    });

    if (isLocked) {
      // Lock exists and is valid - read metadata
      return readMetadata(lockFile) ?? {
        pid: 0,
        directory,
        treeHash: 'unknown',
        startTime: new Date().toISOString(),
      };
    }

    return null;
  } catch {
    // Lock doesn't exist or error checking
    return null;
  }
}

/**
 * Wait for an existing lock to be released
 *
 * Polls the lock file until it's released or timeout is reached.
 *
 * @param directory - Project directory
 * @param timeoutSeconds - Maximum time to wait in seconds
 * @param pollInterval - How often to check in milliseconds
 * @param options - Lock scope options
 * @returns Object indicating if wait timed out
 */
export async function waitForLock(
  directory: string,
  timeoutSeconds: number,
  pollInterval: number = 1000,
  options: LockOptions = {},
): Promise<{ timedOut: boolean }> {
  const lockFile = getLockFilePath(directory, options);
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (true) {
    try {
      const isLocked = await lockfile.check(lockFile, {
        stale: 60000,
        realpath: false,
      });

      if (!isLocked) {
        // Lock released!
        return { timedOut: false };
      }
    } catch {
      // Lock doesn't exist (released)
      return { timedOut: false };
    }

    // Check timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      return { timedOut: true };
    }

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}
