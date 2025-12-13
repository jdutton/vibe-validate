/**
 * Process management utilities for validation runner
 *
 * Provides reliable process group cleanup for spawned child processes.
 * Used by validation runner for signal handling and fail-fast behavior.
 */

import { ChildProcess, spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getRepositoryRoot, safeExecSync } from '@vibe-validate/git';
import type { CapturedOutput, OutputLine } from './output-capture-schema.js';
import { ensureDir, createLogFileWrite, createCombinedJsonl } from './fs-utils.js';

/**
 * Get git repository root directory
 *
 * @returns Absolute path to git root, or null if not in a git repository
 */
export function getGitRoot(): string | null {
  try {
    return getRepositoryRoot();
  } catch {
    return null;
  }
}

/**
 * Resolve working directory relative to git root
 *
 * @param cwd - Working directory path (relative to git root)
 * @returns Absolute path to working directory
 * @throws Error if cwd escapes git root (security) or not in git repo
 */
export function resolveGitRelativePath(cwd: string): string {
  const gitRoot = getGitRoot();
  if (!gitRoot) {
    throw new Error('Not in a git repository - cannot resolve cwd relative to git root');
  }

  const resolved = resolve(gitRoot, cwd);

  // Security: Prevent directory traversal outside git root
  if (!resolved.startsWith(gitRoot)) {
    throw new Error(`Invalid cwd: "${cwd}" - must be within git repository`);
  }

  return resolved;
}

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
          safeExecSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
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
    /** Working directory (defaults to current directory) */
    cwd?: string;
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
    cwd: options?.cwd,
  });
}

/**
 * Strip ANSI escape codes from text
 *
 * @param text - Text with ANSI codes
 * @returns Clean text without ANSI codes
 */
function stripAnsiCodes(text: string): string {
  // Control character \x1b is intentionally used to match ANSI escape codes
  // eslint-disable-next-line no-control-regex, sonarjs/no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Options for capturing command output
 */
export interface CaptureCommandOptions {
  /** Command to execute */
  command: string;
  /** Output directory for log files */
  outputDir: string;
  /** Command arguments (optional) */
  args?: string[];
  /** Timeout in milliseconds (optional) */
  timeout?: number;
  /** Environment variables (optional) */
  env?: Record<string, string>;
}

/**
 * Capture command output with organized file structure
 *
 * Executes a command and captures stdout/stderr with proper separation:
 * - stdout.log: Raw stdout with ANSI codes (omitted if empty)
 * - stderr.log: Raw stderr with ANSI codes (omitted if empty)
 * - combined.jsonl: Chronological output with ANSI codes stripped
 *
 * @param options - Capture options
 * @returns Captured output with file paths
 *
 * @example
 * ```typescript
 * const output = await captureCommandOutput({
 *   command: 'npm test',
 *   outputDir: '/tmp/vibe-validate/runs/2025-11-05/abc123-17-30-45'
 * });
 *
 * console.log(output.exitCode); // 0 or 1
 * console.log(output.stdout.file); // Path to stdout.log (if non-empty)
 * console.log(output.combined.file); // Path to combined.jsonl
 * ```
 */
export async function captureCommandOutput(
  options: CaptureCommandOptions
): Promise<CapturedOutput> {
  const { command, outputDir, args, timeout, env } = options;

  const startTime = Date.now();
  const combinedLines: OutputLine[] = [];
  let stdoutRaw = '';
  let stderrRaw = '';

  // Spawn the command
  const proc = spawnCommand(command, { args, timeout, env });

  // Capture stdout
  proc.stdout?.on('data', (data: Buffer) => {
    const chunk = data.toString();
    stdoutRaw += chunk;

    // Add to combined output (ANSI-stripped)
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line) {
        combinedLines.push({
          ts: new Date().toISOString(),
          stream: 'stdout',
          line: stripAnsiCodes(line),
        });
      }
    }
  });

  // Capture stderr
  proc.stderr?.on('data', (data: Buffer) => {
    const chunk = data.toString();
    stderrRaw += chunk;

    // Add to combined output (ANSI-stripped)
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line) {
        combinedLines.push({
          ts: new Date().toISOString(),
          stream: 'stderr',
          line: stripAnsiCodes(line),
        });
      }
    }
  });

  // Wait for process to complete
  const exitCode = await new Promise<number>((resolve) => {
    proc.on('close', (code) => {
      resolve(code ?? 1);
    });

    proc.on('error', () => {
      resolve(1);
    });
  });

  const endTime = Date.now();
  const durationSecs = (endTime - startTime) / 1000;

  // Ensure output directory exists
  await ensureDir(outputDir);

  // Write output files using shared utilities
  const writePromises: Promise<void>[] = [];

  // Write stdout.log (only if non-empty)
  const { file: stdoutFile, promise: stdoutPromise } =
    createLogFileWrite(stdoutRaw, outputDir, 'stdout.log');
  if (stdoutPromise) writePromises.push(stdoutPromise);

  // Write stderr.log (only if non-empty)
  const { file: stderrFile, promise: stderrPromise } =
    createLogFileWrite(stderrRaw, outputDir, 'stderr.log');
  if (stderrPromise) writePromises.push(stderrPromise);

  // Write combined.jsonl (always)
  const combinedFile = join(outputDir, 'combined.jsonl');
  const combinedContent = createCombinedJsonl(combinedLines);
  writePromises.push(writeFile(combinedFile, combinedContent, 'utf-8'));

  // Wait for all writes to complete
  await Promise.all(writePromises);

  return {
    stdout: {
      raw: stdoutRaw,
      file: stdoutFile,
    },
    stderr: {
      raw: stderrRaw,
      file: stderrFile,
    },
    combined: {
      lines: combinedLines,
      file: combinedFile,
    },
    exitCode,
    durationSecs,
  };
}
