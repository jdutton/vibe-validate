/**
 * GitHubFetcher - Fetch PR metadata and check results from GitHub API
 *
 * Uses `gh` CLI to fetch:
 * - Complete PR metadata (title, author, labels, linked issues, etc.)
 * - Check results (GitHub Actions + external status checks)
 * - Run logs from GitHub Actions
 * - File changes from git diff
 *
 * @packageDocumentation
 */

import { safeExecSync } from '@vibe-validate/utils';

import type {
  ChangesContext,
  CheckConclusion,
  CheckStatus,
  FileChange,
  LinkedIssue,
  MergeStateStatus,
  PRMetadata,
} from '../schemas/watch-pr-result.schema.js';

/**
 * Check result (internal type for classification)
 */
export interface CheckResult {
  /** Check type (github_action or external) */
  type: 'github_action' | 'external';

  /** Check name */
  name: string;

  /** Check status */
  status: CheckStatus;

  /** Check conclusion (if completed) */
  conclusion?: CheckConclusion;

  /** GitHub run ID (for GitHub Actions) */
  run_id?: number;

  /** Workflow name (for GitHub Actions) */
  workflow?: string;

  /** Started at (ISO 8601) */
  started_at?: string;

  /** Duration (human-readable) */
  duration?: string;

  /** URL (for external checks) */
  url?: string;

  /** Provider name (for external checks) */
  provider?: string;
}

/**
 * Run details (returned by fetchRunDetails)
 */
export interface RunDetails {
  /** GitHub run ID */
  run_id: number;

  /** Check/job name */
  name: string;

  /** Workflow name */
  workflow: string;

  /** Run status */
  status: CheckStatus;

  /** Run conclusion (if completed) */
  conclusion?: CheckConclusion;

  /** Started at (ISO 8601) */
  started_at: string;

  /** Duration (human-readable) */
  duration: string;

  /** Run URL */
  url: string;
}

/**
 * GitHubFetcher - Fetch PR data from GitHub API via gh CLI
 */
export class GitHubFetcher {
  private readonly repoFlag: string[];

  /**
   * Create GitHubFetcher
   *
   * @param owner - Repository owner (optional, defaults to current repo)
   * @param repo - Repository name (optional, defaults to current repo)
   */
  constructor(owner?: string, repo?: string) {
    // Build --repo flag if owner/repo provided
    this.repoFlag = owner && repo ? ['--repo', `${owner}/${repo}`] : [];
  }

  /**
   * Fetch complete PR metadata
   *
   * @param prNumber - PR number
   * @returns PR metadata
   */
  async fetchPRDetails(prNumber: number): Promise<PRMetadata> {
    const fields = [
      'number',
      'title',
      'url',
      'headRefName',
      'baseRefName',
      'author',
      'isDraft',
      'mergeable',
      'mergeStateStatus',
      'labels',
      'closingIssuesReferences',
    ];

    const response = safeExecSync(
      'gh',
      ['pr', 'view', String(prNumber), ...this.repoFlag, '--json', fields.join(',')],
      {
        encoding: 'utf8',
      }
    );

    const data = JSON.parse(response as string);

    // Map GitHub API response to PRMetadata schema
    return {
      number: data.number,
      title: data.title,
      url: data.url,
      branch: data.headRefName,
      base_branch: data.baseRefName,
      author: data.author.login,
      draft: data.isDraft ?? false,
      mergeable: data.mergeable === 'MERGEABLE',
      merge_state_status: this.normalizeMergeStateStatus(data.mergeStateStatus),
      labels: data.labels?.map((label: { name: string }) => label.name) ?? [],
      linked_issues: this.extractLinkedIssues(data.closingIssuesReferences),
    };
  }

  /**
   * Fetch check results (GitHub Actions + external)
   *
   * @param prNumber - PR number
   * @returns Check results
   */
  async fetchChecks(prNumber: number): Promise<CheckResult[]> {
    const response = safeExecSync(
      'gh',
      ['pr', 'view', String(prNumber), ...this.repoFlag, '--json', 'statusCheckRollup'],
      {
        encoding: 'utf8',
      }
    );

    const data = JSON.parse(response as string);
    const checks: CheckResult[] = [];

    for (const check of data.statusCheckRollup ?? []) {
      const type = this.classifyCheck(check);

      if (type === 'CheckRun') {
        checks.push(this.mapCheckRun(check));
      } else {
        checks.push(this.mapStatusContext(check));
      }
    }

    return checks;
  }

  /**
   * Fetch run logs for a GitHub Actions run
   *
   * @param runId - GitHub run ID
   * @returns Raw log output
   */
  async fetchRunLogs(runId: number): Promise<string> {
    const logs = safeExecSync('gh', ['run', 'view', String(runId), ...this.repoFlag, '--log'], {
      encoding: 'utf8',
    });

    // safeExecSync returns Buffer or string depending on encoding option
    return typeof logs === 'string' ? logs : logs.toString('utf8');
  }

