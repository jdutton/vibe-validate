/**
 * GitHub CLI Command Wrappers
 *
 * Centralized GitHub CLI (`gh`) command execution.
 * All gh commands MUST go through these functions for:
 * - Centralized execution logic
 * - Easy mocking in tests
 * - Architectural consistency
 *
 * **NEVER call safeExecSync('gh', ...) directly from other packages.**
 *
 * @packageDocumentation
 */

import { safeExecSync } from '@vibe-validate/utils';

/**
 * GitHub Pull Request
 */
export interface GitHubPullRequest {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  author: { login: string };
  isDraft?: boolean;
  mergeable?: string;
  mergeStateStatus?: string;
  labels?: Array<{ name: string }>;
  closingIssuesReferences?: Array<{
    number: number;
    title: string;
    url: string;
  }>;
  // Merge-related fields
  state?: 'OPEN' | 'CLOSED' | 'MERGED';
  mergedAt?: string;
  mergedBy?: { login: string };
  mergeCommit?: {
    oid: string;
    parents?: Array<{ totalCount?: number }>;
  };
  commits?: { totalCount?: number };
}

/**
 * GitHub Workflow Run
 */
export interface GitHubRun {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
  workflowName: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

/**
 * GitHub Workflow Job
 */
export interface GitHubJob {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string;
  completed_at: string | null;
  html_url: string;
}

/**
 * Fetch PR details from GitHub
 *
 * @param prNumber - PR number
 * @param owner - Repository owner (optional)
 * @param repo - Repository name (optional)
 * @param fields - Fields to fetch (optional, defaults to common fields)
 * @returns PR data
 */
export function fetchPRDetails(
  prNumber: number,
  owner?: string,
  repo?: string,
  fields?: string[]
): GitHubPullRequest {
  const repoFlag = owner && repo ? ['--repo', `${owner}/${repo}`] : [];
  const fieldList = fields ?? [
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
    ['pr', 'view', String(prNumber), ...repoFlag, '--json', fieldList.join(',')],
    {
      encoding: 'utf8',
    }
  );

  return JSON.parse(response as string);
}

/**
 * Fetch PR checks (statusCheckRollup)
 *
 * @param prNumber - PR number
 * @param owner - Repository owner (optional)
 * @param repo - Repository name (optional)
 * @returns PR checks data
 */
export function fetchPRChecks(prNumber: number, owner?: string, repo?: string): {
  statusCheckRollup: Array<Record<string, unknown>>;
} {
  const repoFlag = owner && repo ? ['--repo', `${owner}/${repo}`] : [];

  const response = safeExecSync(
    'gh',
    ['pr', 'view', String(prNumber), ...repoFlag, '--json', 'statusCheckRollup'],
    {
      encoding: 'utf8',
    }
  );

  return JSON.parse(response as string);
}

/**
 * Get current PR for the current branch
 *
 * Uses `gh pr view` without specifying a PR number,
 * which auto-detects based on current branch/HEAD.
 *
 * @param owner - Repository owner (optional)
 * @param repo - Repository name (optional)
 * @returns PR number, or null if no PR found
 */
export function getCurrentPR(owner?: string, repo?: string): number | null {
  const repoFlag = owner && repo ? ['--repo', `${owner}/${repo}`] : [];

  try {
    const response = safeExecSync(
      'gh',
      ['pr', 'view', ...repoFlag, '--json', 'number'],
      {
        encoding: 'utf8',
      }
    );

    const prData = JSON.parse(response as string);

    if (prData.number && typeof prData.number === 'number') {
      return prData.number;
    }

    return null;
  } catch {
    // No PR found for current branch
    return null;
  }
}

/**
 * List pull requests
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param limit - Max number of PRs to return (default: 5)
 * @param fields - Fields to fetch (optional)
 * @param state - PR state filter: 'open', 'closed', 'merged', or 'all' (default: 'open')
 * @returns List of PRs
 */
export function listPullRequests(
  owner: string,
  repo: string,
  limit = 5,
  fields?: string[],
  state: 'open' | 'closed' | 'merged' | 'all' = 'open'
): GitHubPullRequest[] {
  const fieldList = fields ?? ['number', 'title', 'author', 'headRefName'];

  const response = safeExecSync(
    'gh',
    ['pr', 'list', '--repo', `${owner}/${repo}`, '--limit', String(limit), '--state', state, '--json', fieldList.join(',')],
    {
      encoding: 'utf8',
    }
  );

  return JSON.parse(response as string);
}

/**
 * Fetch workflow run logs
 *
 * @param runId - GitHub run ID
 * @param owner - Repository owner (optional)
 * @param repo - Repository name (optional)
 * @returns Raw log output
 */
export function fetchRunLogs(runId: number, owner?: string, repo?: string): string {
  const repoFlag = owner && repo ? ['--repo', `${owner}/${repo}`] : [];

  const logs = safeExecSync('gh', ['run', 'view', String(runId), ...repoFlag, '--log'], {
    encoding: 'utf8',
  });

  return typeof logs === 'string' ? logs : logs.toString('utf8');
}

/**
 * Fetch workflow run details
 *
 * @param runId - GitHub run ID
 * @param owner - Repository owner (optional)
 * @param repo - Repository name (optional)
 * @param fields - Fields to fetch (optional)
 * @returns Run details
 */
export function fetchRunDetails(
  runId: number,
  owner?: string,
  repo?: string,
  fields?: string[]
): GitHubRun {
  const repoFlag = owner && repo ? ['--repo', `${owner}/${repo}`] : [];
  const fieldList = fields ?? ['databaseId', 'name', 'status', 'conclusion', 'workflowName', 'createdAt', 'updatedAt', 'url'];

  const response = safeExecSync(
    'gh',
    ['run', 'view', String(runId), ...repoFlag, '--json', fieldList.join(',')],
    {
      encoding: 'utf8',
    }
  );

  return JSON.parse(response as string);
}

/**
 * Fetch jobs for a workflow run
 *
 * @param runId - Run ID
 * @param owner - Repository owner (optional)
 * @param repo - Repository name (optional)
 * @returns List of jobs for the run
 */
export function fetchRunJobs(
  runId: number,
  owner?: string,
  repo?: string
): GitHubJob[] {
  // If owner/repo provided, use them in the API path
  // Otherwise rely on gh CLI to infer from current repo
  const apiPath = owner && repo
    ? `repos/${owner}/${repo}/actions/runs/${runId}/jobs`
    : `repos/:owner/:repo/actions/runs/${runId}/jobs`;

  const response = safeExecSync(
    'gh',
    ['api', apiPath],
    {
      encoding: 'utf8',
    }
  );

  const data = JSON.parse(response as string);
  return data.jobs ?? [];
}

/**
 * List workflow runs for a branch
 *
 * @param branch - Branch name
 * @param owner - Repository owner (optional)
 * @param repo - Repository name (optional)
 * @param limit - Max number of runs to return (default: 20)
 * @param fields - Fields to fetch (optional)
 * @returns List of runs
 */
export function listWorkflowRuns(
  branch: string,
  owner?: string,
  repo?: string,
  limit = 20,
  fields?: string[]
): GitHubRun[] {
  const repoFlag = owner && repo ? ['--repo', `${owner}/${repo}`] : [];
  const fieldList = fields ?? ['databaseId', 'name', 'status', 'conclusion', 'workflowName', 'createdAt'];

  const response = safeExecSync(
    'gh',
    ['run', 'list', ...repoFlag, '--branch', branch, '--limit', String(limit), '--json', fieldList.join(',')],
    {
      encoding: 'utf8',
    }
  );

  return JSON.parse(response as string);
}
