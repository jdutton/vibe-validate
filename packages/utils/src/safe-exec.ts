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
 * ## Security Context
 *
 * This package's primary security model is `shell: false` to prevent command injection.
 * Windows requires `shell: true` only for shell scripts (.cmd/.bat/.ps1) which require
 * a shell interpreter by design (not executable binaries).
 *
 * ## Node.js on Windows - NO SHELL REQUIRED
 *
 * **Previous behavior (REMOVED):** Used shell:true for 'node' command
 * **Problem discovered:** Node.js DEP0190 deprecation warning - passing args array with
 * shell:true leads to incorrect command execution. Exit codes are ignored (always returns 0).
 *
 * **Testing shows:**
 * - ✅ `shell: false` + absolute path from `which.sync('node')` → Works correctly
 * - ❌ `shell: true` + args array → Exit codes ignored, security warning
 *
 * **Root Cause of Previous ENOENT Issues:** Likely resolved in newer Node.js versions.
 * Current testing (Node 20+) shows shell:false works correctly with absolute path.
 *
 * ## Why This Is Secure
 *
 * 1. **Minimal Shell Usage:** Shell only used for .cmd/.bat/.ps1 files (required)
 * 2. **Path Validation:** Command paths resolved via `which.sync()` before execution
 * 3. **Array-Based Arguments:** Arguments passed as array, preventing injection
 * 4. **Controlled Environment:** Commands from trusted configuration, not user input
 * 5. **No String Interpolation:** Never concatenate user input into command strings
 *
 * ## References
 *
 * - Node.js deprecation: https://nodejs.org/api/deprecations.html#DEP0190
 * - Security tests: `packages/utils/test/safe-exec.test.ts`
 * - Windows fix: PR #94 (fix/windows-shell-independence-v2)
 *
 * @param commandPath - Resolved absolute path to command
 * @returns true if shell should be used, false otherwise
 */