  /**
   * Fetch details for a specific GitHub Actions run
   *
   * Useful for watching specific failed runs to test extraction.
   *
   * @param runId - GitHub run ID
   * @returns Run details
   */
  async fetchRunDetails(runId: number): Promise<RunDetails> {
    const fields = ['name', 'status', 'conclusion', 'workflowName', 'createdAt', 'updatedAt', 'url'];

    const response = safeExecSync(
      'gh',
      ['run', 'view', String(runId), ...this.repoFlag, '--json', fields.join(',')],
      {
        encoding: 'utf8',
      }
    );

    const data = JSON.parse(response as string);

    // Map GitHub API response to RunDetails
    return {
      run_id: runId,
      name: data.name,
      workflow: data.workflowName,
      status: this.normalizeStatus(data.status),
      conclusion: data.conclusion ? this.normalizeConclusion(data.conclusion) : undefined,
      started_at: data.createdAt,
      duration: this.calculateDuration(data.createdAt, data.updatedAt),
      url: data.url,
    };
  }

  /**
   * Fetch all workflow runs for a PR
   *
   * @param prNumber - PR number
   * @returns List of workflow runs
   */
  async fetchRunsForPR(prNumber: number): Promise<Array<{
    run_id: number;
    workflow_name: string;
    status: string;
    conclusion: string | null;
    started_at: string;
  }>> {
    // First get the PR branch name
    const prResponse = safeExecSync(
      'gh',
      ['pr', 'view', String(prNumber), ...this.repoFlag, '--json', 'headRefName'],
      {
        encoding: 'utf8',
      }
    );

    const prData = JSON.parse(prResponse as string);
    const branchName = prData.headRefName;

    // Fetch workflow runs for the branch
    const response = safeExecSync(
      'gh',
      ['run', 'list', '--branch', branchName, ...this.repoFlag, '--json', 'databaseId,workflowName,status,conclusion,createdAt,updatedAt', '--limit', '20'],
      {
        encoding: 'utf8',
      }
    );

    const runs = JSON.parse(response as string) as Array<{
      databaseId: number;
      workflowName: string;
      status: string;
      conclusion: string | null;
      createdAt: string;
      updatedAt: string;
    }>;

    // Transform to expected format
    return runs.map((run) => ({
      run_id: run.databaseId,
      workflow_name: run.workflowName,
      status: run.status,
      conclusion: run.conclusion,
      started_at: run.createdAt,
      duration: this.calculateDuration(run.createdAt, run.updatedAt),
    }));
  }

  /**
   * Fetch file changes for a PR
   *
   * Uses git diff --numstat to get file change statistics.
   *
   * @param _prNumber - PR number (unused - we use git diff from current branch)
   * @returns File change context
   */
  async fetchFileChanges(_prNumber: number): Promise<ChangesContext> {
    // Get diff stats using git diff --numstat
    const diffOutputRaw = safeExecSync('git', ['diff', '--numstat', `origin/main...HEAD`], {
      encoding: 'utf8',
    });
    const diffOutput = typeof diffOutputRaw === 'string' ? diffOutputRaw : diffOutputRaw.toString('utf8');

    // Get commit count
    const commitCountRaw = safeExecSync('git', ['rev-list', '--count', 'origin/main...HEAD'], {
      encoding: 'utf8',
    });
    const commitCount = typeof commitCountRaw === 'string' ? commitCountRaw : commitCountRaw.toString('utf8');

    // Parse diff output
    const lines = diffOutput.trim().split('\n').filter((line) => line.length > 0);

    let totalInsertions = 0;
    let totalDeletions = 0;
    const files: FileChange[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split('\t');
      if (parts.length !== 3) continue;

      // Skip binary file markers (0\t0\t-)
      if (parts[0] === '0' && parts[1] === '0' && parts[2] === '-') {
        continue;
      }

      const insertions = parts[0] === '-' ? 0 : Number.parseInt(parts[0], 10);
      const deletions = parts[1] === '-' ? 0 : Number.parseInt(parts[1], 10);
      const file = parts[2];

      // Detect new files - next line is 0\t0\t- marker
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      const nextParts = nextLine.split('\t');
      const isNewFile = nextParts.length === 3 && nextParts[0] === '0' && nextParts[1] === '0' && nextParts[2] === '-';

      totalInsertions += insertions;
      totalDeletions += deletions;

      files.push({
        file,
        insertions,
        deletions,
        new_file: isNewFile,
      });
    }

    // Sort by total changes (insertions + deletions) and limit to top 10
    // Using toSorted to avoid mutation (sonarjs requirement)
    const topFiles = [...files]
      .sort((a, b) => b.insertions + b.deletions - (a.insertions + a.deletions))
      .slice(0, 10);

    return {
      files_changed: files.length,
      insertions: totalInsertions,
      deletions: totalDeletions,
      commits: Number.parseInt(commitCount.trim(), 10),
      top_files: topFiles,
    };
  }

  /**
   * Classify check type
   *
   * @param check - Check object from GitHub API
   * @returns 'CheckRun' or 'StatusContext'
   */
  private classifyCheck(check: { __typename?: string }): 'CheckRun' | 'StatusContext' {
    return check.__typename === 'CheckRun' ? 'CheckRun' : 'StatusContext';
  }

