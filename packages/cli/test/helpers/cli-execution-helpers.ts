/**
 * Shared test helpers for executing CLI commands in tests
 *
 * Provides utilities for running CLI commands with proper error handling
 * and output capture.
 *
 * SECURITY: Uses safeExecFromString from @vibe-validate/utils instead of raw execSync
 * to maintain consistency with production code and pass security audits.
 */

import type { ExecSyncOptions } from 'node:child_process';
import { safeExecFromString } from '@vibe-validate/utils';

/**
 * Result from executing a CLI command
 */
export interface CliExecutionResult {
  /** Standard output from the command */
  stdout: string;
  /** Standard error from the command */
  stderr: string;
  /** Exit code (0 for success, non-zero for failure) */
  exitCode: number;
}

/**
 * Executes a CLI command and captures output, handling both success and failure
 *
 * Unlike raw execSync which throws on non-zero exit, this function captures the
 * output regardless of exit code, making it ideal for testing error scenarios.
 *
 * SECURITY: Uses safeExecFromString to prevent command injection vulnerabilities.
 *
 * @param command - Command to execute
 * @param options - Optional execution options (cwd, encoding, etc.)
 * @returns Execution result with stdout, stderr, and exitCode
 *
 * @example
 * ```typescript
 * const result = executeCLI('vv run "echo test"', { cwd: testDir });
 * expect(result.exitCode).toBe(0);
 * expect(result.stdout).toContain('test');
 * ```
 *
 * @example
 * ```typescript
 * // Testing error scenarios
 * const result = executeCLI('vv run "exit 1"');
 * expect(result.exitCode).toBe(1);
 * expect(result.stdout).toBeDefined();
 * ```
 */
export function executeCLI(
  command: string,
  options: Omit<ExecSyncOptions, 'encoding'> = {},
): CliExecutionResult {
  try {
    const stdout = safeExecFromString(command, {
      ...options,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    return {
      stdout: stdout as string,
      stderr: '',
      exitCode: 0,
    };
  } catch (error: any) {
    // safeExecFromString throws on non-zero exit, but we want to capture the output
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exitCode: error.status || 1,
    };
  }
}

/**
 * Executes a CLI command with timeout safeguards
 *
 * Prevents hung child processes by enforcing a timeout and kill signal.
 * Use this for integration tests that spawn real CLI processes.
 *
 * @param command - Command to execute
 * @param options - Optional options (cwd, timeout, etc.)
 * @returns Execution result with stdout, stderr, and exitCode
 *
 * @example
 * ```typescript
 * const result = executeCLIWithTimeout('vv doctor', {
 *   cwd: testDir,
 *   timeout: 15000, // 15 seconds
 * });
 * expect(result.exitCode).toBe(0);
 * ```
 */
export function executeCLIWithTimeout(
  command: string,
  options: Omit<ExecSyncOptions, 'encoding' | 'killSignal'> & { timeout?: number } = {},
): CliExecutionResult {
  return executeCLI(command, {
    ...options,
    timeout: options.timeout || 15000, // Default 15s timeout
    killSignal: 'SIGTERM', // Ensure child is killed on timeout
  });
}

/**
 * Executes a CLI command and returns only stdout
 *
 * Convenience wrapper for when you only care about stdout.
 * Throws if command fails (non-zero exit).
 *
 * @param command - Command to execute
 * @param options - Optional execSync options
 * @returns Standard output from the command
 *
 * @example
 * ```typescript
 * const output = executeCLIForOutput('vv run "echo test"');
 * expect(output).toContain('test');
 * ```
 */
export function executeCLIForOutput(
  command: string,
  options: Omit<ExecSyncOptions, 'encoding'> = {},
): string {
  const result = executeCLI(command, options);

  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed with exit code ${result.exitCode}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`,
    );
  }

  return result.stdout;
}
