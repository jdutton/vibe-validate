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

import { stripGitEnv } from './git-env.js';

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

  /**
   * Custom environment variables to pass to git command
   * Merged with process.env
   */
  env?: NodeJS.ProcessEnv;

  /**
   * Remove inherited git redirection vars from `process.env` before merging
   * `env` on top of it.
   *
   * **Set this whenever the command must target a caller-supplied `cwd` rather
   * than the ambient repository.** Inside a git hook — and vv itself runs as
   * one — git exports `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_PREFIX` and friends into
   * every child, and those override `cwd` outright. The child then answers
   * confidently about the outer commit's repository instead of the path it was
   * handed. See {@link "./git-env".stripGitEnv}.
   *
   * `env` is merged *after* the scrub and is deliberately not filtered: a caller
   * that sets `GIT_INDEX_FILE` on purpose (as the tree-hash and tree-snapshot
   * paths do) must still be able to.
   *
   * Left off by default: commands that mean "the repository I am in" — which is
   * most of this package — are correct to honour the ambient environment.
   *
   * @default false
   */
  scrubGitEnv?: boolean;

  /**
   * Working directory for git command execution
   * @default process.cwd()
   */
  cwd?: string;

  /**
   * Maximum bytes of stdout/stderr to capture.
   *
   * Exceeding it never yields a short but honest answer. Node raises ENOBUFS and
   * either kills the child (`status: null`) or, when the output was small enough
   * to arrive first, leaves `status: 0` next to a **truncated** stdout — which is
   * why this function treats any spawn-level error as failure regardless of the
   * exit code. Raise it for commands whose output scales with the size of the
   * tree (`ls-files`, `log`), not for commands that return a hash.
   *
   * @default 10485760 (10 MiB)
   */
  maxBuffer?: number;
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
  /**
   * The spawn-level failure, when git could not run, was killed, or overran
   * `maxBuffer`. Present **independently of `exitCode`** — an ENOBUFS can leave
   * `exitCode: 0` beside a truncated stdout.
   *
   * Reaches the caller on **both** paths, `ignoreErrors` included. Without that,
   * the only way to learn why a command failed was to let it throw, so a caller
   * that inspects the result — which is what `ignoreErrors` is for — could not
   * tell "git is not installed" from "exit 1 is the answer" from "your listing
   * was silently truncated". Those need different handling, and the last one is
   * the reason this field exists at all.
   */
  error?: Error;
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
 *
 * // Execute in specific directory
 * executeGitCommand(['status'], { cwd: '/path/to/repo' });
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
    env,
    cwd,
    scrubGitEnv = false,
    maxBuffer = 10 * 1024 * 1024, // 10MB buffer
  } = options;

  // Validate arguments
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('Git command arguments must be a non-empty array');
  }

  // The scrub applies to the INHERITED base only. Spreading a scrubbed env back
  // over `process.env` would re-inject every variable it just removed — removal
  // here is by omission, not by an explicit unset — so the order matters.
  const baseEnv = scrubGitEnv ? stripGitEnv(process.env) : process.env;

  // Build spawn options
  const spawnOptions: SpawnSyncOptions = {
    encoding,
    timeout,
    maxBuffer,
    env: env ? { ...baseEnv, ...env } : baseEnv,
    cwd,
  };

  // Configure stdio
  if (stdin === undefined) {
    spawnOptions.stdio = ['ignore', 'pipe', suppressStderr ? 'ignore' : 'pipe'];
  } else {
    spawnOptions.input = stdin;
    spawnOptions.stdio = ['pipe', 'pipe', suppressStderr ? 'ignore' : 'pipe'];
  }

  // Execute command
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is a standard system command
  const result = spawnSync('git', args, spawnOptions);

  const stdout = (result.stdout?.toString() || '').trim();
  const stderr = (result.stderr?.toString() || '').trim();
  const exitCode = result.status ?? 1;

  // A spawn-level error makes the result untrustworthy EVEN WHEN THE CHILD
  // EXITED 0. Node reports a maxBuffer overrun as `error: ENOBUFS`, and for
  // output small enough to arrive before the child finishes it leaves
  // `status: 0` alongside a TRUNCATED stdout. Keying on the exit code alone
  // therefore returns a partial answer marked successful — for an enumerating
  // command that is files silently missing from the list, which every caller
  // downstream reads as "not there" rather than "not asked". Larger overruns
  // kill the child and surface as `status: null`, so the same fault reports two
  // different ways; this collapses both onto "failed".
  const spawnError = result.error;
  const success = exitCode === 0 && spawnError === undefined;

  // A spawn-level failure produces no stderr — git never ran, or was killed
  // before it could speak — so without its message the caller cannot tell
  // "git is not installed" (ENOENT) from "output exceeded maxBuffer" (ENOBUFS)
  // from "it timed out" (ETIMEDOUT). It is checked FIRST because on an ENOBUFS
  // the truncated stdout is non-empty and would otherwise become the message.
  // Not `??` — every candidate here is an empty string when absent, not null.
  const spawnMessage = spawnError === undefined ? '' : spawnError.message;

  // Handle errors
  if (success || ignoreErrors) {
    return {
      stdout,
      // Substituted only when git said nothing itself, so a real stderr is never
      // overwritten. This is what makes the diagnostic reach callers that format
      // the failure from `stderr` alone — `withStagedTempIndex` below throws
      // `git add failed: ${stderr}`, which was an empty sentence on exactly the
      // spawn errors this function exists to detect.
      stderr: stderr || spawnMessage,
      exitCode,
      success,
      ...(spawnError === undefined ? {} : { error: spawnError }),
    };
  }

  const errorMessage = spawnMessage || stderr || stdout || 'Git command failed';
  const error = new Error(`Git command failed: git ${args.join(' ')}\n${errorMessage}`) as GitCommandError;
  error.exitCode = exitCode;
  error.stderr = stderr;
  error.stdout = stdout;
  throw error;
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
  // Short form is valid, but must not contain spaces
  if (!notesRef.startsWith('refs/notes/') && notesRef.includes('/') && /\s/.test(notesRef)) {
    throw new Error(`Invalid notes ref: contains whitespace: ${notesRef}`);
  }
}

/**
 * Validate that a string is safe to use as a tree hash
 *
 * Tree hashes can be:
 * - Git native: 40-char SHA-1 hex (or abbreviated 4-39 chars)
 * - Composite: 64-char SHA-256 hex (for repos with submodules)
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
    throw new Error(
      `Invalid tree hash: must be hexadecimal (lowercase a-f, 0-9 only), got: "${treeHash}"\n` +
      `Symbolic refs like 'HEAD', 'main', 'origin/main' are not supported.\n` +
      `Use getGitTreeHash() to get the current working tree hash.`
    );
  }

  // Must be reasonable length:
  // - 4-40 chars: Git native hash (abbreviated or full SHA-1)
  // - 64 chars: Composite hash (SHA-256 for repos with submodules)
  if (treeHash.length < 4 || (treeHash.length > 40 && treeHash.length !== 64)) {
    throw new Error(
      `Invalid tree hash: invalid length (must be 4-40 or 64 chars), got: ${treeHash.length} chars\n` +
      `Received: "${treeHash}"`
    );
  }
}
