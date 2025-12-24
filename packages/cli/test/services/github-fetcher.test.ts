/**
 * Tests for GitHubFetcher
 *
 * Tests cover:
 * - PR metadata fetching
 * - Check classification (CheckRun vs StatusContext)
 * - Check results fetching
 * - Run logs fetching
 * - File changes parsing
 * - Error handling (gh CLI failures)
 *
 * @packageDocumentation
 */

import * as gitPackage from '@vibe-validate/git';
import { safeExecSync } from '@vibe-validate/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChangesContext, PRMetadata } from '../../src/schemas/watch-pr-result.schema.js';
import { GitHubFetcher } from '../../src/services/github-fetcher.js';

// Mock safeExecSync and safeExecResult
vi.mock('@vibe-validate/utils', () => ({
  safeExecSync: vi.fn(),
  safeExecResult: vi.fn(),
  isToolAvailable: vi.fn(() => true),
}));

// Mock git functions (getDiffStats, getCommitCount)
vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual('@vibe-validate/git');
  return {
    ...actual,
    getDiffStats: vi.fn(),
    getCommitCount: vi.fn(),
  };
});

// ============================================================================
// Test Helper Functions
// ============================================================================

/**
 * Creates mock PR data for GitHub API responses
 *
 * @param overrides - Partial PR data to override defaults
 * @returns Complete PR response object
 */
function createPRData(overrides: Partial<{
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  author: string;
  isDraft: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus: string;
  labels: string[];
  linkedIssues: Array<{ number: number; title: string; url: string }>;
}> = {}) {
  const defaults = {
    number: 123,
    title: 'Add new feature',
    url: 'https://github.com/test/test/pull/123',
    headRefName: 'feature/test',
    baseRefName: 'main',
    author: 'testuser',
    isDraft: false,
    mergeable: 'MERGEABLE' as const,
    mergeStateStatus: 'CLEAN',
    labels: [],
    linkedIssues: [],
  };

  const data = { ...defaults, ...overrides };

  return {
    number: data.number,
    title: data.title,
    url: data.url,
    headRefName: data.headRefName,
    baseRefName: data.baseRefName,
    author: { login: data.author },
    isDraft: data.isDraft,
    mergeable: data.mergeable,
    mergeStateStatus: data.mergeStateStatus,
    labels: data.labels.map((name) => ({ name })),
    closingIssuesReferences: {
      nodes: data.linkedIssues,
    },
  };
}

/**
 * Creates mock CheckRun data for GitHub Actions
 *
 * @param overrides - Partial check run data to override defaults
 * @returns CheckRun object for statusCheckRollup
 */
function createCheckRun(overrides: Partial<{
  name: string;
  status: string;
  conclusion: string;
  detailsUrl: string;
  startedAt: string;
  completedAt: string;
}> = {}) {
  const defaults = {
    name: 'CI / Build',
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    detailsUrl: 'https://github.com/test/test/actions/runs/12345',
    startedAt: '2025-12-16T10:00:00Z',
    completedAt: '2025-12-16T10:05:00Z',
  };

  const data = { ...defaults, ...overrides };

  return {
    __typename: 'CheckRun',
    name: data.name,
    status: data.status,
    ...(data.conclusion && { conclusion: data.conclusion }),
    detailsUrl: data.detailsUrl,
    ...(data.startedAt && { startedAt: data.startedAt }),
    ...(data.completedAt && { completedAt: data.completedAt }),
  };
}

/**
 * Creates mock StatusContext data for external checks
 *
 * @param overrides - Partial status context data to override defaults
 * @returns StatusContext object for statusCheckRollup
 */
function createStatusContext(overrides: Partial<{
  context: string;
  state: string;
  targetUrl: string;
}> = {}) {
  const defaults = {
    context: 'codecov/patch',
    state: 'SUCCESS',
    targetUrl: 'https://codecov.io/gh/test/test/pull/123',
  };

  const data = { ...defaults, ...overrides };

  return {
    __typename: 'StatusContext',
    context: data.context,
    state: data.state,
    targetUrl: data.targetUrl,
  };
}

/**
 * Creates mock run details response
 *
 * @param overrides - Partial run details to override defaults
 * @returns Run details object for gh run view --json
 */
