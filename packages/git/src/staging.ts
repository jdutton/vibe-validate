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
    const stagedResult = executeGitCommand(['diff', '--name-only', '--cached'], {
      timeout: GIT_TIMEOUT,
      ignoreErrors: true
    });

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
    const unstagedResult = executeGitCommand(['diff', '--name-only'], {
      timeout: GIT_TIMEOUT,
      ignoreErrors: true
    });

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
