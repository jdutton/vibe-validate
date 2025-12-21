/**
 * Tests for GitHub CLI command wrappers
 */

import * as utils from '@vibe-validate/utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  fetchPRDetails,
  fetchPRChecks,
  getCurrentPR,
  listPullRequests,
  fetchRunLogs,
  fetchRunDetails,
  fetchRunJobs,
  listWorkflowRuns,
  type GitHubPullRequest,
  type GitHubRun,
  type GitHubJob,
} from '../src/gh-commands.js';

// Mock @vibe-validate/utils
vi.mock('@vibe-validate/utils', async () => {
  const actual = await vi.importActual('@vibe-validate/utils');
  return {
    ...actual,
    safeExecSync: vi.fn(),
  };
});

/**
 * Helper to test gh commands with custom parameters
 * Reduces duplication in test assertions
 */
function testGhCommandWithParam(
  fn: (..._args: any[]) => any,
  fnArgs: any[],
  expectedParam: string,
  expectedValue: string
) {
  vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify([]));
  fn(...fnArgs);
  expect(utils.safeExecSync).toHaveBeenCalledWith(
    'gh',
    expect.arrayContaining([expectedParam, expectedValue]),
    expect.any(Object)
  );
}

describe('gh-commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchPRDetails', () => {
    it('should fetch PR details with default fields', () => {
      const mockPR: GitHubPullRequest = {
        number: 92,
        title: 'Test PR',
        url: 'https://github.com/owner/repo/pull/92',
        headRefName: 'feature/test',
        baseRefName: 'main',
        author: { login: 'testuser' },
        isDraft: false,
        mergeable: 'MERGEABLE',
      };

      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify(mockPR));

      const result = fetchPRDetails(92);

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        [
          'pr',
          'view',
          '92',
          '--json',
          'number,title,url,headRefName,baseRefName,author,isDraft,mergeable,mergeStateStatus,labels,closingIssuesReferences',
        ],
        { encoding: 'utf8' }
      );
      expect(result).toEqual(mockPR);
    });

    it('should fetch PR details with custom fields', () => {
      const mockPR = { number: 92, title: 'Test PR' };
      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify(mockPR));

      const result = fetchPRDetails(92, undefined, undefined, ['number', 'title']);

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        ['pr', 'view', '92', '--json', 'number,title'],
        { encoding: 'utf8' }
      );
      expect(result).toEqual(mockPR);
    });

    it('should include --repo flag when owner/repo provided', () => {
      const mockPR: GitHubPullRequest = {
        number: 92,
        title: 'Test PR',
        url: 'https://github.com/owner/repo/pull/92',
        headRefName: 'feature/test',
        baseRefName: 'main',
        author: { login: 'testuser' },
      };

      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify(mockPR));

      const result = fetchPRDetails(92, 'owner', 'repo');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--repo', 'owner/repo']),
        expect.any(Object)
      );
      expect(result).toEqual(mockPR);
    });

    it('should handle PR with labels and issues', () => {
      const mockPR: GitHubPullRequest = {
        number: 92,
        title: 'Test PR',
        url: 'https://github.com/owner/repo/pull/92',
        headRefName: 'feature/test',
        baseRefName: 'main',
        author: { login: 'testuser' },
        labels: [{ name: 'bug' }, { name: 'enhancement' }],
        closingIssuesReferences: [
          { number: 1, title: 'Issue 1', url: 'https://github.com/owner/repo/issues/1' },
        ],
      };

      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify(mockPR));

      const result = fetchPRDetails(92);

      expect(result.labels).toHaveLength(2);
      expect(result.closingIssuesReferences).toHaveLength(1);
    });
  });

  describe('fetchPRChecks', () => {
    it('should fetch PR checks', () => {
      const mockChecks = {
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'Test', status: 'COMPLETED', conclusion: 'SUCCESS' },
        ],
      };

      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify(mockChecks));

      const result = fetchPRChecks(92);

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        ['pr', 'view', '92', '--json', 'statusCheckRollup'],
        { encoding: 'utf8' }
      );
      expect(result).toEqual(mockChecks);
    });

    it('should include --repo flag when owner/repo provided', () => {
      const mockChecks = { statusCheckRollup: [] };
      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify(mockChecks));

      fetchPRChecks(92, 'owner', 'repo');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--repo', 'owner/repo']),
        expect.any(Object)
      );
    });
  });

  describe('getCurrentPR', () => {
    it('should return PR number when PR exists for current branch', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify({ number: 92 }));

      const result = getCurrentPR();

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        ['pr', 'view', '--json', 'number'],
        { encoding: 'utf8' }
      );
      expect(result).toBe(92);
    });

    it('should return null when no PR exists', () => {
      vi.mocked(utils.safeExecSync).mockImplementation(() => {
        throw new Error('no pull requests found');
      });

      const result = getCurrentPR();

      expect(result).toBeNull();
    });

    it('should return null when response has no number', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify({}));

      const result = getCurrentPR();

      expect(result).toBeNull();
    });

    it('should return null when number is not a number', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify({ number: 'invalid' }));

      const result = getCurrentPR();

      expect(result).toBeNull();
    });

    it('should include --repo flag when owner/repo provided', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify({ number: 92 }));

      getCurrentPR('owner', 'repo');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--repo', 'owner/repo']),
        expect.any(Object)
      );
    });
  });

  describe('listPullRequests', () => {
    it('should list PRs with default fields and limit', () => {
      const mockPRs: GitHubPullRequest[] = [
        {
          number: 92,
          title: 'PR 1',
          url: 'https://github.com/owner/repo/pull/92',
          headRefName: 'feature/test',
          baseRefName: 'main',
          author: { login: 'user1' },
        },
        {
          number: 91,
          title: 'PR 2',
          url: 'https://github.com/owner/repo/pull/91',
          headRefName: 'feature/other',
          baseRefName: 'main',
          author: { login: 'user2' },
        },
      ];

      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify(mockPRs));

      const result = listPullRequests('owner', 'repo');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        ['pr', 'list', '--repo', 'owner/repo', '--limit', '5', '--json', 'number,title,author,headRefName'],
        { encoding: 'utf8' }
      );
      expect(result).toHaveLength(2);
    });

    it('should respect custom limit', () => {
      testGhCommandWithParam(listPullRequests, ['owner', 'repo', 10], '--limit', '10');
    });

    it('should use custom fields', () => {
      testGhCommandWithParam(
        listPullRequests,
        ['owner', 'repo', 5, ['number', 'title', 'url']],
        '--json',
        'number,title,url'
      );
    });
  });

  describe('fetchRunLogs', () => {
    it('should fetch workflow run logs', () => {
      const mockLogs = 'Run logs output\nTest passed\nDone';
      vi.mocked(utils.safeExecSync).mockReturnValue(mockLogs);

      const result = fetchRunLogs(12345);

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        ['run', 'view', '12345', '--log'],
        { encoding: 'utf8' }
      );
      expect(result).toBe(mockLogs);
    });

    it('should handle Buffer return type', () => {
      const mockLogs = Buffer.from('Run logs output');
      vi.mocked(utils.safeExecSync).mockReturnValue(mockLogs);

      const result = fetchRunLogs(12345);

      expect(result).toBe('Run logs output');
    });

    it('should include --repo flag when owner/repo provided', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('logs');

      fetchRunLogs(12345, 'owner', 'repo');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--repo', 'owner/repo']),
        expect.any(Object)
      );
    });
  });

  describe('fetchRunDetails', () => {
    it('should fetch run details with default fields', () => {
      const mockRun: GitHubRun = {
        databaseId: 12345,
        name: 'Validation',
        status: 'completed',
        conclusion: 'success',
        workflowName: 'Validate',
        createdAt: '2025-12-20T00:00:00Z',
        updatedAt: '2025-12-20T00:05:00Z',
        url: 'https://github.com/owner/repo/actions/runs/12345',
      };

      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify(mockRun));

      const result = fetchRunDetails(12345);

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        [
          'run',
          'view',
          '12345',
          '--json',
          'databaseId,name,status,conclusion,workflowName,createdAt,updatedAt,url',
        ],
        { encoding: 'utf8' }
      );
      expect(result).toEqual(mockRun);
    });

    it('should use custom fields', () => {
      const mockRun = { databaseId: 12345, status: 'completed' };
      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify(mockRun));

      fetchRunDetails(12345, undefined, undefined, ['databaseId', 'status']);

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--json', 'databaseId,status']),
        expect.any(Object)
      );
    });

    it('should include --repo flag when owner/repo provided', () => {
      const mockRun: GitHubRun = {
        databaseId: 12345,
        name: 'Test',
        status: 'completed',
        conclusion: 'success',
        workflowName: 'Test',
        createdAt: '2025-12-20T00:00:00Z',
        updatedAt: '2025-12-20T00:05:00Z',
        url: 'https://github.com/owner/repo/actions/runs/12345',
      };

      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify(mockRun));

      fetchRunDetails(12345, 'owner', 'repo');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--repo', 'owner/repo']),
        expect.any(Object)
      );
    });
  });

  describe('fetchRunJobs', () => {
    it('should fetch jobs for a workflow run', () => {
      const mockJobs: GitHubJob[] = [
        {
          id: 1,
          run_id: 12345,
          name: 'build (ubuntu-latest, 22)',
          status: 'completed',
          conclusion: 'success',
          started_at: '2025-12-20T00:00:00Z',
          completed_at: '2025-12-20T00:05:00Z',
          html_url: 'https://github.com/owner/repo/runs/1',
        },
        {
          id: 2,
          run_id: 12345,
          name: 'build (windows-latest, 22)',
          status: 'completed',
          conclusion: 'failure',
          started_at: '2025-12-20T00:00:00Z',
          completed_at: '2025-12-20T00:06:00Z',
          html_url: 'https://github.com/owner/repo/runs/2',
        },
      ];

      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify({ jobs: mockJobs }));

      const result = fetchRunJobs(12345, 'owner', 'repo');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        ['api', 'repos/owner/repo/actions/runs/12345/jobs'],
        { encoding: 'utf8' }
      );
      expect(result).toEqual(mockJobs);
    });

    it('should return empty array when no jobs', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify({}));

      const result = fetchRunJobs(12345, 'owner', 'repo');

      expect(result).toEqual([]);
    });

    it('should use :owner/:repo placeholder when owner/repo not provided', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify({ jobs: [] }));

      fetchRunJobs(12345);

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        ['api', 'repos/:owner/:repo/actions/runs/12345/jobs'],
        { encoding: 'utf8' }
      );
    });
  });

  describe('listWorkflowRuns', () => {
    it('should list workflow runs with default fields and limit', () => {
      const mockRuns: GitHubRun[] = [
        {
          databaseId: 12345,
          name: 'Run 1',
          status: 'completed',
          conclusion: 'success',
          workflowName: 'Validate',
          createdAt: '2025-12-20T00:00:00Z',
          updatedAt: '2025-12-20T00:05:00Z',
          url: 'https://github.com/owner/repo/actions/runs/12345',
        },
      ];

      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify(mockRuns));

      const result = listWorkflowRuns('feature/test');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        [
          'run',
          'list',
          '--branch',
          'feature/test',
          '--limit',
          '20',
          '--json',
          'databaseId,name,status,conclusion,workflowName,createdAt',
        ],
        { encoding: 'utf8' }
      );
      expect(result).toHaveLength(1);
    });

    it('should respect custom limit', () => {
      testGhCommandWithParam(
        listWorkflowRuns,
        ['main', undefined, undefined, 10],
        '--limit',
        '10'
      );
    });

    it('should use custom fields', () => {
      testGhCommandWithParam(
        listWorkflowRuns,
        ['main', undefined, undefined, 20, ['databaseId', 'status']],
        '--json',
        'databaseId,status'
      );
    });

    it('should include --repo flag when owner/repo provided', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue(JSON.stringify([]));

      listWorkflowRuns('main', 'owner', 'repo');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--repo', 'owner/repo']),
        expect.any(Object)
      );
    });
  });
});