function createRunDetails(overrides: Partial<{
  runId: number;
  name: string;
  status: string;
  conclusion: string | null;
  workflowName: string;
  createdAt: string;
  updatedAt: string;
}> = {}) {
  const defaults = {
    runId: 12345,
    name: 'CI / Build',
    status: 'completed',
    conclusion: 'success',
    workflowName: 'CI',
    createdAt: '2025-12-17T10:00:00Z',
    updatedAt: '2025-12-17T10:05:00Z',
  };

  const data = { ...defaults, ...overrides };

  return {
    name: data.name,
    status: data.status,
    conclusion: data.conclusion,
    workflowName: data.workflowName,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    url: `https://github.com/test/test/actions/runs/${data.runId}`,
  };
}

/**
 * Mocks GitHub API response for any command
 *
 * @param responseData - Data to return (will be JSON stringified)
 */
function mockGitHubAPI(responseData: unknown) {
  const jsonString = typeof responseData === 'string'
    ? responseData
    : JSON.stringify(responseData);
  vi.mocked(safeExecSync).mockReturnValue(Buffer.from(jsonString));
}

/**
 * Asserts that a GitHub CLI command was called with expected arguments
 *
 * @param command - Expected command ('pr' or 'run')
 * @param args - Expected arguments (view, PR number, etc.)
 * @param repo - Optional repo string (owner/repo)
 */
function expectAPICall(
  command: 'pr' | 'run',
  args: (string | number)[],
  repo?: string
) {
  const expectedArgs = [command, ...args.map(String)];
  if (repo) {
    expectedArgs.push('--repo', repo);
  }

  expect(safeExecSync).toHaveBeenCalledWith(
    'gh',
    expect.arrayContaining(expectedArgs),
    expect.any(Object)
  );
}

