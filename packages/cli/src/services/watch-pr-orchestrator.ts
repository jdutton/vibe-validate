/**
 * WatchPROrchestrator - Coordinate all components to build complete WatchPRResult
 *
 * Responsibilities:
 * - Coordinate data fetching (PR metadata, checks, history, changes)
 * - Extract errors from check logs (matrix + non-matrix modes)
 * - Extract external check details (codecov, SonarCloud, etc.)
 * - Build complete WatchPRResult with validation
 * - Generate intelligent guidance
 * - Handle caching (save/retrieve results)
 * - Select output format (YAML on failure, text on success)
 *
 * @packageDocumentation
 */

import type {
  CheckConclusion,
  ExternalCheck,
  GitHubActionCheck,
  Guidance,
  NextStep,
  PRStatus,
  WatchPRResult,
} from '../schemas/watch-pr-result.schema.js';

import { CacheManager } from './cache-manager.js';
import {
  CodecovExtractor,
  ExternalExtractorRegistry,
  SonarCloudExtractor,
} from './external-check-extractor.js';
import { ExtractionModeDetector } from './extraction-mode-detector.js';
import { GitHubFetcher } from './github-fetcher.js';
import { HistorySummaryBuilder } from './history-summary-builder.js';

/**
 * WatchPROrchestrator - Build complete WatchPRResult
 */
export class WatchPROrchestrator {
  private readonly fetcher: GitHubFetcher;
  private readonly historyBuilder: HistorySummaryBuilder;
  private readonly extractionDetector: ExtractionModeDetector;
  private readonly externalCheckExtractor: ExternalExtractorRegistry;
  private cacheManager?: CacheManager;

  constructor(
    private readonly owner: string,
    private readonly repo: string,
  ) {
    this.fetcher = new GitHubFetcher(owner, repo);
    this.historyBuilder = new HistorySummaryBuilder(owner, repo);
    this.extractionDetector = new ExtractionModeDetector();

    // Initialize external check extractor registry
    this.externalCheckExtractor = new ExternalExtractorRegistry();
    this.externalCheckExtractor.register(new CodecovExtractor());
    this.externalCheckExtractor.register(new SonarCloudExtractor());
  }

