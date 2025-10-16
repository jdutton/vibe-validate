/**
 * Process management utilities for validation runner
 *
 * Provides reliable process group cleanup for spawned child processes.
 * Used by validation runner for signal handling and fail-fast behavior.
 */

import { ChildProcess } from 'child_process';

/**
 * Stop a child process and its entire process group
 *
 * Uses negative PID to kill process group, ensuring all children are terminated.
 *
 * **Implementation:**
 * - Graceful shutdown: SIGTERM to process group (-PID)
 * - Force kill after 1s: SIGKILL to process group
 * - Ultimate timeout: Resolves after 2s regardless
 *
 * @param childProcess - The child process to stop
 * @param processName - Optional name for logging (e.g., "TypeScript", "ESLint")
 * @returns Promise that resolves when process is stopped
 *
 * @example
 * ```typescript
 * const proc = spawn('tsc', ['--noEmit']);
 * await stopProcessGroup(proc, 'TypeScript');
 * ```
 */
export async function stopProcessGroup(
  childProcess: ChildProcess,
  processName: string = 'Process'
): Promise<void> {
  return new Promise((resolve) => {
    if (!childProcess.killed && childProcess.pid) {
      const pid = childProcess.pid;

      childProcess.on('exit', () => {
        console.log(`🛑 ${processName} stopped`);
        resolve();
      });

      // Kill the entire process group by negating the PID
      // This kills the process and all its children
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        // Process may already be dead, ignore error
      }

      // Force kill entire process group after 1 second if not stopped
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // Process may already be dead, ignore error
        }
      }, 1000);

      // Ultimate timeout - resolve after 2 seconds regardless
      setTimeout(() => {
        resolve();
      }, 2000);
    } else {
      resolve();
    }
  });
}
