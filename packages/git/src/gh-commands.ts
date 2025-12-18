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
 * List open pull requests
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param limit - Max number of PRs to return (default: 5)
 * @param fields - Fields to fetch (optional)
 * @returns List of PRs
 */
export function listPullRequests(
  owner: string,
  repo: string,
  limit = 5,
  fields?: string[]
): GitHubPullRequest[] {
  const fieldList = fields ?? ['number', 'title', 'author', 'headRefName'];

  const response = safeExecSync(
    'gh',
    ['pr', 'list', '--repo', `${owner}/${repo}`, '--limit', String(limit), '--json', fieldList.join(',')],
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