  /**
   * Build complete WatchPRResult
   *
   * @param prNumber - PR number
   * @param options - Options (useCache, forceFetch)
   * @returns Complete WatchPRResult
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async buildResult(
    prNumber: number,
    options: { useCache?: boolean; forceFetch?: boolean } = {},
  ): Promise<WatchPRResult> {
    const { useCache = true } = options;

    // Initialize cache manager if caching enabled (for logs only)
    if (useCache && !this.cacheManager) {
      this.cacheManager = new CacheManager(`${this.owner}/${this.repo}`, prNumber);
    }

    // Always fetch fresh PR metadata and checks from GitHub
    // Cache is ONLY used for expensive log downloads, NOT for status
    const prMetadata = await this.fetcher.fetchPRDetails(prNumber);

    // Fetch checks
    const checks = await this.fetcher.fetchChecks(prNumber);

    // Classify checks into GitHub Actions vs external
    const githubActions: GitHubActionCheck[] = [];
    const rawExternalChecks: ExternalCheck[] = [];

    for (const check of checks) {
      if (check.type === 'github_action') {
        // GitHub Action check - may have extraction
        if (
          !check.run_id ||
          !check.workflow ||
          !check.started_at ||
          !check.duration
        ) {
          continue; // Skip invalid checks
        }

        const actionCheck: GitHubActionCheck = {
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
          run_id: check.run_id,
          workflow: check.workflow,
          started_at: check.started_at,
          duration: check.duration,
        };

        // Try to extract errors if check failed
        if (check.conclusion === 'failure' && check.run_id) {
          try {
            const logs = await this.fetcher.fetchRunLogs(check.run_id);
            const extraction = await this.extractionDetector.detectAndExtract(actionCheck, logs);
            if (extraction) {
              actionCheck.extraction = extraction;
            }

            // Save logs to cache
            if (this.cacheManager) {
              await this.cacheManager.saveLog(check.run_id, logs);
              if (extraction) {
                await this.cacheManager.saveExtraction(check.run_id, extraction);
              }
            }
          } catch (error) {
            // Gracefully handle extraction errors (don't block result)
            console.warn(`Failed to extract errors from run ${check.run_id}:`, error);
          }
        }

        githubActions.push(actionCheck);
      } else {
        // External check - will extract later
        if (!check.url) {
          continue; // Skip invalid checks
        }

        rawExternalChecks.push({
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
          url: check.url,
          provider: check.provider,
        });
      }
    }

    // Extract details from external checks (all at once)
    const externalChecks = await this.externalCheckExtractor.extractAll(rawExternalChecks);

    // Order checks: failed first (newspaper philosophy)
    const orderedGitHubActions = this.orderChecks(githubActions);
    const orderedExternalChecks = this.orderExternalChecks(externalChecks);

    // Calculate check counts
    const totalChecks = githubActions.length + externalChecks.length;
    const passedChecks =
      githubActions.filter((c) => c.conclusion === 'success').length +
      externalChecks.filter((c) => c.conclusion === 'success').length;
    const failedChecks =
      githubActions.filter((c) => c.conclusion === 'failure').length +
      externalChecks.filter((c) => c.conclusion === 'failure').length;
    const pendingChecks =
      githubActions.filter((c) => c.status !== 'completed').length +
      externalChecks.filter((c) => c.status !== 'completed').length;

    // Fetch history summary
    const historySummary = await this.historyBuilder.buildSummary(prMetadata.branch);

    // Fetch file changes
    const changes = await this.fetcher.fetchFileChanges(prNumber);

    // Determine overall status
    let status: PRStatus = 'passed';
    if (failedChecks > 0) {
      status = 'failed';
    } else if (pendingChecks > 0) {
      status = 'pending';
    }

    // Generate guidance
    const guidance = this.generateGuidance(
      status,
      orderedGitHubActions,
      orderedExternalChecks,
      prMetadata.mergeable,
    );

    // Build result
    const result: WatchPRResult = {
      pr: prMetadata,
      status,
      checks: {
        total: totalChecks,
        passed: passedChecks,
        failed: failedChecks,
        pending: pendingChecks,
        history_summary: historySummary.total_runs > 0 ? historySummary : undefined,
        github_actions: orderedGitHubActions,
        external_checks: orderedExternalChecks,
      },
      changes,
      guidance,
      // Note: cache field removed - will be added back when actually needed
    };

    // Note: We do NOT cache the result itself - only logs are cached
    // This ensures PR status is always fresh from GitHub

    return result;
  }

  /**
   * Build result for a specific run ID
   *
   * Useful for watching specific failed runs to test extraction.
   * Does not use history summary (since it's a single run).
   *
   * @param prNumber - PR number
   * @param runId - GitHub run ID
   * @param options - Options (useCache)
   * @returns WatchPRResult with single check
   */
  async buildResultForRun(
    prNumber: number,
    runId: number,
    options: { useCache?: boolean } = {},
  ): Promise<WatchPRResult> {
    const { useCache = false } = options;

    // Initialize cache manager if caching enabled
    if (useCache && !this.cacheManager) {
      this.cacheManager = new CacheManager(`${this.owner}/${this.repo}`, prNumber);
    }

    // Fetch PR metadata (still needed for context)
    const prMetadata = await this.fetcher.fetchPRDetails(prNumber);

    // Fetch specific run details
    const runDetails = await this.fetcher.fetchRunDetails(runId);

    // Build GitHub Action check from run details
    const actionCheck: GitHubActionCheck = {
      name: runDetails.name,
      status: runDetails.status,
      conclusion: runDetails.conclusion,
      run_id: runDetails.run_id,
      workflow: runDetails.workflow,
      started_at: runDetails.started_at,
      duration: runDetails.duration,
    };

    // Try to extract errors from logs
    try {
      const logs = await this.fetcher.fetchRunLogs(runId);
      const extraction = await this.extractionDetector.detectAndExtract(actionCheck, logs);
      if (extraction) {
        actionCheck.extraction = extraction;
      }

      // Save logs to cache (extraction can be re-run later)
      if (this.cacheManager) {
        await this.cacheManager.saveLog(runId, logs);
        if (extraction) {
          await this.cacheManager.saveExtraction(runId, extraction);
        }
      }
    } catch (error) {
      // Gracefully handle extraction errors
      console.warn(`Failed to extract errors from run ${runId}:`, error);
    }

    // Fetch file changes (for context)
    const changes = await this.fetcher.fetchFileChanges(prNumber);

    // Determine status from the single check
    let status: PRStatus = 'passed';
    if (actionCheck.conclusion === 'failure') {
      status = 'failed';
    } else if (actionCheck.status === 'in_progress' || actionCheck.status === 'queued') {
      status = 'pending';
    }

    // Calculate check counts (single check)
    const totalChecks = 1;
    const passedChecks = actionCheck.conclusion === 'success' ? 1 : 0;
    const failedChecks = actionCheck.conclusion === 'failure' ? 1 : 0;
    const pendingChecks = actionCheck.status === 'in_progress' || actionCheck.status === 'queued' ? 1 : 0;

    // Generate guidance (simplified for single run)
    const guidance = this.generateGuidance(status, [actionCheck], [], prMetadata.mergeable);

    // Build result
    const result: WatchPRResult = {
      pr: prMetadata,
      status,
      checks: {
        total: totalChecks,
        passed: passedChecks,
        failed: failedChecks,
        pending: pendingChecks,
        github_actions: [actionCheck],
        external_checks: [],
      },
      changes,
      guidance,
      // Note: cache field removed - will be added back when actually needed
    };

    // Don't cache metadata for single-run mode (historical runs are immutable)
    // But logs and extractions are already cached above

    return result;
  }

