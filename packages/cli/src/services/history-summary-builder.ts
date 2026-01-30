/**
 * History Summary Builder
 *
 * Fetches workflow runs for a PR branch and calculates:
 * - Total number of runs
 * - Recent pattern (passed/failed/flaky)
 * - Success rate
 *
 * Provides context for pattern recognition without full history details.
 *
 * @packageDocumentation
 */

import { listWorkflowRuns } from '@vibe-validate/git';

import type { CheckHistorySummary } from '../schemas/watch-pr-result.schema.js';

// Constants (extracted to avoid duplication warnings)
const NO_PREVIOUS_RUNS = 'No previous runs';

/**
 * Workflow Run (subset of fields from GitHub API)
 */
interface WorkflowRun {
  conclusion: string | null;
  created_at: string;
}

/**
 * HistorySummaryBuilder
 *
 * Builds a condensed history summary for pattern recognition.
 */
export class HistorySummaryBuilder {
  constructor(
    private readonly _owner: string,
    private readonly _repo: string,
  ) {}

  /**
   * Build history summary for a PR branch
   *
   * @param branch - Branch name
   * @returns History summary with total runs, pattern, and success rate
   */
  async buildSummary(branch: string): Promise<CheckHistorySummary> {
    try {
      const runs = await this.fetchWorkflowRuns(branch);

      if (runs.length === 0) {
        return {
          total_runs: 0,
          recent_pattern: NO_PREVIOUS_RUNS,
        };
      }

      const totalRuns = runs.length;
      const recentRuns = runs.slice(0, 10); // Last 10 for pattern detection
      const recentPattern = this.detectPattern(runs);
      const successRate = this.calculateSuccessRate(recentRuns);

      return {
        total_runs: totalRuns,
        recent_pattern: recentPattern,
        success_rate: successRate,
      };
    } catch {
      // Gracefully handle errors (gh CLI not available, API errors, etc.)
      // Note: Error intentionally not logged for production use
      return {
        total_runs: 0,
        recent_pattern: NO_PREVIOUS_RUNS,
      };
    }
  }

  /**
   * Fetch workflow runs for a branch via gh CLI
   *
   * @param branch - Branch name
   * @returns Array of workflow runs (sorted by created_at DESC)
   */
  private async fetchWorkflowRuns(branch: string): Promise<WorkflowRun[]> {
    const runs = listWorkflowRuns(
      branch,
      this._owner,
      this._repo,
      50, // Fetch up to 50 runs (more than we need)
      ['conclusion', 'createdAt']
    );

    // Map to our internal format
    return runs.map((run) => ({
      conclusion: run.conclusion ?? null,
      created_at: run.createdAt,
    }));
  }

  /**
   * Detect pattern from recent runs
   *
   * Patterns:
   * - "Passed last N runs" - All recent runs passed
   * - "Failed last N runs" - All recent runs failed
   * - "Flaky (alternating)" - Alternating pass/fail
   * - "Recently fixed (was failing)" - Recent passes after failures
   * - Generic pattern otherwise
   *
   * @param runs - All runs (sorted DESC)
   * @returns Pattern description
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private detectPattern(runs: WorkflowRun[]): string {
    if (runs.length === 0) {
      return NO_PREVIOUS_RUNS;
    }

    // Check for consistent success
    const recentRuns = runs.slice(0, 10);
    const consecutivePasses = this.countConsecutive(runs, 'success');
    const consecutiveFails = this.countConsecutive(runs, 'failure');

    if (consecutivePasses === runs.length && runs.length >= 1) {
      return `Passed last ${runs.length} run${runs.length > 1 ? 's' : ''}`;
    }

    if (consecutiveFails === runs.length && runs.length >= 1) {
      return `Failed last ${runs.length} run${runs.length > 1 ? 's' : ''}`;
    }

    // Check for recently fixed (BEFORE checking consecutive passes alone)
    if (consecutivePasses >= 2 && runs.length > consecutivePasses) {
      const afterPasses = runs.slice(consecutivePasses);
      const failsAfter = afterPasses.filter((r) => r.conclusion === 'failure').length;
      if (failsAfter >= 2) {
        return 'Recently fixed (was failing)';
      }
    }

    if (consecutivePasses >= 2) {
      return `Passed last ${consecutivePasses} run${consecutivePasses > 1 ? 's' : ''}`;
    }

    if (consecutiveFails >= 2) {
      return `Failed last ${consecutiveFails} run${consecutiveFails > 1 ? 's' : ''}`;
    }

    // Check for alternating pattern (flaky)
    if (this.isAlternating(recentRuns)) {
      return 'Flaky (alternating)';
    }

    // Generic pattern
    const passCount = recentRuns.filter((r) => r.conclusion === 'success').length;
    const failCount = recentRuns.filter((r) => r.conclusion === 'failure').length;

    if (passCount > failCount) {
      return `Mostly passing (${passCount}/${recentRuns.length} runs)`;
    }
    if (failCount > passCount) {
      return `Mostly failing (${failCount}/${recentRuns.length} runs)`;
    }

    return `Mixed results (${passCount} passed, ${failCount} failed)`;
  }

  /**
   * Count consecutive runs with the same conclusion (starting from most recent)
   *
   * @param runs - Workflow runs
   * @param conclusion - Conclusion to check
   * @returns Count of consecutive runs
   */
  private countConsecutive(runs: WorkflowRun[], conclusion: string): number {
    let count = 0;
    for (const run of runs) {
      if (run.conclusion === conclusion) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * Check if runs are alternating between success and failure
   *
   * @param runs - Workflow runs (at least 4 required)
   * @returns True if alternating pattern detected
   */
  private isAlternating(runs: WorkflowRun[]): boolean {
    if (runs.length < 4) {
      return false;
    }

    for (let i = 0; i < runs.length - 1; i++) {
      const current = runs[i].conclusion;
      const next = runs[i + 1].conclusion;

      // Check if they're different (success vs failure)
      const isSuccess = (c: string | null) => c === 'success';
      if (isSuccess(current) === isSuccess(next)) {
        return false; // Not alternating
      }
    }

    return true;
  }

  /**
   * Calculate success rate from recent runs
   *
   * @param runs - Recent workflow runs (up to 10)
   * @returns Success rate as percentage string (e.g., "75%")
   */
  private calculateSuccessRate(runs: WorkflowRun[]): string | undefined {
    if (runs.length === 0) {
      return undefined;
    }

    const successCount = runs.filter((r) => r.conclusion === 'success').length;
    const rate = Math.round((successCount / runs.length) * 100);

    return `${rate}%`;
  }
}
