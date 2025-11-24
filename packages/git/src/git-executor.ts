/**
 * Secure Git Command Execution
 *
 * This module provides a centralized, secure way to execute git commands.
 * ALL git command execution in vibe-validate MUST go through this module.
 *
 * Security principles:
 * 1. Use spawnSync with array arguments (never string interpolation)
 * 2. Validate all user-controlled inputs
 * 3. No shell piping or heredocs
 * 4. Explicit argument construction
 *
 * @packageDocumentation
 */

import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

/**
 * Standard options for git command execution
 */
const GIT_TIMEOUT = 30000; // 30 seconds

export interface GitExecutionOptions {
  /**
   * Maximum time to wait for git command (ms)
   * @default 30000
   */
  timeout?: number;

  /**
   * Encoding for stdout/stderr
   * @default 'utf8'
   */
  encoding?: BufferEncoding;

  /**
   * Standard input to pass to command
   */
  stdin?: string;

  /**
   * Whether to ignore errors (return empty string instead of throwing)
   * @default false
   */
  ignoreErrors?: boolean;

  /**
   * Whether to suppress stderr
   * @default false
   */
  suppressStderr?: boolean;
}

/**
 * Result of a git command execution
 */
export interface GitExecutionResult {
  /** Standard output from the command */
  stdout: string;
  /** Standard error from the command */
  stderr: string;
  /** Exit code (0 for success) */
  exitCode: number;
  /** Whether the command succeeded */
  success: boolean;
}

/**
 * Error thrown when a git command fails
 */
export interface GitCommandError extends Error {
  /** Exit code from the git command */
  exitCode: number;
  /** Standard error output */
  stderr: string;
  /** Standard output */
  stdout: string;
}

/**
 * Execute a git command securely using spawnSync with array arguments
 *
 * This is the ONLY function that should execute git commands. All other
 * git operations must go through this function or higher-level abstractions.
 *
 * @param args - Git command arguments (e.g., ['rev-parse', '--git-dir'])
 * @param options - Execution options
 * @returns Execution result
 * @throws Error if command fails and ignoreErrors is false
 *
 * @example
 * ```typescript
 * // Get git directory
 * const result = executeGitCommand(['rev-parse', '--git-dir']);
 * console.log(result.stdout); // ".git"
 *
 * // Add note with stdin
 * executeGitCommand(
 *   ['notes', '--ref=vibe-validate/validate', 'add', '-f', '-F', '-', treeHash],
 *   { stdin: noteContent }
 * );
 * ```
 */
export function executeGitCommand(
  args: string[],
  options: GitExecutionOptions = {}
): GitExecutionResult {
  const {
    timeout = GIT_TIMEOUT,
    encoding = 'utf8',
    stdin,
    ignoreErrors = false,
    suppressStderr = false,
  } = options;

  // Validate arguments
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('Git command arguments must be a non-empty array');
  }

  // Build spawn options
  const spawnOptions: SpawnSyncOptions = {
    encoding,
    timeout,
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
  };

  // Configure stdio
  if (stdin !== undefined) {
    spawnOptions.input = stdin;
    spawnOptions.stdio = ['pipe', 'pipe', suppressStderr ? 'ignore' : 'pipe'];
  } else {
    spawnOptions.stdio = ['ignore', 'pipe', suppressStderr ? 'ignore' : 'pipe'];
  }

  // Execute command
  const result = spawnSync('git', args, spawnOptions);

  const stdout = (result.stdout?.toString() || '').trim();
  const stderr = (result.stderr?.toString() || '').trim();
  const exitCode = result.status ?? 1;
  const success = exitCode === 0;

  // Handle errors
  if (!success && !ignoreErrors) {
    const errorMessage = stderr || stdout || 'Git command failed';
    const error = new Error(`Git command failed: git ${args.join(' ')}\n${errorMessage}`) as GitCommandError;
    error.exitCode = exitCode;
    error.stderr = stderr;
    error.stdout = stdout;
    throw error;
  }

  return {
    stdout,
    stderr,
    exitCode,
    success,
  };
}

