import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

import which from 'which';

/**
 * Options for safe command execution
 */
export interface SafeExecOptions {
  /** Character encoding for output (default: undefined = Buffer) */
  encoding?: BufferEncoding;
  /** Standard I/O configuration */
  stdio?: 'pipe' | 'ignore' | Array<'pipe' | 'ignore' | 'inherit'>;
  /** Environment variables (merged with process.env if not fully specified) */
  env?: NodeJS.ProcessEnv;
  /** Working directory */
  cwd?: string;
  /** Maximum output buffer size in bytes */
  maxBuffer?: number;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Result of a safe command execution
 */
export interface SafeExecResult {
  /** Exit code (0 = success) */
  status: number;
  /** Standard output */
  stdout: Buffer | string;
  /** Standard error */
  stderr: Buffer | string;
  /** Error object if command failed to spawn */
  error?: Error;
}

/**
 * Error thrown when command execution fails
 */
export class CommandExecutionError extends Error {
  public readonly status: number;
  public readonly stdout: Buffer | string;
  public readonly stderr: Buffer | string;

  constructor(
    message: string,
    status: number,
    stdout: Buffer | string,
    stderr: Buffer | string,
  ) {
    super(message);
    this.name = 'CommandExecutionError';
    this.status = status;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * Determine if shell should be used for command execution on Windows
 *
 * CONFIRMED NECESSARY: Windows requires shell:true for:
 * 1. node command (ENOENT with shell:false even with full path)
 * 2. .cmd/.bat/.ps1 scripts (Windows shell scripts require shell interpreter)
 *
 * This is safe because paths are validated by which.sync() before execution.
 *
 * @param command - Command name (e.g., 'node', 'pnpm')
 * @param commandPath - Resolved absolute path to command
 * @returns true if shell should be used, false otherwise
 */
function shouldUseShell(command: string, commandPath: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  // Node command requires shell on Windows
  if (command === 'node') {
    return true;
  }

  // Windows shell scripts require shell (case-insensitive check)
  const lowerPath = commandPath.toLowerCase();
  return lowerPath.endsWith('.cmd') || lowerPath.endsWith('.bat') || lowerPath.endsWith('.ps1');
}

/**
 * Safe command execution using spawnSync + which pattern
 *
 * More secure than execSync:
 * - Resolves PATH once using pure Node.js (which package)
 * - Executes with absolute path and shell: false
 * - No shell interpreter = no command injection risk
 * - Supports custom env vars (e.g., GIT_INDEX_FILE)
 *
 * @param command - Command name (e.g., 'git', 'gitleaks', 'node')
 * @param args - Array of arguments
 * @param options - Execution options
 * @returns Buffer or string output
 * @throws Error if command not found or execution fails
 *
 * @example
 * // Tool detection
 * safeExecSync('gitleaks', ['--version'], { stdio: 'ignore' });
 *
 * @example
 * // Git with custom env
 * safeExecSync('git', ['add', '--all'], {
 *   env: { ...process.env, GIT_INDEX_FILE: tempFile }
 * });
 *
 * @example
 * // Get output as string
 * const version = safeExecSync('node', ['--version'], { encoding: 'utf8' });
 */
export function safeExecSync(
  command: string,
  args: string[] = [],
  options: SafeExecOptions = {},
): Buffer | string {
  // Resolve command path using which (pure Node.js, no shell)
  const commandPath = which.sync(command);

  // Determine if shell is needed (Windows-specific logic)
  const useShell = shouldUseShell(command, commandPath);

  const spawnOptions: SpawnSyncOptions = {
    shell: useShell, // shell:true on Windows for node and shell scripts, shell:false otherwise for security
    stdio: options.stdio ?? 'pipe',
    env: options.env,
    cwd: options.cwd,
    maxBuffer: options.maxBuffer,
    timeout: options.timeout,
    encoding: options.encoding,
  };

  // Execute with absolute path (or command name if using shell on Windows)
  // When shell:true, use command name so shell can resolve it properly
  const execCommand = useShell ? command : commandPath;
  const result = spawnSync(execCommand, args, spawnOptions);

  // Check for spawn errors
  if (result.error) {
    throw result.error;
  }

  // Check exit code
  if (result.status !== 0) {
    throw new CommandExecutionError(
      `Command failed with exit code ${result.status ?? 'unknown'}: ${command} ${args.join(' ')}`,
      result.status ?? -1,
      result.stdout,
      result.stderr,
    );
  }

  return result.stdout;
}

/**
 * Safe command execution that returns detailed result (doesn't throw)
 *
 * Use this when you need to handle errors programmatically
 * instead of catching exceptions.
 *
 * @param command - Command name (e.g., 'git', 'node')
 * @param args - Array of arguments
 * @param options - Execution options
 * @returns Detailed execution result
 *
 * @example
 * const result = safeExecResult('git', ['status']);
 * if (result.status === 0) {
 *   console.log(result.stdout.toString());
 * } else {
 *   console.error(`Failed: ${result.stderr.toString()}`);
 * }
 */
export function safeExecResult(
  command: string,
  args: string[] = [],
  options: SafeExecOptions = {},
): SafeExecResult {
  try {
    const commandPath = which.sync(command);

    // Determine if shell is needed (Windows-specific logic)
    const useShell = shouldUseShell(command, commandPath);

    const spawnOptions: SpawnSyncOptions = {
      shell: useShell,
      stdio: options.stdio ?? 'pipe',
      env: options.env,
      cwd: options.cwd,
      maxBuffer: options.maxBuffer,
      timeout: options.timeout,
      encoding: options.encoding,
    };

    // When shell:true, use command name so shell can resolve it properly
    const execCommand = useShell ? command : commandPath;
    const result = spawnSync(execCommand, args, spawnOptions);

    return {
      status: result.status ?? -1,
      stdout: result.stdout ?? Buffer.from(''),
      stderr: result.stderr ?? Buffer.from(''),
      error: result.error,
    };
  } catch (error) {
    // which.sync throws if command not found
    return {
      status: -1,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Check if a command-line tool is available
 *
 * @param toolName - Name of tool to check (e.g., 'gh', 'gitleaks', 'node')
 * @returns true if tool is available, false otherwise
 *
 * @example
 * if (isToolAvailable('gh')) {
 *   console.log('GitHub CLI is installed');
 * }
 */
export function isToolAvailable(toolName: string): boolean {
  try {
    safeExecSync(toolName, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get tool version if available
 *
 * @param toolName - Name of tool (e.g., 'node', 'pnpm')
 * @param versionArg - Argument to get version (default: '--version')
 * @returns Version string or null if not available
 *
 * @example
 * const nodeVersion = getToolVersion('node');
 * console.log(nodeVersion); // "v20.11.0"
 *
 * @example
 * const gitVersion = getToolVersion('git', 'version');
 * console.log(gitVersion); // "git version 2.39.2"
 */
export function getToolVersion(
  toolName: string,
  versionArg: string = '--version',
): string | null {
  try {
    const version = safeExecSync(toolName, [versionArg], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return (version as string).trim();
  } catch {
    return null;
  }
}

/**
 * Execute a command from a command string (convenience wrapper)
 *
 * **WARNING**: This function parses command strings using simple whitespace splitting.
 * It does NOT handle shell quoting, escaping, or complex command syntax.
 * Use only for simple commands like "gitleaks protect --staged --verbose".
 *
 * For complex commands with quoted arguments, pipes, or shell features,
 * use `safeExecSync()` directly with an explicit args array.
 *
 * @param commandString - Command string to execute (e.g., "git status --short")
 * @param options - Execution options
 * @returns Command output (Buffer or string depending on encoding option)
 *
 * @example
 * ```typescript
 * // Simple command with flags
 * safeExecFromString('gitleaks protect --staged --verbose');
 *
 * // Multiple arguments
 * safeExecFromString('gh pr view --json number,title');
 * ```
 *
 * @example
 * ```typescript
 * // ❌ DON'T: Complex shell features won't work
 * safeExecFromString('cat file.txt | grep "error"'); // Pipe ignored
 * safeExecFromString('echo "hello world"'); // Quotes not parsed correctly
 *
 * // ✅ DO: Use safeExecSync directly for these cases
 * safeExecSync('grep', ['error', 'file.txt']);
 * safeExecSync('echo', ['hello world']);
 * ```
 */
export function safeExecFromString(
  commandString: string,
  options: SafeExecOptions = {}
): Buffer | string {
  const parts = commandString.trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);

  return safeExecSync(command, args, options);
}
