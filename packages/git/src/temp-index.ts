/**
 * The throwaway-index mechanism shared by every "what does the working tree
 * look like right now" operation in this package.
 *
 * `git ls-files -s` and `git write-tree` both read *an index*, and the real one
 * describes what was last staged — for a tracked file with unsaved edits it
 * reports the **committed** blob, which is a confident wrong answer rather than
 * a miss. The fix is a disposable index: copy `.git/index` to a temp file, point
 * `GIT_INDEX_FILE` at the copy, `git add --all` into it, and read *that*. The
 * real index and the working tree are never written.
 *
 * ## Two honest costs
 *
 * - `git add --all` **writes loose blob objects** into the target repository's
 *   `.git/objects`. This is not a pure read. It writes only objects — never refs
 *   and never the real index — so nothing is reachable and `git gc` reclaims it,
 *   but a read-only filesystem will fail here.
 * - `git add --all` re-hashes whatever the index's stat cache reports as
 *   changed, so a clean tree reads nothing and a wholly-dirty tree reads
 *   everything. The cost scales with dirtiness, not with tree size.
 *
 * @packageDocumentation
 */

import { copyFileSync, existsSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { isProcessRunning } from '@vibe-validate/utils';

import { executeGitCommand, type GitExecutionResult } from './git-executor.js';

const GIT_TIMEOUT = 30000; // 30 seconds timeout for git operations

/**
 * Minimum age (milliseconds) before cleaning up stale temp index files
 *
 * Rationale: 5 minutes balances:
 * - Avoiding false positives (very slow validations in progress)
 * - Timely cleanup (don't accumulate too many stale files)
 * - Typical validation duration (< 2 minutes in most projects)
 */
const STALE_INDEX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Try to clean up a legacy temp index file (no PID suffix)
 * @param gitDir - Git directory path
 */
function tryCleanupLegacyTempIndex(gitDir: string): void {
  try {
    const filePath = join(gitDir, 'vibe-validate-temp-index');
    const stats = statSync(filePath);
    const ageMs = Date.now() - stats.mtimeMs;

    if (ageMs >= STALE_INDEX_AGE_MS) {
      unlinkSync(filePath);
      console.warn(`⚠️  Cleaned up legacy temp index (${Math.round(ageMs/1000)}s old)`);
    }
  } catch {
    // Ignore cleanup errors (file may not exist or be in use)
  }
}

/**
 * Try to clean up a PID-suffixed temp index file if it's stale
 * @param gitDir - Git directory path
 * @param file - Filename to check
 * @param pid - Process ID from filename
 */
function tryCleanupPidTempIndex(gitDir: string, file: string, pid: number): void {
  try {
    const filePath = join(gitDir, file);
    const stats = statSync(filePath);
    const ageMs = Date.now() - stats.mtimeMs;

    // Skip if younger than threshold
    if (ageMs < STALE_INDEX_AGE_MS) return;

    // Skip if process is still running
    if (isProcessRunning(pid)) return;

    // Stale file - clean it up
    try {
      unlinkSync(filePath);
      const ageSec = Math.round(ageMs / 1000);
      console.warn(`⚠️  Cleaned up stale temp index from PID ${pid} (${ageSec}s old, process not running)`);
    } catch (err) {
      const error = err as Error;
      console.warn(`⚠️  Failed to clean up stale temp index ${file}: ${error.message}`);
    }
  } catch {
    // Ignore errors reading file stats (file may have been deleted)
  }
}

/**
 * Clean up stale temp index files from crashed processes
 *
 * Scans git directory for temp index files and removes those that are:
 * - Older than 5 minutes AND
 * - Process no longer running
 *
 * Warns to stderr when cleanup occurs (bug detection canary).
 * Fails gracefully if cleanup fails (warn and continue).
 *
 * @param gitDir - Absolute path to the repository's git directory
 */
function cleanupStaleIndexes(gitDir: string): void {
  const pattern = /^vibe-validate-temp-index-(\d+)$/;

  try {
    const files = readdirSync(gitDir);

    for (const file of files) {
      // Handle legacy temp index (no PID suffix)
      if (file === 'vibe-validate-temp-index') {
        tryCleanupLegacyTempIndex(gitDir);
        continue;
      }

      // Handle PID-suffixed temp index
      const match = pattern.exec(file);
      if (!match) continue;

      const pid = Number.parseInt(match[1], 10);
      tryCleanupPidTempIndex(gitDir, file, pid);
    }
  } catch (error) {
    // Expected errors (fail-safe, no action needed):
    // - ENOENT: .git directory doesn't exist (fresh repo)
    // - ENOTDIR: gitDir points to a file, not directory
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return; // Expected failure - skip cleanup
    }

    // Unexpected errors (should warn for debugging)
    console.warn(`⚠️  Unexpected error during temp index cleanup: ${err.message}`);
    console.warn(`   Git dir: ${gitDir}`);
    console.warn(`   This may indicate a bug - please report if you see this often`);
  }
}

/** Where a staged-index callback runs, and how it talks to git. */
export interface StagedIndexContext {
  /** Absolute path to the repository's git directory. */
  gitDir: string;
  /** Absolute path to the working tree's top level. */
  repoRoot: string;
  /**
   * Run one git command at {@link repoRoot} against the throwaway index.
   *
   * @param args - Git arguments after the binary
   * @param options - `ignoreErrors` returns a failed result instead of throwing;
   *   `maxBuffer` raises the output cap for commands that enumerate
   * @returns The command result
   */
  runGit(
    args: string[],
    options?: { ignoreErrors?: boolean; maxBuffer?: number },
  ): GitExecutionResult;
}

