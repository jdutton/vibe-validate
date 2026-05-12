/**
 * Git Tracking Branch Divergence Detection
 *
 * Compares the current branch against its remote tracking branch and reports
 * how many commits diverge on each side.
 *
 * ## The Problem
 *
 * Two different real-world conditions can leave the local branch out of sync
 * with its upstream, and the pre-commit hook needs to treat them differently:
 *
 * 1. **Purely behind** — someone else pushed to origin while we worked locally.
 *    `ahead = 0`, `behind > 0`. The user must pull before committing.
 * 2. **Diverged** — we rebased our feature branch onto an updated base; the
 *    upstream branch still has the pre-rebase commits. `ahead > 0`, `behind > 0`.
 *    The user will force-push-with-lease when ready; pre-commit should NOT block.
 *
 * A simple "is the branch behind?" check (e.g. counting `HEAD..@{u}`) cannot
 * tell these apart, because in both cases the upstream contains commits not
 * reachable from HEAD. We need both sides of the comparison.
 *
 * ## Solution
 *
 * Use `git rev-list --left-right --count HEAD...@{u}`, which returns
 * `<ahead>\t<behind>` in a single deterministic call.
 */

import { executeGitCommand } from './git-executor.js';

const GIT_TIMEOUT = 30000;

/**
 * Divergence between HEAD and its remote tracking branch.
 *
 * - `ahead`: commits on HEAD that are not on upstream
 * - `behind`: commits on upstream that are not on HEAD
 */
export interface TrackingDivergence {
  ahead: number;
  behind: number;
}

/**
 * Check how the current branch diverges from its remote tracking branch.
 *
 * @returns The ahead/behind counts, or `null` if there is no upstream
 *          tracking branch (e.g. a freshly created local branch).
 *
 * @example
 * ```typescript
 * const div = getTrackingDivergence();
 * if (div === null) {
 *   // No upstream — nothing to compare against.
 * } else if (div.ahead === 0 && div.behind === 0) {
 *   // Fully synced.
 * } else if (div.ahead === 0 && div.behind > 0) {
 *   // Purely behind — someone else pushed; pull before committing.
 * } else if (div.ahead > 0 && div.behind === 0) {
 *   // Ahead only — local commits not yet pushed.
 * } else {
 *   // Diverged (e.g. rebased) — force-push-with-lease when ready.
 * }
 * ```
 */
export function getTrackingDivergence(): TrackingDivergence | null {
  try {
    // Confirm an upstream exists first. Without this, the rev-list call
    // below would fail with the same "no upstream" error and we'd have to
    // pattern-match on stderr to distinguish it from real errors.
    const upstreamResult = executeGitCommand(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      { timeout: GIT_TIMEOUT, ignoreErrors: true }
    );

    if (!upstreamResult.success || !upstreamResult.stdout.trim()) {
      return null;
    }

    // `--left-right --count HEAD...@{u}` returns `<ahead>\t<behind>`.
    // The triple-dot (...) means "symmetric difference": commits reachable
    // from exactly one side. --left-right tags each commit with < (left
    // side = HEAD) or > (right side = @{u}); --count collapses to counts.
    const divergenceResult = executeGitCommand(
      ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
      { timeout: GIT_TIMEOUT, ignoreErrors: true }
    );

    if (!divergenceResult.success) {
      return null;
    }

    const [aheadRaw, behindRaw] = divergenceResult.stdout.trim().split(/\s+/);
    const ahead = Number.parseInt(aheadRaw ?? '', 10);
    const behind = Number.parseInt(behindRaw ?? '', 10);

    return {
      ahead: Number.isNaN(ahead) ? 0 : ahead,
      behind: Number.isNaN(behind) ? 0 : behind,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('no upstream')) {
      return null;
    }
    return null;
  }
}

/**
 * Check if the current branch is behind its remote tracking branch.
 *
 * @deprecated Prefer {@link getTrackingDivergence}, which distinguishes
 * "purely behind" (someone pushed) from "diverged" (we rebased). This
 * wrapper only reports the behind count and treats diverged branches the
 * same as purely-behind ones — which incorrectly blocks legitimate
 * post-rebase commits in pre-commit hooks. Retained for backwards
 * compatibility with external consumers of `@vibe-validate/git`.
 *
 * @returns Number of commits behind, or `null` if no tracking branch.
 */
export function isCurrentBranchBehindTracking(): number | null {
  const divergence = getTrackingDivergence();
  return divergence === null ? null : divergence.behind;
}
