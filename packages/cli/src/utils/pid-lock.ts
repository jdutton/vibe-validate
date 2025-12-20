/**
 * PID-based locking for single-instance validation execution
 *
 * Prevents concurrent validation runs using PID file mechanism.
 * Cross-platform (Node.js), works on Windows, macOS, Linux.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { normalizedTmpdir } from '@vibe-validate/utils';


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

  if (scope === 'project') {
    if (!options.projectId) {
      throw new Error('projectId is required when scope is "project"');
    }
    // Project-scoped: /tmp/vibe-validate-project-{projectId}.lock
    return join(normalizedTmpdir(), `vibe-validate-project-${options.projectId}.lock`);
  }

  // Directory-scoped (default): /tmp/vibe-validate-{encoded-dir}.lock
  const encoded = encodeDirectoryPath(directory);
  return join(normalizedTmpdir(), `vibe-validate-${encoded}.lock`);
}

/**
 * Check if a process is running
 *
 * Cross-platform process check using Node.js process.kill(pid, 0)
 * which doesn't actually kill the process, just tests if it exists.
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Signal 0 tests for process existence without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH = no such process - expected when process doesn't exist
    return false;
  }
}

/**
 * Acquire validation lock
 *
 * Attempts to create a lock file for single-instance execution.
 * If a lock already exists, checks if the process is still running.
 * Stale locks (dead processes) are automatically cleaned up.
 *
 * @param directory - Project directory to lock
 * @param treeHash - Current git tree hash
 * @param options - Lock scope options
 * @returns Lock acquisition result
 */
export async function acquireLock(
  directory: string,
  treeHash: string,
  options: LockOptions = {},
): Promise<LockResult> {
  const lockFile = getLockFilePath(directory, options);

  // Check for existing lock
  if (existsSync(lockFile)) {
    try {
      const lockData = JSON.parse(readFileSync(lockFile, 'utf-8')) as LockInfo;

      // Verify process is actually running
      if (isProcessRunning(lockData.pid)) {
        // Lock is valid - another process is running
        return {
          acquired: false,
          lockFile,
          existingLock: lockData,
        };
      }

      // Stale lock - process no longer exists
      // Clean it up and proceed
      unlinkSync(lockFile);
    } catch {
      // Corrupted lock file - remove and proceed
      unlinkSync(lockFile);
    }
  }

  // Acquire lock
  const lockInfo: LockInfo = {
    pid: process.pid,
    directory,
    treeHash,
    startTime: new Date().toISOString(),
  };

  writeFileSync(lockFile, JSON.stringify(lockInfo, null, 2));

  return {
    acquired: true,
    lockFile,
  };
}

/**
 * Release validation lock
 *
 * Removes the lock file to allow other processes to run.
 * Safe to call even if lock file doesn't exist.
 *
 * @param lockFile - Path to lock file to release
 */
export async function releaseLock(lockFile: string): Promise<void> {
  if (existsSync(lockFile)) {
    unlinkSync(lockFile);
  }
}

/**
 * Check current lock status
 *
 * Returns information about existing lock, or null if no lock exists.
 * Automatically cleans up stale locks.
 *
 * @param directory - Project directory to check
 * @param options - Lock scope options
 * @returns Lock information or null
 */
export async function checkLock(directory: string, options: LockOptions = {}): Promise<LockInfo | null> {
  const lockFile = getLockFilePath(directory, options);

  if (!existsSync(lockFile)) {
    return null;
  }

  try {
    const lockData = JSON.parse(readFileSync(lockFile, 'utf-8')) as LockInfo;

    // Verify process is still running
    if (isProcessRunning(lockData.pid)) {
      return lockData;
    }

    // Stale lock - clean up
    unlinkSync(lockFile);
    return null;
  } catch {
    // Corrupted lock file - clean up
    unlinkSync(lockFile);
    return null;
  }
}

/**
 * Wait for lock to be released
 *
 * Polls the lock file until it's released or timeout is reached.
 * Useful for pre-commit hooks that want to wait for background
 * validation to complete before proceeding.
 *
 * @param directory - Project directory to check
 * @param timeoutSeconds - Maximum time to wait (default: 300 seconds / 5 minutes)
 * @param pollIntervalMs - How often to check lock status (default: 1000ms)
 * @param options - Lock scope options
 * @returns Lock info when released, or null if timeout
 */
export async function waitForLock(
  directory: string,
  timeoutSeconds: number = 300,
  pollIntervalMs: number = 1000,
  options: LockOptions = {},
): Promise<{ released: boolean; timedOut: boolean; finalLock: LockInfo | null }> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (true) {
    const lock = await checkLock(directory, options);

    // Lock released (or never existed)
    if (!lock) {
      return {
        released: true,
        timedOut: false,
        finalLock: null,
      };
    }

    // Check timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      return {
        released: false,
        timedOut: true,
        finalLock: lock,
      };
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