  /**
   * Map CheckRun to internal CheckResult
   *
   * @param check - CheckRun from GitHub API
   * @returns CheckResult
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapCheckRun(check: any): CheckResult {
    const runId = this.extractRunId(check.detailsUrl);
    const workflow = this.extractWorkflowName(check.name);

    return {
      type: 'github_action',
      name: check.name,
      status: this.normalizeStatus(check.status),
      conclusion: check.conclusion ? this.normalizeConclusion(check.conclusion) : undefined,
      run_id: runId ?? undefined,
      workflow,
      started_at: check.startedAt,
      duration: this.calculateDuration(check.startedAt, check.completedAt),
    };
  }

  /**
   * Map StatusContext to internal CheckResult
   *
   * @param check - StatusContext from GitHub API
   * @returns CheckResult
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapStatusContext(check: any): CheckResult {
    return {
      type: 'external',
      name: check.context,
      status: 'completed',
      conclusion: this.normalizeStatusContextState(check.state),
      url: check.targetUrl,
      provider: this.detectProvider(check.context),
    };
  }

  /**
   * Extract run ID from GitHub Actions URL
   *
   * @param url - GitHub Actions URL
   * @returns Run ID or null
   */
  private extractRunId(url: string): number | null {
    const regex = /\/runs\/(\d+)/;
    const match = regex.exec(url);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  /**
   * Extract workflow name from check name
   *
   * @param checkName - Check name (e.g., "CI / Build")
   * @returns Workflow name
   */
  private extractWorkflowName(checkName: string): string {
    // Extract workflow name before first /
    const parts = checkName.split('/');
    return parts[0].trim();
  }

  /**
   * Calculate duration between two timestamps
   *
   * @param start - Start time (ISO 8601)
   * @param end - End time (ISO 8601, optional - defaults to now)
   * @returns Human-readable duration (e.g., "2m30s")
   */
  private calculateDuration(start?: string, end?: string): string {
    if (!start) return '0s';

    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const durationMs = endTime - startTime;

    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h${minutes % 60}m${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Normalize GitHub status to CheckStatus
   *
   * @param status - GitHub status
   * @returns CheckStatus
   */
  private normalizeStatus(status: string): CheckStatus {
    const normalized = status.toLowerCase();
    if (normalized === 'completed') return 'completed';
    if (normalized === 'in_progress') return 'in_progress';
    return 'queued';
  }

  /**
   * Normalize GitHub conclusion to CheckConclusion
   *
   * @param conclusion - GitHub conclusion
   * @returns CheckConclusion
   */
  private normalizeConclusion(conclusion: string): CheckConclusion {
    const normalized = conclusion.toLowerCase();
    if (normalized === 'success') return 'success';
    if (normalized === 'failure') return 'failure';
    if (normalized === 'neutral') return 'neutral';
    if (normalized === 'cancelled') return 'cancelled';
    if (normalized === 'skipped') return 'skipped';
    if (normalized === 'timed_out') return 'timed_out';
    return 'action_required';
  }

  /**
   * Normalize StatusContext state to CheckConclusion
   *
   * @param state - StatusContext state
   * @returns CheckConclusion
   */
  private normalizeStatusContextState(state: string): CheckConclusion {
    const normalized = state.toLowerCase();
    if (normalized === 'success') return 'success';
    if (normalized === 'failure' || normalized === 'error') return 'failure';
    if (normalized === 'pending') return 'action_required';
    return 'neutral';
  }

  /**
   * Normalize merge state status
   *
   * @param status - GitHub merge state status
   * @returns MergeStateStatus
   */
  private normalizeMergeStateStatus(status: string): MergeStateStatus {
    const normalized = status.toUpperCase();
    if (normalized === 'BEHIND') return 'BEHIND';
    if (normalized === 'BLOCKED') return 'BLOCKED';
    if (normalized === 'CLEAN') return 'CLEAN';
    if (normalized === 'DIRTY') return 'DIRTY';
    if (normalized === 'DRAFT') return 'DRAFT';
    if (normalized === 'HAS_HOOKS') return 'HAS_HOOKS';
    if (normalized === 'UNSTABLE') return 'UNSTABLE';
    return 'UNKNOWN';
  }

  /**
   * Extract linked issues from closing issues references
   *
   * @param closingIssuesReferences - Closing issues references from GitHub API
   * @returns Linked issues
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractLinkedIssues(closingIssuesReferences: any): LinkedIssue[] {
    if (!closingIssuesReferences?.nodes) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return closingIssuesReferences.nodes.map((issue: any) => ({
      number: issue.number,
      title: issue.title,
      url: issue.url,
    }));
  }

  /**
   * Detect provider from check name
   *
   * @param checkName - Check name
   * @returns Provider name
   */
  private detectProvider(checkName: string): string {
    const lower = checkName.toLowerCase();
    if (lower.includes('codecov')) return 'codecov';
    if (lower.includes('sonar')) return 'sonarcloud';
    if (lower.includes('circleci')) return 'circleci';
    if (lower.includes('travis')) return 'travis';
    if (lower.includes('jenkins')) return 'jenkins';
    return 'unknown';
  }
}
