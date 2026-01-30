/**
 * Test Command Runner - Shared utilities for executing CLI commands in tests
 *
 * Eliminates duplication of execSync try/catch patterns across test files.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { safeExecSync } from '@vibe-validate/utils';
import yaml from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Check if a character is a quote character
 */
function isQuoteChar(char: string): boolean {
  return char === '"' || char === "'";
}

/**
 * Process a quote character and return updated state
 */
function processQuote(
  char: string,
  currentlyInQuotes: boolean,
  currentQuoteChar: string
): { inQuotes: boolean; quoteChar: string; addChar: boolean } {
  if (!currentlyInQuotes) {
    // Starting a quoted section
    return { inQuotes: true, quoteChar: char, addChar: false };
  }

  if (char === currentQuoteChar) {
    // Ending the quoted section
    return { inQuotes: false, quoteChar: '', addChar: false };
  }

  // Different quote type while inside quotes - treat as literal
  return { inQuotes: true, quoteChar: currentQuoteChar, addChar: true };
}

/**
 * Process a single character during command parsing
 *
 * CRITICAL FIX (Issue #86): Only escape quotes and backslashes, not all characters.
 * This prevents Windows paths (C:\Users\...) from being mangled by escape processing.
 *
 * Example problem before fix:
 * - Input: node "C:\Users\test\bin.js"
 * - After parsing: node "C:Userstestbin.js" (backslashes consumed!)
 * - Node error: Cannot find module 'C:Userstestbin.js'
 *
 * After fix:
 * - Input: node "C:\Users\test\bin.js"
 * - After parsing: node "C:\Users\test\bin.js" (backslashes preserved)
 * - Works correctly on Windows
 */
function processCommandChar(
  char: string,
  prevChar: string,
  state: { current: string; parts: string[]; inQuotes: boolean; quoteChar: string; i: number },
  commandString: string
): { skipExtra: number } {
  // Handle escape sequences - only escape quotes and backslashes
  // This prevents Windows paths (C:\Users\...) from being mangled
  if (char === '\\' && state.i + 1 < commandString.length) {
    const nextChar = commandString[state.i + 1];
    // Only treat as escape if next char is a quote or backslash
    if (isQuoteChar(nextChar) || nextChar === '\\') {
      state.current += nextChar;
      return { skipExtra: 1 }; // Skip next character
    }
    // Otherwise treat backslash as literal (important for Windows paths!)
  }

  // Handle quotes
  if (isQuoteChar(char) && prevChar !== '\\') {
    const quoteResult = processQuote(char, state.inQuotes, state.quoteChar);
    state.inQuotes = quoteResult.inQuotes;
    state.quoteChar = quoteResult.quoteChar;
    if (quoteResult.addChar) {
      state.current += char;
    }
    return { skipExtra: 0 };
  }

  // Handle space delimiters
  if (char === ' ' && !state.inQuotes) {
    if (state.current) {
      state.parts.push(state.current);
      state.current = '';
    }
    return { skipExtra: 0 };
  }

  // Regular character or space inside quotes
  state.current += char;
  return { skipExtra: 0 };
}

/**
 * Parse a command string into command and arguments
 * Handles quoted strings properly, including nested quotes
 *
 * @param commandString - Command string to parse
 * @returns [command, args[]]
 *
 * @example
 * parseCommand('node bin.js run "echo test"')
 * // Returns: ['node', ['bin.js', 'run', 'echo test']]
 *
 * @example
 * parseCommand('node bin.js run "echo \'nested\'"')
 * // Returns: ['node', ['bin.js', 'run', "echo 'nested'"]]
 */
function parseCommand(commandString: string): [string, string[]] {
  const state = {
    parts: [] as string[],
    current: '',
    inQuotes: false,
    quoteChar: '',
    i: 0,
  };

  while (state.i < commandString.length) {
    const char = commandString[state.i];
    const prevChar = state.i > 0 ? commandString[state.i - 1] : '';

    const result = processCommandChar(char, prevChar, state, commandString);
    state.i += 1 + result.skipExtra;
  }

  if (state.current) {
    state.parts.push(state.current);
  }

  return [state.parts[0], state.parts.slice(1)];
}

