/**
 * Git Tracking Branch Detection
 *
 * Detects if current branch is behind its remote tracking branch.
 *
 * ## The Problem
 *
 * If you're working on local `fix-issue-X` and someone else pushes to `origin/fix-issue-X`:
 * 1. Your local branch is now behind the remote tracking branch
 * 2. If you commit and push, you may create conflicts or lose their changes
 * 3. You should pull/merge before committing
 *
 * ## Solution
 *
 * Pre-commit hook should detect and warn when current branch is behind its tracking branch.
 */

import { execSync } from 'node:child_process';

const GIT_TIMEOUT = 30000;
const GIT_OPTIONS = {
  encoding: 'utf8' as const,
  timeout: GIT_TIMEOUT,
  stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'],
};

/**
 * Check if current branch is behind its remote tracking branch
 *
 * @returns Number of commits behind (0 = up to date), or null if no tracking branch
 *
 * @example
 * ```typescript
 * const behindBy = isCurrentBranchBehindTracking();
 * if (behindBy === null) {
 *   console.log('No remote tracking branch');
 * } else if (behindBy > 0) {
 *   console.error(`Behind by ${behindBy} commit(s)`);
 *   console.error('Pull changes with: git pull');
 * }
 * ```
 */
export function isCurrentBranchBehindTracking(): number | null {
  try {
    // Get the upstream tracking branch for current branch
    // Example output: "origin/fix-issue-X"
    // Throws error if no upstream configured
    const trackingBranch = execSync(
      'git rev-parse --abbrev-ref --symbolic-full-name @{u}',
      GIT_OPTIONS
    ).trim();

    if (!trackingBranch) {
      // No tracking branch
      return null;
    }

    // Count commits behind: HEAD..@{u}
    // This shows commits in tracking branch that are not in HEAD
    const behindOutput = execSync(
      'git rev-list --count HEAD..@{u}',
      GIT_OPTIONS
    ).trim();

    const behindCount = Number.parseInt(behindOutput, 10);

    // Return 0 if parsing failed (defensive)
    return Number.isNaN(behindCount) ? 0 : behindCount;
  } catch (error) {
    // Check if error is "no upstream configured" (expected for new branches)
    if (error instanceof Error && error.message.includes('no upstream')) {
      return null;
    }

    // Other errors (not in git repo, etc.) - return null
    return null;
  }
}