  /**
   * Get priority for check ordering (lower is higher priority)
   */
  private getCheckPriority(conclusion?: CheckConclusion, status?: string): number {
    if (conclusion === 'failure') return 0;
    if (status !== 'completed') return 1;
    if (conclusion === 'success') return 2;
    return 3;
  }

  /**
   * Order checks: failed first, then pending, then passed
   *
   * @param checks - GitHub Action checks
   * @returns Ordered checks
   */
  private orderChecks(checks: GitHubActionCheck[]): GitHubActionCheck[] {
    return checks.sort((a, b) => {
      return this.getCheckPriority(a.conclusion, a.status) - this.getCheckPriority(b.conclusion, b.status);
    });
  }

  /**
   * Order external checks: failed first, then pending, then passed
   *
   * @param checks - External checks
   * @returns Ordered checks
   */
  // eslint-disable-next-line sonarjs/no-identical-functions
  private orderExternalChecks(checks: ExternalCheck[]): ExternalCheck[] {
    return checks.sort((a, b) => {
      return this.getCheckPriority(a.conclusion, a.status) - this.getCheckPriority(b.conclusion, b.status);
    });
  }

  /**
   * Generate intelligent guidance based on check results
   *
   * @param status - Overall status
   * @param githubActions - GitHub Action checks
   * @param externalChecks - External checks
   * @param mergeable - Is PR mergeable?
   * @returns Guidance with next steps
   */
  private generateGuidance(
    status: 'passed' | 'failed' | 'pending',
    githubActions: GitHubActionCheck[],
    externalChecks: ExternalCheck[],
    mergeable: boolean,
  ): Guidance {
    const nextSteps: NextStep[] = [];

    if (status === 'failed') {
      // Find failed checks
      const failedGitHubActions = githubActions.filter((c) => c.conclusion === 'failure');
      const failedExternalChecks = externalChecks.filter((c) => c.conclusion === 'failure');

      // Add next steps for failed GitHub Actions
      for (const check of failedGitHubActions) {
        nextSteps.push({
          action: `Fix ${check.name} failure`,
          url: `https://github.com/${this.owner}/${this.repo}/actions/runs/${check.run_id}`,
          severity: 'error',
          reason: check.extraction
            ? `${check.extraction.totalErrors} error(s) detected`
            : 'Check failed',
        });
      }

      // Add next steps for failed external checks
      for (const check of failedExternalChecks) {
        nextSteps.push({
          action: `Fix ${check.name} failure`,
          url: check.url,
          severity: check.extracted?.severity ?? 'error',
          reason: check.extracted?.summary ?? 'Check failed',
        });
      }

      return {
        status: 'failed',
        blocking: !mergeable,
        severity: 'error',
        summary: `${failedGitHubActions.length + failedExternalChecks.length} check(s) failed`,
        next_steps: nextSteps,
      };
    }

    if (status === 'pending') {
      return {
        status: 'pending',
        blocking: false,
        severity: 'info',
        summary: 'Checks are still running',
        next_steps: [
          {
            action: 'Wait for checks to complete',
            severity: 'info',
          },
        ],
      };
    }

    // Passed
    return {
      status: 'passed',
      blocking: false,
      severity: 'info',
      summary: 'All checks passed',
      next_steps: mergeable
        ? [
            {
              action: 'Ready to merge',
              severity: 'info',
            },
          ]
        : [
            {
              action: 'Resolve merge conflicts',
              severity: 'warning',
              reason: 'PR is not mergeable',
            },
          ],
    };
  }

  // buildCacheInfo() removed - cache field will be added back when actually needed

  /**
   * Fetch all workflow runs for a PR (for --history flag)
   *
   * @param prNumber - PR number
   * @returns List of workflow runs with basic metadata
   */
  async fetchRunsForPR(prNumber: number): Promise<Array<{
    run_id: number;
    workflow_name: string;
    status: string;
    conclusion: string | null;
    started_at: string;
    duration?: string;
  }>> {
    return await this.fetcher.fetchRunsForPR(prNumber);
  }

  /**
   * Determine if output should be YAML format
   *
   * Auto-YAML on failure (consistent with validate command)
   *
   * @param status - Overall status
   * @param forceYAML - Force YAML output
   * @returns True if should output YAML
   */
  shouldOutputYAML(status: string, forceYAML: boolean): boolean {
    return forceYAML || status === 'failed';
  }
}
