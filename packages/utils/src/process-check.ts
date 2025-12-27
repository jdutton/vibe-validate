import { safeExecSync } from './safe-exec.js';

/**
 * Check if PID matches in Windows tasklist output
 *
 * Parses tasklist output line and extracts PID from second column.
 * Avoids false positives from partial string matching.
 *
 * @param line - Single line from tasklist output
 * @param pid - Target PID to match
 * @returns true if line contains matching PID in correct column
 */
function matchesPidInTasklist(line: string, pid: number): boolean {
  // Skip empty lines and error messages
  if (!line.trim() || line.includes('INFO:')) {
    return false;
  }

  // Split by whitespace and extract second column (PID)
  const columns = line.trim().split(/\s+/);
  if (columns.length >= 2) {
    const linePid = Number.parseInt(columns[1], 10);
    return linePid === pid;
  }

  return false;
}

/**
 * Check if a process is currently running (Windows implementation)
 *
 * Uses tasklist command to check process existence.
 * Parses output correctly to avoid false positives from partial PID matches.
 *
 * @param pid - Process ID to check
 * @returns true if process is running, false otherwise
 */
function isProcessRunningWindows(pid: number): boolean {
  try {
    const result = safeExecSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
      encoding: 'utf8',
    }) as string;

    // Parse tasklist output format (columns separated by whitespace):
    // Image Name                     PID Session Name        Session#    Mem Usage
    // node.exe                    12345 Console                    1     45,678 K
    const lines = result.split('\n');
    return lines.some((line: string) => matchesPidInTasklist(line, pid));
  } catch {
    // Command failed (process not found or tasklist unavailable)
    return false;
  }
}

/**
 * Check if a process is currently running (Unix/Mac implementation)
 *
 * Uses process.kill(pid, 0) which checks process existence without sending a signal.
 *
 * @param pid - Process ID to check
 * @returns true if process is running, false otherwise
 */
function isProcessRunningUnix(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true; // Process exists (no error thrown)
  } catch (err) {
    // EPERM = process exists but no permission (still running)
    // EACCES = permission denied (similar to EPERM on some platforms)
    // ESRCH = process does not exist
    // Other errors = treat as not running
    const error = err as NodeJS.ErrnoException;
    return error.code === 'EPERM' || error.code === 'EACCES';
  }
}

/**
 * Check if a process is currently running
 *
 * Cross-platform implementation:
 * - Windows: Uses `tasklist /FI "PID eq ${pid}" /NH` command
 * - Unix/Mac: Uses `process.kill(pid, 0)` (signal 0 = check existence only)
 *
 * Security: Uses safeExecSync for Windows (no shell injection risk)
 *
 * @param pid - Process ID to check
 * @returns true if process is running, false otherwise
 *
 * @example
 * ```typescript
 * // Check if process exists
 * if (isProcessRunning(12345)) {
 *   console.log('Process 12345 is running');
 * }
 *
 * // Check current process (always returns true)
 * if (isProcessRunning(process.pid)) {
 *   console.log('Current process is running');
 * }
 * ```
 */
export function isProcessRunning(pid: number): boolean {
  return process.platform === 'win32'
    ? isProcessRunningWindows(pid)
    : isProcessRunningUnix(pid);
}
