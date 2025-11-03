/**
 * Process management utilities for validation runner
 *
 * Provides reliable process group cleanup for spawned child processes.
 * Used by validation runner for signal handling and fail-fast behavior.
 */

import { ChildProcess, execSync, spawn } from 'node:child_process';

/**
 * Stop a child process and its entire process group (cross-platform)
 *
 * **Windows Implementation:**
 * - Uses `taskkill /pid <PID> /T /F` to terminate process tree
 * - /T flag kills child processes
 * - /F flag forces termination
 *
 * **Unix Implementation:**
 * - Uses negative PID to kill process group (-PID)
 * - Graceful shutdown: SIGTERM to process group
 * - Force kill after 1s: SIGKILL to process group
 *
 * @param childProcess - The child process to stop
 * @param processName - Optional name for logging (e.g., "TypeScript", "ESLint")
 * @returns Promise that resolves when process is stopped
 *
 * @example
 * ```typescript
 * const proc = spawn('tsc --noEmit', [], { shell: true });
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

      // Platform-specific process termination
      if (process.platform === 'win32') {
        // Windows: Use taskkill to terminate process tree
        // /T - Terminates all child processes
        // /F - Forcefully terminates the process
        try {
          execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
        } catch {
          // Process may already be dead, ignore error
        }
      } else {
        // Unix: Kill process group with negative PID
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
      }

      // Ultimate timeout - resolve after 2 seconds regardless
      setTimeout(() => {
        resolve();
      }, 2000);
    } else {
      resolve();
    }
  });
}

/**
 * Spawn a command with consistent, secure defaults for validation
 *
 * **Key Features:**
 * - **No stdin**: Commands cannot block waiting for user input
 * - **Shell mode**: Supports operators (&&, ||, |) and cross-platform compatibility
 * - **Process groups**: Proper cleanup on Unix (detached mode)
 * - **Captured output**: stdout/stderr piped for extraction
 *
 * **Security:**
 * - Commands from user config files only (same trust as npm scripts)
 * - See SECURITY.md for full threat model
 *
 * @param command - Command string to execute (e.g., "npm test", "tsc --noEmit")
 * @param options - Optional spawn configuration
 * @returns ChildProcess instance for monitoring/cleanup
 *
 * @example
 * ```typescript
 * // Simple command
 * const proc = spawnCommand('npm test');
 *
 * // With custom environment
 * const proc = spawnCommand('npm run build', {
 *   env: { NODE_ENV: 'production' }
 * });
 *
 * // Git command with timeout
 * const proc = spawnCommand('git', {
 *   args: ['fetch', 'origin'],
 *   timeout: 30000
 * });
 * ```
 */
export function spawnCommand(
  command: string,
  options?: {
    /** Command arguments (when command is executable name, not shell string) */
    args?: string[];
    /** Timeout in milliseconds */
    timeout?: number;
    /** Run detached (defaults to true on Unix, false on Windows) */
    detached?: boolean;
    /** Environment variables (merged with process.env) */
    env?: Record<string, string>;
  }
): ChildProcess {
  // SECURITY: shell: true required for shell operators (&&, ||, |) and cross-platform compatibility.
  // Commands from user config files only (same trust as npm scripts). See SECURITY.md for full threat model.
  // NOSONAR - Intentional shell execution of user-defined commands
  return spawn(command, options?.args ?? [], {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'], // No stdin (prevent hangs), capture stdout/stderr
    timeout: options?.timeout,
    // detached: true only on Unix - Windows doesn't pipe stdio correctly when detached
    detached: options?.detached ?? (process.platform !== 'win32'),
    env: options?.env ? { ...process.env, ...options.env } : process.env,
  });
}
