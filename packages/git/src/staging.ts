/**
 * Git Staging Detection
 *
 * Detects partially staged files to prevent validation mismatches.
 *
 * ## The Problem
 *
 * If a file has BOTH staged and unstaged changes:
 * 1. vibe-validate validates the FULL working tree state (staged + unstaged)
 * 2. git commit only commits the STAGED portion
 * 3. Result: Validated code != committed code
 *
 * ## Solution
 *
 * Pre-commit hook must detect and block partially staged files.
 * Users can:
 * - Stage all changes: `git add <file>`
 * - Unstage all changes: `git restore --staged <file>`
 * - Skip validation: `git commit --no-verify` (not recommended)
 */

import { executeGitCommand } from './git-executor.js';

const GIT_TIMEOUT = 30000;
const GIT_NAME_ONLY_FLAG = '--name-only';

/**
 * Get list of staged files (files in git index)
 *
 * Returns file paths relative to repository root for all files
 * currently staged (Added, Copied, Modified, or Renamed).
 *
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns Array of staged file paths, empty if none or not a git repo
 *
 * @example
 * ```typescript
 * const files = getStagedFiles();
 * if (files.length > 0) {
 *   console.log('Staged files:', files);
 * }
 * ```
 */
export function getStagedFiles(cwd: string = process.cwd()): string[] {
  try {
    const result = executeGitCommand(
      [
        'diff',
        '--cached',
        GIT_NAME_ONLY_FLAG,
        '--diff-filter=ACMR', // Added, Copied, Modified, Renamed (not Deleted)
      ],
      {
        cwd,
        timeout: GIT_TIMEOUT,
        ignoreErrors: true,
      }
    );

    if (!result.success || !result.stdout) {
      return [];
    }

    return result.stdout
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
  } catch {
    // Not a git repository, or git command failed
    return [];
  }
}

/**
 * Get list of files with partially staged changes
 *
 * A file is "partially staged" if it has BOTH:
 * - Changes in the staging area (git diff --cached)
 * - Changes in the working tree (git diff)
 *
 * This indicates the user staged some changes but not others,
 * which is incompatible with validation.
 *
 * @returns Array of file paths with partially staged changes, empty if none
 *
 * @example
 * ```typescript
 * const files = getPartiallyStagedFiles();
 * if (files.length > 0) {
 *   console.error('Partially staged files detected:', files);
 *   console.error('Stage all changes with: git add ' + files.join(' '));
 * }
 * ```
 */
export function getPartiallyStagedFiles(): string[] {
  try {
    // Get list of files with staged changes
    const stagedResult = executeGitCommand(['diff', GIT_NAME_ONLY_FLAG, '--cached'], {
      timeout: GIT_TIMEOUT,
      ignoreErrors: true,
      // Enumerating commands do not get to stop silently: at the 10 MiB default
      // a large staged changeset comes back truncated, and the shortfall reads
      // as "these files are not partially staged". Same ceiling and same reason
      // as the tree listing and the notes listing.
      maxBuffer: 256 * 1024 * 1024
    });

    // A spawn-level failure is not an empty changeset. Collapsing them tells the
    // pre-commit gate there is nothing partially staged -- a clean bill of health
    // derived from a question that was never answered.
    if (stagedResult.error) {
      console.warn(
        `⚠️  Could not list staged files, reporting none partially staged: ${stagedResult.stderr}`
      );
      return [];
    }

    if (!stagedResult.success) {
      return [];
    }

    const stagedFiles = stagedResult.stdout
      .trim()
      .split('\n')
      .filter(Boolean);

    // No staged files = no partially staged files
    if (stagedFiles.length === 0) {
      return [];
    }

    // Get list of files with unstaged changes
    const unstagedResult = executeGitCommand(['diff', GIT_NAME_ONLY_FLAG], {
      timeout: GIT_TIMEOUT,
      ignoreErrors: true,
      maxBuffer: 256 * 1024 * 1024
    });

    if (unstagedResult.error) {
      console.warn(
        `⚠️  Could not list unstaged files, reporting none partially staged: ${unstagedResult.stderr}`
      );
      return [];
    }

    if (!unstagedResult.success) {
      return [];
    }

    const unstagedFiles = new Set(
      unstagedResult.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
    );

    // Find intersection: files that appear in BOTH staged and unstaged
    return stagedFiles.filter((file) =>
      unstagedFiles.has(file)
    );
  } catch {
    // Not a git repository, or git command failed
    // Return empty array - let pre-commit continue and fail elsewhere if needed
    return [];
  }
}
