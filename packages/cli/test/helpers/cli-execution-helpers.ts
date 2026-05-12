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
import { rmSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { executeGitCommand } from '@vibe-validate/git';
import { normalizePath, safeExecFromString, normalizedTmpdir, mkdirSyncReal } from '@vibe-validate/utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: error.status ?? 1,
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
    timeout: options.timeout ?? 15000, // Default 15s timeout
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

/**
 * Get the normalized path to a CLI binary for testing
 *
 * Uses normalizePath() from @vibe-validate/utils to ensure Windows compatibility
 * (resolves Windows 8.3 short names like RUNNER~1).
 *
 * @param binary - Which CLI binary to get path for
 * @returns Absolute normalized path to the CLI binary
 *
 * @example
 * ```typescript
 * const vvPath = getCliPath('vv');
 * const result = await executeCommandWithSeparateStreams(vvPath, ['--help']);
 * ```
 */
export function getCliPath(binary: 'vv' | 'vibe-validate'): string {
  return normalizePath(__dirname, `../../dist/bin/${binary}`);
}

/**
 * Helper function to execute CLI commands with separate stdout/stderr streams
 * Reduces code duplication between executeVvCommand and executeVibeValidateCommand
 *
 * @param binary - Which CLI binary to execute
 * @param args - Arguments to pass to the CLI
 * @param options - Execution options
 * @returns Promise resolving to execution result
 */
async function executeCliCommand(
  binary: 'vv' | 'vibe-validate',
  args: string[],
  options: { cwd?: string; timeout?: number; env?: Record<string, string> } = {},
): Promise<CliExecutionResult & { output: string }> {
  const { executeCommandWithSeparateStreams } = await import('./test-command-runner.js');
  const cliPath = getCliPath(binary);
  return executeCommandWithSeparateStreams(cliPath, args, options);
}

/**
 * Execute the vv CLI with arguments (spawn-based for separate stdout/stderr)
 *
 * This is a convenience wrapper that automatically resolves the vv binary path
 * and uses spawn for cross-platform execution.
 *
 * @param args - Arguments to pass to vv
 * @param options - Execution options
 * @returns Promise resolving to execution result
 *
 * @example
 * ```typescript
 * const result = await executeVvCommand(['watch-pr', '123'], { cwd: testDir });
 * expect(result.exitCode).toBe(0);
 * ```
 */
export async function executeVvCommand(
  args: string[],
  options: { cwd?: string; timeout?: number; env?: Record<string, string> } = {},
): Promise<CliExecutionResult & { output: string }> {
  return executeCliCommand('vv', args, options);
}

/**
 * Execute the vibe-validate CLI with arguments (spawn-based for separate stdout/stderr)
 *
 * This is a convenience wrapper that automatically resolves the vibe-validate binary path
 * and uses spawn for cross-platform execution.
 *
 * @param args - Arguments to pass to vibe-validate
 * @param options - Execution options
 * @returns Promise resolving to execution result
 *
 * @example
 * ```typescript
 * const result = await executeVibeValidateCommand(['doctor'], { cwd: testDir });
 * expect(result.exitCode).toBe(0);
 * ```
 */
export async function executeVibeValidateCommand(
  args: string[],
  options: { cwd?: string; timeout?: number; env?: Record<string, string> } = {},
): Promise<CliExecutionResult & { output: string }> {
  return executeCliCommand('vibe-validate', args, options);
}

/**
 * Execute CLI command and return combined stdout+stderr output
 *
 * Convenience wrapper for tests that just need the combined output string.
 * Uses proper CLI execution helpers for cross-platform compatibility.
 *
 * @param args - CLI arguments
 * @param options - Execution options
 * @returns Combined stdout and stderr output
 *
 * @example
 * ```typescript
 * const output = await executeVibeValidateCombined(['init', '--dry-run'], { cwd: testDir });
 * expect(output).toContain('Configuration preview');
 * ```
 */
export async function executeVibeValidateCombined(
  args: string[],
  options?: { cwd?: string; timeout?: number; env?: Record<string, string> }
): Promise<string> {
  const result = await executeVibeValidateCommand(args, options);
  return result.stdout + result.stderr;
}

/**
 * Execute CLI command and return separated stdout/stderr with exit code
 *
 * Use this for tests that need to check specific streams or exit codes.
 * Uses proper CLI execution helpers for cross-platform compatibility.
 *
 * @param args - CLI arguments
 * @param options - Execution options
 * @returns Object with stdout, stderr, and exitCode
 *
 * @example
 * ```typescript
 * const result = await executeVibeValidateWithError(['init'], { cwd: testDir });
 * expect(result.exitCode).toBe(1);
 * expect(result.stderr).toContain('already exists');
 * ```
 */
export async function executeVibeValidateWithError(
  args: string[],
  options?: { cwd?: string; timeout?: number; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await executeVibeValidateCommand(args, options);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}

/**
 * Create a temporary test directory with Windows-safe path handling
 *
 * Creates a unique temporary directory for test isolation.
 * Returns the normalized path (resolves Windows 8.3 short names).
 *
 * @param prefix - Directory name prefix (e.g., 'vibe-validate-test')
 * @returns Normalized path to the created directory
 *
 * @example
 * ```typescript
 * let testDir: string;
 * beforeEach(() => {
 *   testDir = setupTestDir('my-test');
 * });
 * afterEach(() => {
 *   cleanupTestDir(testDir);
 * });
 * ```
 */
export function setupTestDir(prefix: string): string {
  const tmpBase = normalizedTmpdir();
  const targetDir = join(tmpBase, `${prefix}-${Date.now()}`);
  return mkdirSyncReal(targetDir, { recursive: true });
}

/**
 * Create a temporary test directory pre-initialized as a minimal git repo.
 *
 * Initializes `main` branch and configures a dummy user.email / user.name so
 * subsequent `git commit` calls succeed in CI environments that lack a global
 * git identity. The returned directory is a normal `setupTestDir` output, so
 * `cleanupTestDir` cleans it up as usual.
 *
 * If `options.files` is provided, the files are written, staged, and
 * committed as an initial commit (so the repo has a tree hash that vv can
 * resolve). Use `options.commitMessage` to override the default message.
 *
 * @param prefix - Directory name prefix
 * @param options - Optional initial files to commit
 * @returns Normalized path to the created git repo
 */
export function setupTestGitRepo(
  prefix: string,
  options?: { files?: Record<string, string>; commitMessage?: string },
): string {
  const testDir = setupTestDir(prefix);
  executeGitCommand(['-C', testDir, 'init', '-b', 'main'], { suppressStderr: true });
  executeGitCommand(['-C', testDir, 'config', 'user.email', 'test@example.com'], { suppressStderr: true });
  executeGitCommand(['-C', testDir, 'config', 'user.name', 'Test'], { suppressStderr: true });

  if (options?.files) {
    for (const [relPath, content] of Object.entries(options.files)) {
      writeFileSync(join(testDir, relPath), content);
    }
    executeGitCommand(['-C', testDir, 'add', '.'], { suppressStderr: true });
    executeGitCommand(
      ['-C', testDir, 'commit', '-m', options.commitMessage ?? 'init'],
      { suppressStderr: true },
    );
  }
  return testDir;
}

/**
 * Absolute path to the built CLI bin (`packages/cli/dist/bin.js`).
 *
 * Resolved relative to this helper file so it works regardless of which
 * integration test imports it. Used by `executeCommandWithSeparateStreams`
 * and `executeWrapperCommand` callers that spawn the real CLI.
 */
export const cliBinPath = join(__dirname, '../../dist/bin.js');

/**
 * Clean up a temporary test directory
 *
 * Safely removes a test directory and all its contents.
 * Safe to call even if directory doesn't exist.
 *
 * @param testDir - Directory to remove
 *
 * @example
 * ```typescript
 * afterEach(() => {
 *   cleanupTestDir(testDir);
 * });
 * ```
 */
export function cleanupTestDir(testDir: string): void {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}