/** How to find the repository, and whether to trust the ambient environment. */
export interface StagedIndexOptions {
  /**
   * Directory to discover the repository from. Defaults to `process.cwd()`.
   *
   * Every git call runs at the resolved **repository root**, not here — see
   * {@link withStagedTempIndex} for why that is load-bearing rather than tidy.
   */
  cwd?: string;
  /**
   * Drop inherited git redirection vars before running anything.
   *
   * **Must be true whenever `cwd` was supplied by a caller**, and must stay
   * false for ambient callers. See
   * {@link "./git-executor".GitExecutionOptions.scrubGitEnv}.
   *
   * @default false
   */
  scrubGitEnv?: boolean;
}

/**
 * Stage the whole working tree into a throwaway index, then run `fn` against it.
 *
 * The index is created under the repository's own git directory, named with this
 * process's PID so a crash leaves a file the next run can recognise and reap
 * (see {@link cleanupStaleIndexes}), and is unlinked on the way out whether `fn`
 * returned or threw.
 *
 * **Every git call runs at the repository root.** This is not cosmetic:
 * `git add --all` invoked from a subdirectory stages only that subdirectory
 * (Issue #127), and `git ls-files` likewise *scopes* its listing to the cwd —
 * `--full-name` changes only how the paths it already chose are spelled, not
 * which paths it chose. Running at the root makes "this is the whole tree" true
 * by construction rather than by flag.
 *
 * Membership is `git add --all` **without** `--force`, i.e.
 * `tracked ∪ (untracked ∧ ¬ignored)`. Gitignored paths are deliberately absent:
 * checksumming build output and secrets is a liability, not a feature, and it
 * would make the result differ between two developers with the same commit.
 *
 * @param options - Repository discovery and environment policy
 * @param fn - Receives the staged context; its return value is passed through
 * @returns Whatever `fn` returned
 * @throws Error if the directory is not a git work tree, or `git add` fails
 */
export function withStagedTempIndex<T>(
  options: StagedIndexOptions,
  fn: (context: StagedIndexContext) => T,
): T {
  const { cwd, scrubGitEnv = false } = options;
  const discovery = { timeout: GIT_TIMEOUT, cwd, scrubGitEnv };

  // Check we're in a git repository
  executeGitCommand(['rev-parse', '--is-inside-work-tree'], discovery);

  // Get git directory and repository root
  // CRITICAL: Use --absolute-git-dir instead of --git-dir for cross-platform consistency
  // --git-dir returns relative paths (.git vs ../.git) on Windows depending on cwd
  // --absolute-git-dir ensures same path regardless of subdirectory (Issue #127)
  const gitDir = executeGitCommand(['rev-parse', '--absolute-git-dir'], discovery).stdout.trim();

  // Get repository root (working tree top level) — see the note above on why
  // every subsequent call is pinned to it.
  const repoRoot = executeGitCommand(['rev-parse', '--show-toplevel'], discovery).stdout.trim();

  cleanupStaleIndexes(gitDir);
  const tempIndexFile = `${gitDir}/vibe-validate-temp-index-${process.pid}`;

  try {
    // Step 1: Copy current index to temp index (if it exists)
    const currentIndex = `${gitDir}/index`;

    // CRITICAL: In fresh repos (git init, no commits), .git/index doesn't exist yet
    // Only copy if index exists; git add will create temp index if it doesn't
    if (existsSync(currentIndex)) {
      // SECURITY: Use Node.js fs.copyFileSync instead of shell cp command
      // Prevents potential command injection if gitDir contains malicious characters
      copyFileSync(currentIndex, tempIndexFile);
    }

    const runGit: StagedIndexContext['runGit'] = (args, runOptions) =>
      executeGitCommand(args, {
        timeout: GIT_TIMEOUT,
        // Set AFTER the scrub, not before: an inherited GIT_INDEX_FILE from an
        // outer hook is precisely the index we are trying not to touch.
        env: { GIT_INDEX_FILE: tempIndexFile },
        cwd: repoRoot,
        scrubGitEnv,
        ...runOptions,
      });

    // Step 2: Stage all changes (tracked + untracked) in temp index
    // CRITICAL: Must use `git add --all` (NOT `--intent-to-add` or `--force`)
    //
    // Why NOT --intent-to-add:
    //   - Only adds empty placeholders, not actual file content
    //   - git write-tree skips intent-to-add entries (treats as non-existent)
    //   - Result: unstaged modifications NOT included in tree hash
    //
    // Why NOT --force:
    //   - Includes files in .gitignore (secrets, build artifacts, etc.)
    //   - Security risk: checksums API keys, passwords, credentials
    //   - Non-deterministic: different devs have different ignored files
    //   - Breaks cache sharing: same code produces different hashes
    const addResult = runGit(['add', '--all'], { ignoreErrors: true });

    // If git add fails and it's not "nothing to add", throw error
    if (!addResult.success && !addResult.stderr.includes('nothing')) {
      // Real error - throw with details
      throw new Error(`git add failed: ${addResult.stderr}`);
    }

    return fn({ gitDir, repoRoot, runGit });
  } finally {
    // Always clean up temp index file
    try {
      // SECURITY: Use Node.js fs.unlinkSync instead of shell rm command
      // Prevents potential command injection if tempIndexFile contains malicious characters
      unlinkSync(tempIndexFile);
    } catch {
      // Ignore cleanup errors - temp file cleanup is best effort
      // unlinkSync throws if file doesn't exist (same as rm -f behavior)
    }
  }
}