export interface CommandResult {
  output: string;
  exitCode: number;
  parsed?: any;
}

export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  encoding?: BufferEncoding;
}

/**
 * Execute a command and capture stdout/stderr
 *
 * @param command - Command to execute
 * @param options - Execution options
 * @returns Command output and exit code
 */
export function executeCommand(
  command: string,
  options: ExecOptions = {}
): CommandResult {
  const execOptions = {
    encoding: options.encoding ?? ('utf-8' as const),
    timeout: options.timeout ?? 60000,
    cwd: options.cwd,
    stdio: 'pipe' as const,
  };

  let output = '';
  let exitCode = 0;

  try {
    const [cmd, args] = parseCommand(command);
    output = safeExecSync(cmd, args, execOptions);
  } catch (err: any) {
    // Combine stdout and stderr for output
    const stdout = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString() ?? '';
    const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString() ?? '';
    output = stdout + stderr;
    exitCode = err.status ?? 1;
  }

  return { output, exitCode };
}

/**
 * Execute a command and parse YAML output
 *
 * @param command - Command to execute
 * @param options - Execution options
 * @returns Command result with parsed YAML
 */
export function executeCommandWithYaml(
  command: string,
  options: ExecOptions = {}
): CommandResult {
  const result = executeCommand(command, options);

  try {
    result.parsed = yaml.parse(result.output);
  } catch (error) { // NOSONAR - YAML parse failures are expected for non-YAML output
    // YAML parse failed - leave parsed undefined (expected for non-YAML output)
    expect(error).toBeDefined();
  }

  return result;
}

/**
 * Execute a command expecting failure
 *
 * @param command - Command to execute
 * @param options - Execution options
 * @returns Command result (exitCode should be non-zero)
 */
export function executeCommandExpectingFailure(
  command: string,
  options: ExecOptions = {}
): CommandResult {
  const result = executeCommand(command, options);

  if (result.exitCode === 0) {
    throw new Error('Command succeeded when failure was expected');
  }

  return result;
}

/**
 * Execute a command expecting success
 *
 * @param command - Command to execute
 * @param options - Execution options
 * @returns Command result (exitCode should be 0)
 */
export function executeCommandExpectingSuccess(
  command: string,
  options: ExecOptions = {}
): CommandResult {
  const result = executeCommand(command, options);

  if (result.exitCode !== 0) {
    throw new Error(`Command failed with exit code ${result.exitCode}: ${result.output}`);
  }

  return result;
}

/**
 * Execute vibe-validate CLI command
 *
 * @param args - CLI arguments (e.g., 'config --validate')
 * @param options - Execution options
 * @returns Command result
 */
export function executeVibeValidateCLI(
  args: string,
  options: ExecOptions = {}
): CommandResult {
  const cliPath = 'node packages/cli/dist/bin.js';
  return executeCommand(`${cliPath} ${args}`, options);
}

/**
 * Extended command result with separate stdout and stderr
 */
export interface CommandResultDetailed extends CommandResult {
  stdout: string;
  stderr: string;
}

/**
 * Synchronous wrapper execution result
 */
export interface WrapperResultSync {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Execute the vv wrapper binary (synchronous)
 *
 * Tests the wrapper's context detection and delegation logic.
 * Use this for simple wrapper tests that don't need async features.
 *
 * @param args - Wrapper arguments (e.g., ['--version'])
 * @param options - Execution options (cwd, env, encoding)
 * @returns Wrapper result with status, stdout, stderr
 *
 * @example
 * ```typescript
 * const result = executeWrapperSync(['--version'], {
 *   cwd: '/tmp/test',
 *   env: { VV_DEBUG: '1' }
 * });
 * expect(result.status).toBe(0);
 * expect(result.stdout).toContain('0.18.0');
 * ```
 */
export function executeWrapperSync(
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string>; encoding?: BufferEncoding } = {}
): WrapperResultSync {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Sync function requires synchronous import
  const { spawnSync } = require('node:child_process');
  const wrapperPath = join(__dirname, '../../dist/bin/vv');

  const result = spawnSync('node', [wrapperPath, ...args], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    encoding: options.encoding ?? 'utf-8',
  });

  return {
    status: result.status,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
  };
}

