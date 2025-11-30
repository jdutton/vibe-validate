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

import { execSync } from 'node:child_process';

const GIT_TIMEOUT = 30000;
const GIT_OPTIONS = {
  encoding: 'utf8' as const,
  timeout: GIT_TIMEOUT,
  stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'],
};

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
    const stagedOutput = execSync('git diff --name-only --cached', GIT_OPTIONS);
    const stagedFiles = stagedOutput
      .trim()
      .split('\n')
      .filter(Boolean);

    // No staged files = no partially staged files
    if (stagedFiles.length === 0) {
      return [];
    }

    // Get list of files with unstaged changes
    const unstagedOutput = execSync('git diff --name-only', GIT_OPTIONS);
    const unstagedFiles = new Set(
      unstagedOutput
        .trim()
        .split('\n')
        .filter(Boolean)
    );

    // Find intersection: files that appear in BOTH staged and unstaged
    const partiallyStagedFiles = stagedFiles.filter((file) =>
      unstagedFiles.has(file)
    );

    return partiallyStagedFiles;
  } catch {
    // Not a git repository, or git command failed
    // Return empty array - let pre-commit continue and fail elsewhere if needed
    return [];
  }
}
