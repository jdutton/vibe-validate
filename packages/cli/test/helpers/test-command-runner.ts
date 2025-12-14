/**
 * Test Command Runner - Shared utilities for executing CLI commands in tests
 *
 * Eliminates duplication of execSync try/catch patterns across test files.
 */

import { safeExecSync } from '@vibe-validate/utils';
import yaml from 'yaml';

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
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  let i = 0;

  while (i < commandString.length) {
    const char = commandString[i];
    const prevChar = i > 0 ? commandString[i - 1] : '';

    // Handle escape sequences
    if (char === '\\' && i + 1 < commandString.length) {
      current += commandString[i + 1];
      i += 2; // Skip both backslash and next character
      continue;
    }

    // Handle quotes
    if (isQuoteChar(char) && prevChar !== '\\') {
      const quoteResult = processQuote(char, inQuotes, quoteChar);
      inQuotes = quoteResult.inQuotes;
      quoteChar = quoteResult.quoteChar;
      if (quoteResult.addChar) {
        current += char;
      }
    } else if (char === ' ' && !inQuotes) {
      // Space outside quotes - delimiter
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      // Regular character or space inside quotes
      current += char;
    }

    i++;
  }

  if (current) {
    parts.push(current);
  }

  return [parts[0], parts.slice(1)];
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
    output = err.stdout || err.stderr || '';
    exitCode = err.status || 1;
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
