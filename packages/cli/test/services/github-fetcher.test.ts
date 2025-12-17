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

describe('GitHubFetcher', () => {
  let fetcher: GitHubFetcher;

  beforeEach(() => {
    fetcher = new GitHubFetcher();
    vi.clearAllMocks();
  });

  describe('fetchPRDetails', () => {
    it('should fetch complete PR metadata', async () => {
      const mockPRResponse = JSON.stringify({
        number: 123,
        title: 'Add new feature',
        url: 'https://github.com/test/test/pull/123',
        headRefName: 'feature/test',
        baseRefName: 'main',
        author: { login: 'testuser' },
        isDraft: false,
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        labels: [{ name: 'enhancement' }, { name: 'bug' }],
        closingIssuesReferences: {
          nodes: [
            { number: 100, title: 'Issue 1', url: 'https://github.com/test/test/issues/100' },
            { number: 101, title: 'Issue 2', url: 'https://github.com/test/test/issues/101' },
          ],
        },
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockPRResponse));

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

      expect(safeExecSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['pr', 'view', '123', '--json']),
        expect.any(Object)
      );
    });

    it('should handle draft PRs', async () => {
      const mockPRResponse = JSON.stringify({
        number: 456,
        title: 'Draft PR',
        url: 'https://github.com/test/test/pull/456',
        headRefName: 'draft/test',
        baseRefName: 'main',
        author: { login: 'draftuser' },
        isDraft: true,
        mergeable: 'UNKNOWN',
        mergeStateStatus: 'DRAFT',
        labels: [],
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockPRResponse));

      const result = await fetcher.fetchPRDetails(456);

      expect(result.draft).toBe(true);
      expect(result.merge_state_status).toBe('DRAFT');
    });

    it('should handle unmergeable PRs', async () => {
      const mockPRResponse = JSON.stringify({
        number: 789,
        title: 'Conflicting PR',
        url: 'https://github.com/test/test/pull/789',
        headRefName: 'conflict/test',
        baseRefName: 'main',
        author: { login: 'conflictuser' },
        isDraft: false,
        mergeable: 'CONFLICTING',
        mergeStateStatus: 'DIRTY',
        labels: [],
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockPRResponse));

      const result = await fetcher.fetchPRDetails(789);

      expect(result.mergeable).toBe(false);
      expect(result.merge_state_status).toBe('DIRTY');
    });

    it('should handle PRs without linked issues', async () => {
      const mockPRResponse = JSON.stringify({
        number: 999,
        title: 'PR without issues',
        url: 'https://github.com/test/test/pull/999',
        headRefName: 'feature/no-issues',
        baseRefName: 'main',
        author: { login: 'testuser' },
        isDraft: false,
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        labels: [],
        closingIssuesReferences: { nodes: [] },
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockPRResponse));

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
      const mockChecksResponse = JSON.stringify({
        statusCheckRollup: [
          {
            __typename: 'CheckRun',
            name: 'CI / Build',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            detailsUrl: 'https://github.com/test/test/actions/runs/12345',
            startedAt: '2025-12-16T10:00:00Z',
            completedAt: '2025-12-16T10:05:00Z',
          },
          {
            __typename: 'CheckRun',
            name: 'CI / Test',
            status: 'COMPLETED',
            conclusion: 'FAILURE',
            detailsUrl: 'https://github.com/test/test/actions/runs/12346',
            startedAt: '2025-12-16T10:00:00Z',
            completedAt: '2025-12-16T10:10:00Z',
          },
        ],
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockChecksResponse));

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
      const mockChecksResponse = JSON.stringify({
        statusCheckRollup: [
          {
            __typename: 'StatusContext',
            context: 'codecov/patch',
            state: 'SUCCESS',
            targetUrl: 'https://codecov.io/gh/test/test/pull/123',
          },
          {
            __typename: 'StatusContext',
            context: 'SonarCloud Code Analysis',
            state: 'FAILURE',
            targetUrl: 'https://sonarcloud.io/project/issues?id=test',
          },
        ],
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockChecksResponse));

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
      const mockChecksResponse = JSON.stringify({
        statusCheckRollup: [
          {
            __typename: 'CheckRun',
            name: 'CI / Build',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            detailsUrl: 'https://github.com/test/test/actions/runs/12345',
            startedAt: '2025-12-16T10:00:00Z',
            completedAt: '2025-12-16T10:05:00Z',
          },
          {
            __typename: 'StatusContext',
            context: 'codecov/patch',
            state: 'SUCCESS',
            targetUrl: 'https://codecov.io/gh/test/test/pull/123',
          },
        ],
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockChecksResponse));

      const results = await fetcher.fetchChecks(123);

      expect(results).toHaveLength(2);
      expect(results[0].type).toBe('github_action');
      expect(results[1].type).toBe('external');
    });

    it('should handle in-progress checks', async () => {
      const mockChecksResponse = JSON.stringify({
        statusCheckRollup: [
          {
            __typename: 'CheckRun',
            name: 'CI / Build',
            status: 'IN_PROGRESS',
            detailsUrl: 'https://github.com/test/test/actions/runs/12345',
            startedAt: '2025-12-16T10:00:00Z',
          },
        ],
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockChecksResponse));

      const results = await fetcher.fetchChecks(123);

      expect(results[0]).toMatchObject({
        status: 'in_progress',
        conclusion: undefined,
      });
    });

    it('should handle queued checks', async () => {
      const mockChecksResponse = JSON.stringify({
        statusCheckRollup: [
          {
            __typename: 'CheckRun',
            name: 'CI / Build',
            status: 'QUEUED',
            detailsUrl: 'https://github.com/test/test/actions/runs/12345',
          },
        ],
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockChecksResponse));

      const results = await fetcher.fetchChecks(123);

      expect(results[0]).toMatchObject({
        status: 'queued',
      });
    });

    it('should extract run IDs from GitHub Actions URLs', async () => {
      const mockChecksResponse = JSON.stringify({
        statusCheckRollup: [
          {
            __typename: 'CheckRun',
            name: 'CI / Build',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            detailsUrl: 'https://github.com/test/test/actions/runs/987654321',
            startedAt: '2025-12-16T10:00:00Z',
            completedAt: '2025-12-16T10:05:00Z',
          },
        ],
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockChecksResponse));

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

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockLogs));

      const logs = await fetcher.fetchRunLogs(12345);

      expect(logs).toBe(mockLogs);
      expect(safeExecSync).toHaveBeenCalledWith('gh', ['run', 'view', '12345', '--log'], expect.any(Object));
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

      vi.mocked(safeExecSync)
        .mockReturnValueOnce(Buffer.from(mockDiffOutput))
        .mockReturnValueOnce(Buffer.from(mockCommitCount));

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

      vi.mocked(safeExecSync)
        .mockReturnValueOnce(Buffer.from(mockDiffOutput))
        .mockReturnValueOnce(Buffer.from(mockCommitCount));

      const changes = await fetcher.fetchFileChanges(123);

      expect(changes.top_files).toHaveLength(10);
      expect(changes.files_changed).toBe(20);
    });

    it('should detect new files', async () => {
      const mockDiffOutput = `10\t0\tsrc/new-file.ts
0\t0\t-`;

      const mockCommitCount = '1';

      vi.mocked(safeExecSync)
        .mockReturnValueOnce(Buffer.from(mockDiffOutput))
        .mockReturnValueOnce(Buffer.from(mockCommitCount));

      const changes = await fetcher.fetchFileChanges(123);

      expect(changes.top_files?.[0].new_file).toBe(true);
    });

    it('should handle empty diffs', async () => {
      const mockDiffOutput = '';
      const mockCommitCount = '0';

      vi.mocked(safeExecSync)
        .mockReturnValueOnce(Buffer.from(mockDiffOutput))
        .mockReturnValueOnce(Buffer.from(mockCommitCount));

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
      vi.mocked(safeExecSync).mockImplementation(() => {
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
  });

  describe('Cross-repo support', () => {
    it('should create fetcher without repo (defaults to current repo)', () => {
      const defaultFetcher = new GitHubFetcher();
      expect(defaultFetcher).toBeDefined();
      expect(defaultFetcher['repoFlag']).toEqual([]);
    });

    it('should create fetcher with owner/repo', () => {
      const crossRepoFetcher = new GitHubFetcher('jdutton', 'other-repo');
      expect(crossRepoFetcher).toBeDefined();
      expect(crossRepoFetcher['repoFlag']).toEqual(['--repo', 'jdutton/other-repo']);
    });

    it('should pass --repo flag to gh pr view for PR details', async () => {
      const crossRepoFetcher = new GitHubFetcher('test-owner', 'test-repo');
      const mockResponse = JSON.stringify({
        number: 99,
        title: 'Test PR',
        url: 'https://github.com/test-owner/test-repo/pull/99',
        headRefName: 'feature',
        baseRefName: 'main',
        author: { login: 'testuser' },
        isDraft: false,
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        labels: [],
        closingIssuesReferences: { nodes: [] },
      });

      vi.mocked(safeExecSync).mockReturnValue(mockResponse);

      await crossRepoFetcher.fetchPRDetails(99);

      expect(safeExecSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['pr', 'view', '99', '--repo', 'test-owner/test-repo']),
        expect.any(Object)
      );
    });

    it('should pass --repo flag to gh pr view for checks', async () => {
      const crossRepoFetcher = new GitHubFetcher('test-owner', 'test-repo');
      const mockResponse = JSON.stringify({ statusCheckRollup: [] });

      vi.mocked(safeExecSync).mockReturnValue(mockResponse);

      await crossRepoFetcher.fetchChecks(99);

      expect(safeExecSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['pr', 'view', '99', '--repo', 'test-owner/test-repo']),
        expect.any(Object)
      );
    });

    it('should pass --repo flag to gh run view for logs', async () => {
      const crossRepoFetcher = new GitHubFetcher('test-owner', 'test-repo');
      const mockLogs = 'Test log output';

      vi.mocked(safeExecSync).mockReturnValue(mockLogs);

      await crossRepoFetcher.fetchRunLogs(12345);

      expect(safeExecSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['run', 'view', '12345', '--repo', 'test-owner/test-repo']),
        expect.any(Object)
      );
    });

    it('should pass --repo flag to gh run view for run details', async () => {
      const crossRepoFetcher = new GitHubFetcher('test-owner', 'test-repo');
      const mockRunResponse = JSON.stringify({
        name: 'CI / Build',
        status: 'completed',
        conclusion: 'failure',
        workflowName: 'CI',
        createdAt: '2025-12-17T10:00:00Z',
        updatedAt: '2025-12-17T10:05:00Z',
        url: 'https://github.com/test-owner/test-repo/actions/runs/12345',
      });

      vi.mocked(safeExecSync).mockReturnValue(mockRunResponse);

      await crossRepoFetcher.fetchRunDetails(12345);

      expect(safeExecSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['run', 'view', '12345', '--repo', 'test-owner/test-repo', '--json']),
        expect.any(Object)
      );
    });
  });

  describe('fetchRunDetails', () => {
    it('should fetch run metadata with all fields', async () => {
      const mockRunResponse = JSON.stringify({
        name: 'CI / Build',
        status: 'completed',
        conclusion: 'failure',
        workflowName: 'CI',
        createdAt: '2025-12-17T10:00:00Z',
        updatedAt: '2025-12-17T10:05:00Z',
        url: 'https://github.com/test/test/actions/runs/12345',
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockRunResponse));

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

      expect(safeExecSync).toHaveBeenCalledWith(
        'gh',
        ['run', 'view', '12345', '--json', 'name,status,conclusion,workflowName,createdAt,updatedAt,url'],
        expect.any(Object)
      );
    });

    it('should handle in-progress runs (no conclusion yet)', async () => {
      const mockRunResponse = JSON.stringify({
        name: 'Tests / Unit',
        status: 'in_progress',
        conclusion: null,
        workflowName: 'Tests',
        createdAt: '2025-12-17T11:00:00Z',
        updatedAt: '2025-12-17T11:02:00Z',
        url: 'https://github.com/test/test/actions/runs/67890',
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockRunResponse));

      const result = await fetcher.fetchRunDetails(67890);

      expect(result.status).toBe('in_progress');
      expect(result.conclusion).toBeUndefined();
      expect(result.duration).toBeDefined(); // Should calculate from createdAt to now
    });

    it('should handle queued runs', async () => {
      const mockRunResponse = JSON.stringify({
        name: 'Deploy / Production',
        status: 'queued',
        conclusion: null,
        workflowName: 'Deploy',
        createdAt: '2025-12-17T12:00:00Z',
        updatedAt: '2025-12-17T12:00:00Z',
        url: 'https://github.com/test/test/actions/runs/11111',
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockRunResponse));

      const result = await fetcher.fetchRunDetails(11111);

      expect(result.status).toBe('queued');
      expect(result.conclusion).toBeUndefined();
    });

    it('should extract workflow name from run data', async () => {
      const mockRunResponse = JSON.stringify({
        name: 'Long Workflow Name / Job / Step',
        status: 'completed',
        conclusion: 'success',
        workflowName: 'Long Workflow Name',
        createdAt: '2025-12-17T13:00:00Z',
        updatedAt: '2025-12-17T13:10:00Z',
        url: 'https://github.com/test/test/actions/runs/22222',
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockRunResponse));

      const result = await fetcher.fetchRunDetails(22222);

      expect(result.workflow).toBe('Long Workflow Name');
    });

    it('should handle successful runs', async () => {
      const mockRunResponse = JSON.stringify({
        name: 'CI / Test',
        status: 'completed',
        conclusion: 'success',
        workflowName: 'CI',
        createdAt: '2025-12-17T14:00:00Z',
        updatedAt: '2025-12-17T14:03:00Z',
        url: 'https://github.com/test/test/actions/runs/33333',
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockRunResponse));

      const result = await fetcher.fetchRunDetails(33333);

      expect(result.conclusion).toBe('success');
      expect(result.status).toBe('completed');
    });

    it('should handle cancelled runs', async () => {
      const mockRunResponse = JSON.stringify({
        name: 'CI / Build',
        status: 'completed',
        conclusion: 'cancelled',
        workflowName: 'CI',
        createdAt: '2025-12-17T15:00:00Z',
        updatedAt: '2025-12-17T15:01:00Z',
        url: 'https://github.com/test/test/actions/runs/44444',
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockRunResponse));

      const result = await fetcher.fetchRunDetails(44444);

      expect(result.conclusion).toBe('cancelled');
    });

    it('should handle timed out runs', async () => {
      const mockRunResponse = JSON.stringify({
        name: 'CI / Long Test',
        status: 'completed',
        conclusion: 'timed_out',
        workflowName: 'CI',
        createdAt: '2025-12-17T16:00:00Z',
        updatedAt: '2025-12-17T17:00:00Z',
        url: 'https://github.com/test/test/actions/runs/55555',
      });

      vi.mocked(safeExecSync).mockReturnValue(Buffer.from(mockRunResponse));

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