describe('GitHubFetcher', () => {
  let fetcher: GitHubFetcher;

  beforeEach(() => {
    fetcher = new GitHubFetcher();
    vi.clearAllMocks();
  });

  describe('fetchPRDetails', () => {
    it('should fetch complete PR metadata', async () => {
      mockGitHubAPI(createPRData({
        labels: ['enhancement', 'bug'],
        linkedIssues: [
          { number: 100, title: 'Issue 1', url: 'https://github.com/test/test/issues/100' },
          { number: 101, title: 'Issue 2', url: 'https://github.com/test/test/issues/101' },
        ],
      }));

      const result = await fetcher.fetchPRDetails(123);

      expect(result).toEqual({
        number: 123,
        title: 'Add new feature',
        url: 'https://github.com/test/test/pull/123',
        branch: 'feature/test',
        base_branch: 'main',
        author: 'testuser',
        draft: false,
        mergeable: true,
        merge_state_status: 'CLEAN',
        labels: ['enhancement', 'bug'],
        linked_issues: [
          { number: 100, title: 'Issue 1', url: 'https://github.com/test/test/issues/100' },
          { number: 101, title: 'Issue 2', url: 'https://github.com/test/test/issues/101' },
        ],
      } as PRMetadata);

      expectAPICall('pr', ['view', 123, '--json']);
    });

    it('should handle draft PRs', async () => {
      mockGitHubAPI(createPRData({
        number: 456,
        title: 'Draft PR',
        url: 'https://github.com/test/test/pull/456',
        headRefName: 'draft/test',
        author: 'draftuser',
        isDraft: true,
        mergeable: 'UNKNOWN',
        mergeStateStatus: 'DRAFT',
      }));

      const result = await fetcher.fetchPRDetails(456);

      expect(result.draft).toBe(true);
      expect(result.merge_state_status).toBe('DRAFT');
    });

    it('should handle unmergeable PRs', async () => {
      mockGitHubAPI(createPRData({
        number: 789,
        title: 'Conflicting PR',
        url: 'https://github.com/test/test/pull/789',
        headRefName: 'conflict/test',
        author: 'conflictuser',
        mergeable: 'CONFLICTING',
        mergeStateStatus: 'DIRTY',
      }));

      const result = await fetcher.fetchPRDetails(789);

      expect(result.mergeable).toBe(false);
      expect(result.merge_state_status).toBe('DIRTY');
    });

    it('should handle PRs without linked issues', async () => {
      mockGitHubAPI(createPRData({
        number: 999,
        title: 'PR without issues',
        url: 'https://github.com/test/test/pull/999',
        headRefName: 'feature/no-issues',
      }));

      const result = await fetcher.fetchPRDetails(999);

      expect(result.linked_issues).toEqual([]);
    });

    it('should throw error when gh CLI fails', async () => {
      vi.mocked(safeExecSync).mockImplementation(() => {
        throw new Error('gh: command not found');
      });

      await expect(fetcher.fetchPRDetails(123)).rejects.toThrow();
    });
  });

  describe('fetchChecks', () => {
    it('should fetch and classify GitHub Actions checks', async () => {
      mockGitHubAPI({
        statusCheckRollup: [
          createCheckRun(),
          createCheckRun({
            name: 'CI / Test',
            conclusion: 'FAILURE',
            detailsUrl: 'https://github.com/test/test/actions/runs/12346',
            completedAt: '2025-12-16T10:10:00Z',
          }),
        ],
      });

      const results = await fetcher.fetchChecks(123);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        type: 'github_action',
        name: 'CI / Build',
        status: 'completed',
        conclusion: 'success',
        run_id: 12345,
      });
      expect(results[1]).toMatchObject({
        type: 'github_action',
        name: 'CI / Test',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12346,
      });
    });

    it('should fetch and classify external status checks', async () => {
      mockGitHubAPI({
        statusCheckRollup: [
          createStatusContext(),
          createStatusContext({
            context: 'SonarCloud Code Analysis',
            state: 'FAILURE',
            targetUrl: 'https://sonarcloud.io/project/issues?id=test',
          }),
        ],
      });

      const results = await fetcher.fetchChecks(123);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        type: 'external',
        name: 'codecov/patch',
        status: 'completed',
        conclusion: 'success',
        url: 'https://codecov.io/gh/test/test/pull/123',
      });
      expect(results[1]).toMatchObject({
        type: 'external',
        name: 'SonarCloud Code Analysis',
        status: 'completed',
        conclusion: 'failure',
        url: 'https://sonarcloud.io/project/issues?id=test',
      });
    });

    it('should handle mixed check types', async () => {
      mockGitHubAPI({
        statusCheckRollup: [
          createCheckRun(),
          createStatusContext(),
        ],
      });

      const results = await fetcher.fetchChecks(123);

      expect(results).toHaveLength(2);
      expect(results[0].type).toBe('github_action');
      expect(results[1].type).toBe('external');
    });

    it('should handle in-progress checks', async () => {
      mockGitHubAPI({
        statusCheckRollup: [
          createCheckRun({
            status: 'IN_PROGRESS',
            conclusion: '',
            completedAt: '',
          }),
        ],
      });

      const results = await fetcher.fetchChecks(123);

      expect(results[0]).toMatchObject({
        status: 'in_progress',
        conclusion: undefined,
      });
    });

    it('should handle queued checks', async () => {
      mockGitHubAPI({
        statusCheckRollup: [
          createCheckRun({
            status: 'QUEUED',
            conclusion: '',
            startedAt: '',
            completedAt: '',
          }),
        ],
      });

      const results = await fetcher.fetchChecks(123);

      expect(results[0]).toMatchObject({
        status: 'queued',
      });
    });

    it('should extract run IDs from GitHub Actions URLs', async () => {
      mockGitHubAPI({
        statusCheckRollup: [
          createCheckRun({
            detailsUrl: 'https://github.com/test/test/actions/runs/987654321',
          }),
        ],
      });

      const results = await fetcher.fetchChecks(123);

      expect(results[0].run_id).toBe(987654321);
    });

    it('should throw error when gh CLI fails', async () => {
      vi.mocked(safeExecSync).mockImplementation(() => {
        throw new Error('gh: authentication failed');
      });

      await expect(fetcher.fetchChecks(123)).rejects.toThrow();
    });
  });

  describe('fetchRunLogs', () => {
    it('should fetch logs for a given run ID', async () => {
      const mockLogs = 'Running tests...\nTest 1: PASS\nTest 2: FAIL\nDone.';
      mockGitHubAPI(mockLogs);

      const logs = await fetcher.fetchRunLogs(12345);

      expect(logs).toBe(mockLogs);
      expectAPICall('run', ['view', 12345, '--log']);
    });

    it('should throw error when run not found', async () => {
      vi.mocked(safeExecSync).mockImplementation(() => {
        throw new Error('run not found');
      });

      await expect(fetcher.fetchRunLogs(99999)).rejects.toThrow();
    });
  });

  describe('fetchFileChanges', () => {
    it('should parse git diff --numstat output', async () => {
      const mockDiffOutput = `10\t5\tsrc/file1.ts
20\t0\tsrc/file2.ts
0\t15\tsrc/file3.ts
5\t5\tREADME.md`;

      const mockCommitCount = '3';

      // Mock git package functions instead of safeExecSync
      vi.spyOn(gitPackage, 'getDiffStats').mockReturnValue(mockDiffOutput);
      vi.spyOn(gitPackage, 'getCommitCount').mockReturnValue(mockCommitCount);

      const changes = await fetcher.fetchFileChanges(123);

      expect(changes).toEqual({
        files_changed: 4,
        insertions: 35,
        deletions: 25,
        commits: 3,
        top_files: [
          { file: 'src/file2.ts', insertions: 20, deletions: 0, new_file: false },
          { file: 'src/file1.ts', insertions: 10, deletions: 5, new_file: false },
          { file: 'src/file3.ts', insertions: 0, deletions: 15, new_file: false },
          { file: 'README.md', insertions: 5, deletions: 5, new_file: false },
        ],
      } as ChangesContext);
    });

    it('should limit top_files to 10', async () => {
      const mockDiffOutput = Array.from({ length: 20 }, (_, i) => `${i + 1}\t${i}\tfile${i}.ts`).join('\n');
      const mockCommitCount = '1';

      // Mock git package functions instead of safeExecSync
      vi.spyOn(gitPackage, 'getDiffStats').mockReturnValue(mockDiffOutput);
      vi.spyOn(gitPackage, 'getCommitCount').mockReturnValue(mockCommitCount);

      const changes = await fetcher.fetchFileChanges(123);

      expect(changes.top_files).toHaveLength(10);
      expect(changes.files_changed).toBe(20);
    });

    it('should detect new files', async () => {
      const mockDiffOutput = `10\t0\tsrc/new-file.ts
0\t0\t-`;

      const mockCommitCount = '1';

      // Mock git package functions instead of safeExecSync
      vi.spyOn(gitPackage, 'getDiffStats').mockReturnValue(mockDiffOutput);
      vi.spyOn(gitPackage, 'getCommitCount').mockReturnValue(mockCommitCount);

      const changes = await fetcher.fetchFileChanges(123);

      expect(changes.top_files?.[0].new_file).toBe(true);
    });

    it('should handle empty diffs', async () => {
      const mockDiffOutput = '';
      const mockCommitCount = '0';

      // Mock git package functions instead of safeExecSync
      vi.spyOn(gitPackage, 'getDiffStats').mockReturnValue(mockDiffOutput);
      vi.spyOn(gitPackage, 'getCommitCount').mockReturnValue(mockCommitCount);

      const changes = await fetcher.fetchFileChanges(123);

      expect(changes).toEqual({
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        commits: 0,
        top_files: [],
      });
    });

    it('should handle git command failures gracefully', async () => {
      // Mock git package functions to throw errors
      vi.spyOn(gitPackage, 'getDiffStats').mockImplementation(() => {
        throw new Error('git: not a git repository');
      });

      await expect(fetcher.fetchFileChanges(123)).rejects.toThrow();
    });
  });

  describe('classifyCheck', () => {
    it('should classify CheckRun correctly', () => {
      const checkRun = {
        __typename: 'CheckRun',
        name: 'CI / Build',
        detailsUrl: 'https://github.com/test/test/actions/runs/12345',
      };

      const type = fetcher['classifyCheck'](checkRun);

      expect(type).toBe('CheckRun');
    });

    it('should classify StatusContext correctly', () => {
      const statusContext = {
        __typename: 'StatusContext',
        context: 'codecov/patch',
        targetUrl: 'https://codecov.io/gh/test/test/pull/123',
      };

      const type = fetcher['classifyCheck'](statusContext);

      expect(type).toBe('StatusContext');
    });
  });

  describe('extractRunId', () => {
    it('should extract run ID from GitHub Actions URL', () => {
      const url = 'https://github.com/test/test/actions/runs/987654321';
      const runId = fetcher['extractRunId'](url);

      expect(runId).toBe(987654321);
    });

    it('should extract run ID with job suffix', () => {
      const url = 'https://github.com/test/test/actions/runs/123456/job/789';
      const runId = fetcher['extractRunId'](url);

      expect(runId).toBe(123456);
    });

    it('should return null for invalid URLs', () => {
      const url = 'https://codecov.io/gh/test/test';
      const runId = fetcher['extractRunId'](url);

      expect(runId).toBeNull();
    });
  });

  describe('calculateDuration', () => {
    it('should calculate duration in seconds', () => {
      const start = '2025-12-16T10:00:00Z';
      const end = '2025-12-16T10:00:30Z';
      const duration = fetcher['calculateDuration'](start, end);

      expect(duration).toBe('30s');
    });

    it('should calculate duration in minutes and seconds', () => {
      const start = '2025-12-16T10:00:00Z';
      const end = '2025-12-16T10:02:30Z';
      const duration = fetcher['calculateDuration'](start, end);

      expect(duration).toBe('2m30s');
    });

    it('should calculate duration in hours, minutes, and seconds', () => {
      const start = '2025-12-16T10:00:00Z';
      const end = '2025-12-16T11:05:30Z';
      const duration = fetcher['calculateDuration'](start, end);

      expect(duration).toBe('1h5m30s');
    });

    it('should handle missing end time', () => {
      const start = '2025-12-16T10:00:00Z';
      const duration = fetcher['calculateDuration'](start);

      expect(duration).toMatch(/^\d+[hms]/); // Should calculate from start to now
    });

    it('should handle null end time for in-progress checks', () => {
      const start = '2025-12-16T10:00:00Z';
      // GitHub API returns null for completedAt on in-progress checks
      // TypeScript allows null since the signature is: calculateDuration(start?: string, end?: string)
      // But at runtime, null gets passed from the API
      const duration = fetcher['calculateDuration'](start, null as unknown as string);

      // Should treat null as "now" and calculate elapsed time
      expect(duration).toMatch(/^\d+[hms]/);
      expect(duration).not.toContain('-'); // Should NOT be negative
    });

    it('should handle invalid/malformed timestamps gracefully', () => {
      // Test invalid start time
      const duration1 = fetcher['calculateDuration']('invalid-date', '2025-12-16T10:00:00Z');
      expect(duration1).toBe('0s'); // Should return 0s for invalid start

      // Test both invalid
      const duration2 = fetcher['calculateDuration']('invalid', 'also-invalid');
      expect(duration2).toBe('0s');
    });
  });

  describe('Cross-repo support', () => {
    it('should create fetcher without repo (defaults to current repo)', () => {
      const defaultFetcher = new GitHubFetcher();
      expect(defaultFetcher).toBeDefined();
      expect(defaultFetcher['owner']).toBeUndefined();
      expect(defaultFetcher['repo']).toBeUndefined();
    });

    it('should create fetcher with owner/repo', () => {
      const crossRepoFetcher = new GitHubFetcher('jdutton', 'other-repo');
      expect(crossRepoFetcher).toBeDefined();
      expect(crossRepoFetcher['owner']).toBe('jdutton');
      expect(crossRepoFetcher['repo']).toBe('other-repo');
    });

    it('should pass --repo flag to gh pr view for PR details', async () => {
      const crossRepoFetcher = new GitHubFetcher('test-owner', 'test-repo');
      mockGitHubAPI(createPRData({
        number: 99,
        title: 'Test PR',
        url: 'https://github.com/test-owner/test-repo/pull/99',
        headRefName: 'feature',
      }));

      await crossRepoFetcher.fetchPRDetails(99);

      expectAPICall('pr', ['view', 99, '--json'], 'test-owner/test-repo');
    });

    it('should pass --repo flag to gh pr view for checks', async () => {
      const crossRepoFetcher = new GitHubFetcher('test-owner', 'test-repo');
      mockGitHubAPI({ statusCheckRollup: [] });

      await crossRepoFetcher.fetchChecks(99);

      expectAPICall('pr', ['view', 99], 'test-owner/test-repo');
    });

    it('should pass --repo flag to gh run view for logs', async () => {
      const crossRepoFetcher = new GitHubFetcher('test-owner', 'test-repo');
      mockGitHubAPI('Test log output');

      await crossRepoFetcher.fetchRunLogs(12345);

      expectAPICall('run', ['view', 12345, '--repo', 'test-owner/test-repo']);
    });

    it('should pass --repo flag to gh run view for run details', async () => {
      const crossRepoFetcher = new GitHubFetcher('test-owner', 'test-repo');
      mockGitHubAPI(createRunDetails({
        conclusion: 'failure',
        url: 'https://github.com/test-owner/test-repo/actions/runs/12345',
      }));

      await crossRepoFetcher.fetchRunDetails(12345);

      expectAPICall('run', ['view', 12345, '--repo', 'test-owner/test-repo', '--json']);
    });
  });

  describe('fetchRunDetails', () => {
    it('should fetch run metadata with all fields', async () => {
      mockGitHubAPI(createRunDetails({
        conclusion: 'failure',
      }));

      const result = await fetcher.fetchRunDetails(12345);

      expect(result).toEqual({
        run_id: 12345,
        name: 'CI / Build',
        workflow: 'CI',
        status: 'completed',
        conclusion: 'failure',
        started_at: '2025-12-17T10:00:00Z',
        duration: expect.any(String),
        url: 'https://github.com/test/test/actions/runs/12345',
      });

      expectAPICall('run', ['view', 12345, '--json', 'name,status,conclusion,workflowName,createdAt,updatedAt,url']);
    });

    it('should handle in-progress runs (no conclusion yet)', async () => {
      mockGitHubAPI(createRunDetails({
        runId: 67890,
        name: 'Tests / Unit',
        status: 'in_progress',
        conclusion: null,
        workflowName: 'Tests',
        createdAt: '2025-12-17T11:00:00Z',
        updatedAt: '2025-12-17T11:02:00Z',
      }));

      const result = await fetcher.fetchRunDetails(67890);

      expect(result.status).toBe('in_progress');
      expect(result.conclusion).toBeUndefined();
      expect(result.duration).toBeDefined(); // Should calculate from createdAt to now
    });

    it('should handle queued runs', async () => {
      mockGitHubAPI(createRunDetails({
        runId: 11111,
        name: 'Deploy / Production',
        status: 'queued',
        conclusion: null,
        workflowName: 'Deploy',
        createdAt: '2025-12-17T12:00:00Z',
        updatedAt: '2025-12-17T12:00:00Z',
      }));

      const result = await fetcher.fetchRunDetails(11111);

      expect(result.status).toBe('queued');
      expect(result.conclusion).toBeUndefined();
    });

    it('should extract workflow name from run data', async () => {
      mockGitHubAPI(createRunDetails({
        runId: 22222,
        name: 'Long Workflow Name / Job / Step',
        workflowName: 'Long Workflow Name',
        createdAt: '2025-12-17T13:00:00Z',
        updatedAt: '2025-12-17T13:10:00Z',
      }));

      const result = await fetcher.fetchRunDetails(22222);

      expect(result.workflow).toBe('Long Workflow Name');
    });

    it('should handle successful runs', async () => {
      mockGitHubAPI(createRunDetails({
        runId: 33333,
        name: 'CI / Test',
        createdAt: '2025-12-17T14:00:00Z',
        updatedAt: '2025-12-17T14:03:00Z',
      }));

      const result = await fetcher.fetchRunDetails(33333);

      expect(result.conclusion).toBe('success');
      expect(result.status).toBe('completed');
    });

    it('should handle cancelled runs', async () => {
      mockGitHubAPI(createRunDetails({
        runId: 44444,
        conclusion: 'cancelled',
        createdAt: '2025-12-17T15:00:00Z',
        updatedAt: '2025-12-17T15:01:00Z',
      }));

      const result = await fetcher.fetchRunDetails(44444);

      expect(result.conclusion).toBe('cancelled');
    });

    it('should handle timed out runs', async () => {
      mockGitHubAPI(createRunDetails({
        runId: 55555,
        name: 'CI / Long Test',
        conclusion: 'timed_out',
        createdAt: '2025-12-17T16:00:00Z',
        updatedAt: '2025-12-17T17:00:00Z',
      }));

      const result = await fetcher.fetchRunDetails(55555);

      expect(result.conclusion).toBe('timed_out');
    });

    it('should throw error when gh CLI fails', async () => {
      vi.mocked(safeExecSync).mockImplementation(() => {
        throw new Error('gh: run not found');
      });

      await expect(fetcher.fetchRunDetails(99999)).rejects.toThrow('gh: run not found');
    });
  });
});
