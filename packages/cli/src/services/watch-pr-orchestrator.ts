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
  CheckStatus,
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
          job_id: check.job_id,
          workflow: check.workflow,
          started_at: check.started_at,
          duration: check.duration,
        };

        // Try to extract errors if check failed
        if (check.conclusion === 'failure' && check.run_id) {
          await this.processFailedCheck(actionCheck, check.run_id, check.job_id);
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
   * Build GitHub Action check from a workflow job
   */
  private async buildCheckFromJob(
    job: { id: number; run_id: number; name: string; status: string; conclusion: string | null; started_at: string; completed_at: string | null },
    runId: number,
    workflowName: string
  ): Promise<GitHubActionCheck> {
    // Calculate duration
    const startTime = new Date(job.started_at).getTime();
    const endTime = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
    const durationSecs = Math.floor((endTime - startTime) / 1000);

    // Normalize status
    let jobStatus: CheckStatus = 'queued';
    if (job.status === 'completed') {
      jobStatus = 'completed';
    } else if (job.status === 'in_progress') {
      jobStatus = 'in_progress';
    }

    const actionCheck: GitHubActionCheck = {
      name: job.name,
      status: jobStatus,
      conclusion: job.conclusion ? (job.conclusion as CheckConclusion) : undefined,
      run_id: runId,
      job_id: job.id, // CRITICAL: Include job_id for matrix strategy support
      workflow: workflowName,
      started_at: job.started_at,
      duration: `${durationSecs}s`,
    };

    // Extract errors from failed jobs
    if (job.status === 'completed' && job.conclusion === 'failure') {
      await this.extractErrorsForCheck(actionCheck, runId, job.id);
    }

    return actionCheck;
  }

  /**
   * Process a failed check by extracting errors and caching results
   *
   * @param check - The action check to process
   * @param runId - The workflow run ID
   * @param jobId - Optional job ID for matrix strategies
   */
  private async processFailedCheck(check: GitHubActionCheck, runId: number, jobId?: number): Promise<void> {
    // Use retry logic to handle GitHub API race condition (Issue #4)
    // Pass job_id for matrix strategy jobs to get job-specific logs
    const logs = await this.fetchLogsWithRetry(runId, jobId);
    if (!logs) {
      // If logs are null, gracefully continue without extraction
      // No noisy error output (Issue #4 fix)
      return;
    }

    const extraction = await this.extractionDetector.detectAndExtract(check, logs);
    if (extraction) {
      check.extraction = extraction;
    }

    // Save logs to cache
    if (this.cacheManager) {
      await this.cacheManager.saveLog(runId, logs);
      if (extraction) {
        await this.cacheManager.saveExtraction(runId, extraction);
      }
    }
  }

  /**
   * Extract errors for a check from run logs
   */
  private async extractErrorsForCheck(check: GitHubActionCheck, runId: number, jobId?: number): Promise<void> {
    const logs = await this.fetchLogsWithRetry(runId, jobId);
    if (!logs) return;

    const extraction = await this.extractionDetector.detectAndExtract(check, logs);
    if (extraction) {
      check.extraction = extraction;
    }

    // Save to cache
    if (this.cacheManager) {
      await this.cacheManager.saveLog(runId, logs);
      if (extraction) {
        await this.cacheManager.saveExtraction(runId, extraction);
      }
    }
  }

  /**
   * Determine overall PR status from checks
   */
  private determineOverallStatus(checks: GitHubActionCheck[]): PRStatus {
    const hasFailure = checks.some(c => c.conclusion === 'failure');
    const hasPending = checks.some(c => c.status === 'in_progress' || c.status === 'queued');

    if (hasFailure) return 'failed';
    if (hasPending) return 'pending';
    return 'passed';
  }

  /**
   * Build result for a specific run ID
   *
   * Fetches all jobs for the workflow run and creates individual checks for each job.
   * This provides consistent job-level detail matching the default behavior.
   *
   * @param prNumber - PR number
   * @param runId - GitHub run ID
   * @param options - Options (useCache)
   * @returns WatchPRResult with job-level checks
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

    // Fetch metadata
    const prMetadata = await this.fetcher.fetchPRDetails(prNumber);
    const runDetails = await this.fetcher.fetchRunDetails(runId);
    const jobs = await this.fetcher.fetchRunJobs(runId);

    // Build checks from jobs
    const actionChecks = await Promise.all(
      jobs.map(job => this.buildCheckFromJob(job, runId, runDetails.workflow))
    );

    // Fetch file changes
    const changes = await this.fetcher.fetchFileChanges(prNumber);

    // Determine status
    const status = this.determineOverallStatus(actionChecks);

    // Calculate counts
    const totalChecks = actionChecks.length;
    const passedChecks = actionChecks.filter(c => c.conclusion === 'success').length;
    const failedChecks = actionChecks.filter(c => c.conclusion === 'failure').length;
    const pendingChecks = actionChecks.filter(c => c.status === 'in_progress' || c.status === 'queued').length;

    // Generate guidance
    const guidance = this.generateGuidance(status, actionChecks, [], prMetadata.mergeable);

    // Build result
    return {
      pr: prMetadata,
      status,
      checks: {
        total: totalChecks,
        passed: passedChecks,
        failed: failedChecks,
        pending: pendingChecks,
        github_actions: this.orderChecks(actionChecks),
        external_checks: [],
      },
      changes,
      guidance,
    };
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
   * Fetch logs with retry logic for race conditions
   *
   * When GitHub marks a check as complete, logs may not be immediately available.
   * This method retries with exponential backoff to handle the race condition.
   *
   * Retry schedule: 2s, 4s, 8s (total 3 attempts over ~14 seconds)
   *
   * @param runId - GitHub run ID
   * @param jobId - GitHub job ID (optional, for matrix strategy jobs)
   * @param maxRetries - Maximum number of retry attempts (default: 3)
   * @returns Log content, or null if all retries failed
   */
  private async fetchLogsWithRetry(runId: number, jobId?: number, maxRetries = 3): Promise<string | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.fetcher.fetchRunLogs(runId, jobId);
      } catch {
        // Intentionally suppress error (Issue #4 fix: no noisy output)
        // If this was the last attempt, break without sleeping
        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff: 2s, 4s, 8s
        const delayMs = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // All retries failed - return null (graceful degradation)
    // Logs can be inspected with debug mode if needed
    return null;
  }

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