/**
 * Execute the vv wrapper binary (asynchronous with separate streams)
 *
 * Tests the wrapper's context detection and delegation logic.
 * Use this for advanced wrapper tests that need stream control or signal handling.
 *
 * @param args - Wrapper arguments (e.g., ['watch-pr', '123'])
 * @param options - Execution options (cwd, env, timeout, onSpawn)
 * @returns Command result with exitCode, stdout, stderr
 *
 * @example
 * ```typescript
 * const result = await executeWrapperCommand(['state'], {
 *   cwd: '/tmp/test',
 *   env: { VV_DEBUG: '1' },
 *   timeout: 30000
 * });
 * expect(result.exitCode).toBe(0);
 * expect(result.stdout).toContain('treeHash:');
 * ```
 *
 * @example With signal handling
 * ```typescript
 * const result = await executeWrapperCommand(['watch-pr'], {
 *   onSpawn: (child) => {
 *     setTimeout(() => child.kill('SIGINT'), 100);
 *   }
 * });
 * ```
 */
export async function executeWrapperCommand(
  args: string[] = [],
  options: SpawnOptions = {}
): Promise<CommandResultDetailed> {
  const wrapperPath = join(__dirname, '../../dist/bin/vv');
  return executeCommandWithSeparateStreams(wrapperPath, args, options);
}

/**
 * Options for spawning commands
 */
export interface SpawnOptions extends ExecOptions {
  /**
   * Custom environment variables to merge with process.env
   * If not provided, inherits parent environment by default
   */
  env?: Record<string, string>;
  /**
   * Optional callback invoked immediately after process spawns
   * Receives the child process object for manual control (e.g., sending signals)
   * Useful for testing signal handling or other process lifecycle events
   */
   
  onSpawn?: (child: any) => void;
}

/**
 * Execute a command using spawn and capture stdout/stderr separately
 *
 * Uses spawn('node') for cross-platform compatibility (Windows can't execute
 * files without extensions directly).
 *
 * @param command - Path to script to execute (will be run with node)
 * @param args - Arguments to pass
 * @param options - Execution options
 * @returns Command result with separate stdout and stderr
 *
 * @example
 * ```typescript
 * const result = await executeCommandWithSeparateStreams(
 *   '/path/to/cli.js',
 *   ['watch-pr', '123'],
 *   { cwd: '/tmp/test', timeout: 30000 }
 * );
 * expect(result.stderr).toContain('Error');
 * ```
 *
 * @example Manual process control with onSpawn
 * ```typescript
 * const result = await executeCommandWithSeparateStreams(
 *   '/path/to/cli.js',
 *   ['state'],
 *   {
 *     onSpawn: (child) => {
 *       // Send SIGINT after 100ms to test signal handling
 *       setTimeout(() => child.kill('SIGINT'), 100);
 *     }
 *   }
 * );
 * expect(result.exitCode).toBe(0);
 * ```
 */
export async function executeCommandWithSeparateStreams(
  command: string,
  args: string[],
  options: SpawnOptions = {}
): Promise<CommandResultDetailed> {
  const { spawn } = await import('node:child_process');

  return new Promise((resolve, reject) => {
    const spawnOptions: any = {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: options.cwd,
    };

    // Only add env if custom vars provided, otherwise inherit parent env
    if (options.env) {
      spawnOptions.env = { ...process.env, ...options.env };
    }

    const proc = spawn('node', [command, ...args], spawnOptions);

    // Invoke onSpawn callback if provided (for manual process control)
    if (options.onSpawn) {
      options.onSpawn(proc);
    }

    let stdout = '';
    let stderr = '';
    const timeoutMs = options.timeout ?? 60000;
    let timedOut = false;

    // Timeout handler
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (!timedOut) {
        resolve({
          exitCode: code ?? 1,
          output: stdout + stderr,
          stdout,
          stderr,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      if (!timedOut) {
        reject(err);
      }
    });
  });
}