/**
 * Execute a git command and return stdout, throwing on error
 *
 * Convenience wrapper for the common case of executing a git command
 * and only caring about the stdout result.
 *
 * @param args - Git command arguments
 * @param options - Execution options
 * @returns Command stdout, trimmed
 * @throws Error if command fails
 */
export function execGitCommand(args: string[], options: GitExecutionOptions = {}): string {
  const result = executeGitCommand(args, options);
  return result.stdout;
}

/**
 * Execute a git command and return success status (no throw)
 *
 * Useful for checking if a git operation would succeed without
 * handling exceptions.
 *
 * @param args - Git command arguments
 * @param options - Execution options
 * @returns true if command succeeded, false otherwise
 */
export function tryGitCommand(args: string[], options: GitExecutionOptions = {}): boolean {
  const result = executeGitCommand(args, { ...options, ignoreErrors: true });
  return result.success;
}

/**
 * Validate that a string is safe to use as a git ref
 *
 * Git refs must:
 * - Not contain special shell characters
 * - Not start with a dash (looks like an option)
 * - Not contain path traversal sequences
 * - Match git's ref format rules
 *
 * @param ref - The ref to validate
 * @throws Error if ref is invalid
 */
export function validateGitRef(ref: string): void {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new Error('Git ref must be a non-empty string');
  }

  // Check for shell special characters
  if (/[;&|`$(){}[\]<>!\\"]/.test(ref)) {
    throw new Error(`Invalid git ref: contains shell special characters: ${ref}`);
  }

  // Check for leading dash (looks like an option)
  if (ref.startsWith('-')) {
    throw new Error(`Invalid git ref: starts with dash: ${ref}`);
  }

  // Check for path traversal
  if (ref.includes('..') || ref.includes('//')) {
    throw new Error(`Invalid git ref: contains path traversal: ${ref}`);
  }

  // Check for null bytes
  if (ref.includes('\0')) {
    throw new Error('Invalid git ref: contains null byte');
  }

  // Check for newlines (could break command)
  if (ref.includes('\n') || ref.includes('\r')) {
    throw new Error('Invalid git ref: contains newline');
  }
}

/**
 * Validate that a string is safe to use as a git notes ref
 *
 * Notes refs have additional restrictions beyond normal refs.
 *
 * @param notesRef - The notes ref to validate
 * @throws Error if notes ref is invalid
 */
export function validateNotesRef(notesRef: string): void {
  validateGitRef(notesRef);

  // Notes refs should follow refs/notes/* pattern or short form
  // Short form: 'vibe-validate/validate' → 'refs/notes/vibe-validate/validate'
  if (!notesRef.startsWith('refs/notes/') && notesRef.includes('/')) {
    // Short form is valid, but must not contain spaces
    if (/\s/.test(notesRef)) {
      throw new Error(`Invalid notes ref: contains whitespace: ${notesRef}`);
    }
  }
}

/**
 * Validate that a string is safe to use as a tree hash
 *
 * Tree hashes must be valid git object IDs (40-char hex or abbreviated).
 *
 * @param treeHash - The tree hash to validate
 * @throws Error if tree hash is invalid
 */
export function validateTreeHash(treeHash: string): void {
  if (typeof treeHash !== 'string' || treeHash.length === 0) {
    throw new Error('Tree hash must be a non-empty string');
  }

  // Must be hex characters only
  if (!/^[0-9a-f]+$/.test(treeHash)) {
    throw new Error(`Invalid tree hash: must be hexadecimal: ${treeHash}`);
  }

  // Must be reasonable length (4-40 chars for abbreviated or full hash)
  if (treeHash.length < 4 || treeHash.length > 40) {
    throw new Error(`Invalid tree hash: invalid length: ${treeHash}`);
  }
}