function shouldUseShell(commandPath: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  // Node.js deprecation warning (DEP0190): Passing args with shell:true leads to incorrect
  // command execution and security vulnerabilities. Testing shows shell:false works correctly
  // with absolute path from which.sync('node') on Windows.
  // Previous ENOENT issues may have been resolved in newer Node.js versions.
  //
  // REMOVED: if (command === 'node') return true;
  // Reason: shell:true causes exit codes to be ignored (always returns 0)
  // Fix: Use shell:false with absolute path - works correctly

  // Windows shell scripts require shell by design (case-insensitive check)
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
  const useShell = shouldUseShell(commandPath);

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
    const useShell = shouldUseShell(commandPath);

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
 * Shell syntax character sets for hyper-efficient single-pass detection
 *
 * Used by hasShellSyntax() and safeExecFromString() for shift-left validation.
 *
 * Performance: O(n) single pass with O(1) Set lookups - no regex backtracking.
 */
const QUOTE_CHARS = new Set(['"', "'", '`']);
const GLOB_CHARS = new Set(['*', '?', '[', ']']);
const OPERATOR_CHARS = new Set(['|', '>', '<', '&', ';']);

/**
 * Metadata for each shell syntax type (used for error messages)
 */
const SHELL_SYNTAX_METADATA = {
  quotes: { name: 'quotes', example: 'echo "hello"' },
  globs: { name: 'glob patterns', example: 'ls *.txt' },
  variables: { name: 'variable expansion', example: 'echo $HOME' },
  operators: { name: 'pipes/redirects/operators', example: 'cat file | grep text' },
} as const;

/**
 * Check if a command string contains shell-specific syntax
 *
 * Detects patterns that require shell interpretation:
 * - Quotes (", ', `)
 * - Glob patterns (*, ?, [])
 * - Variable expansion ($)
 * - Pipes/redirects/operators (|, >, <, &, ;, &&, ||)
 *
 * Performance: Single-pass O(n) algorithm with O(1) Set lookups.
 * Short-circuits on first match (no backtracking, no regex overhead).
 *
 * @param commandString - Command string to check
 * @returns Object with detection result and details
 *
 * @example
 * ```typescript
 * const check1 = hasShellSyntax('npm test');
 * console.log(check1); // { hasShellSyntax: false }
 *
 * const check2 = hasShellSyntax('npm test && npm run build');
 * console.log(check2);
 * // {
 * //   hasShellSyntax: true,
 * //   pattern: 'pipes/redirects/operators',
 * //   example: 'cat file | grep text'
 * // }
 * ```
 */
export function hasShellSyntax(commandString: string): {
  hasShellSyntax: boolean;
  pattern?: string;
  example?: string;
} {
  // Single-pass check with early return on first match
  for (const char of commandString) {

    // Check quotes: " ' `
    if (QUOTE_CHARS.has(char)) {
      return {
        hasShellSyntax: true,
        pattern: SHELL_SYNTAX_METADATA.quotes.name,
        example: SHELL_SYNTAX_METADATA.quotes.example,
      };
    }

    // Check glob patterns: * ? [ ]
    if (GLOB_CHARS.has(char)) {
      return {
        hasShellSyntax: true,
        pattern: SHELL_SYNTAX_METADATA.globs.name,
        example: SHELL_SYNTAX_METADATA.globs.example,
      };
    }

    // Check variable expansion: $
    if (char === '$') {
      return {
        hasShellSyntax: true,
        pattern: SHELL_SYNTAX_METADATA.variables.name,
        example: SHELL_SYNTAX_METADATA.variables.example,
      };
    }

    // Check operators: | > < & ;
    if (OPERATOR_CHARS.has(char)) {
      return {
        hasShellSyntax: true,
        pattern: SHELL_SYNTAX_METADATA.operators.name,
        example: SHELL_SYNTAX_METADATA.operators.example,
      };
    }
  }

  return { hasShellSyntax: false };
}

/**
 * Execute a command from a simple command string (convenience wrapper)
 *
 * **IMPORTANT: Shift-Left Validation** - This function actively rejects shell syntax
 * to prevent subtle bugs where shell features are expected but not executed.
 *
 * **Supported:**
 * - Simple commands: `git status`, `pnpm test`, `node --version`
 * - Commands with flags: `git log --oneline --max-count 10`
 * - Multiple unquoted arguments: `gh pr view 123`
 *
 * **NOT Supported (will throw error):**
 * - Quotes: `echo "hello world"` ❌
 * - Glob patterns: `ls *.txt` ❌
 * - Variable expansion: `echo $HOME` ❌
 * - Pipes/redirects: `cat file | grep text` ❌
 * - Command chaining: `build && test` ❌
 *
 * **Why these restrictions?**
 * We don't use a shell interpreter (for security), so shell features like
 * glob expansion, variable substitution, and pipes don't work. By detecting
 * and rejecting these patterns, we force you to use the safer `safeExecSync()`
 * API with explicit argument arrays.
 *
 * @param commandString - Simple command string (no shell syntax)
 * @param options - Execution options
 * @returns Command output (Buffer or string depending on encoding option)
 * @throws Error if command contains shell-specific syntax
 *
 * @example
 * ```typescript
 * // ✅ Simple commands (these work)
 * safeExecFromString('git status');
 * safeExecFromString('pnpm test --watch');
 * safeExecFromString('gh pr view 123');
 * ```
 *
 * @example
 * ```typescript
 * // ❌ Shell syntax (these throw errors)
 * safeExecFromString('echo "hello"');         // Quotes
 * safeExecFromString('ls *.txt');             // Glob pattern
 * safeExecFromString('cat file | grep text'); // Pipe
 * safeExecFromString('echo $HOME');           // Variable expansion
 *
 * // ✅ Use safeExecSync() instead with explicit arguments
 * safeExecSync('echo', ['hello']);
 * safeExecSync('ls', ['file1.txt', 'file2.txt']); // Or use glob library
 * safeExecSync('grep', ['text', 'file']);
 * safeExecSync('echo', [process.env.HOME || '']);
 * ```
 *
 */
export function safeExecFromString(
  commandString: string,
  options: SafeExecOptions = {}
): Buffer | string {
  // Detect shell-specific syntax (shift-left validation)
  // This prevents subtle bugs where shell features are expected but not executed
  const check = hasShellSyntax(commandString);
  if (check.hasShellSyntax) {
    throw new Error(
      `safeExecFromString does not support ${check.pattern ?? 'shell syntax'}.\n` +
        `Found in: ${commandString}\n\n` +
        `Use safeExecSync() with explicit argument array instead:\n` +
        `  // Bad: safeExecFromString('${check.example ?? commandString}')\n` +
        `  // Good: safeExecSync('command', ['arg1', 'arg2'], options)\n\n` +
        `This ensures no shell interpreter is used and arguments are explicit.`
    );
  }

  const parts = commandString.trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);

  return safeExecSync(command, args, options);
}
