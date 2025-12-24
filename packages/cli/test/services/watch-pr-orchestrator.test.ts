/**
 * Tests for WatchPROrchestrator
 *
 * TDD Phase 2.1: Simplified unit tests focusing on behavior
 * Integration tests will be done in Phase 3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { WatchPRResultSchema } from '../../src/schemas/watch-pr-result.schema.js';
import { GitHubFetcher } from '../../src/services/github-fetcher.js';
import { HistorySummaryBuilder } from '../../src/services/history-summary-builder.js';
import { WatchPROrchestrator } from '../../src/services/watch-pr-orchestrator.js';

/**
 * Helper: Setup standard PR mock data
 */
function mockPRDetails(prNumber = 123, overrides = {}) {
  return {
    number: prNumber,
    title: 'Test PR',
    url: `https://github.com/test-owner/test-repo/pull/${prNumber}`,
    branch: 'feature/test',
    base_branch: 'main',
    author: 'test-author',
    draft: false,
    mergeable: true,
    merge_state_status: 'CLEAN',
    labels: [],
    ...overrides,
  };
}

/**
 * Helper: Setup standard file changes mock data
 */
function mockFileChanges(overrides = {}) {
  return {
    files_changed: 5,
    insertions: 100,
    deletions: 50,
    commits: 3,
    ...overrides,
  };
}

/**
 * Helper: Create mock GitHub Action check
 */
function mockGitHubActionCheck(overrides: {
  name?: string;
  conclusion?: 'success' | 'failure' | 'neutral';
  run_id?: number;
  workflow?: string;
  started_at?: string;
  duration?: string;
} = {}) {
  return {
    type: 'github_action',
    name: overrides.name ?? 'test',
    status: 'completed',
    conclusion: overrides.conclusion ?? 'success',
    run_id: overrides.run_id ?? 12345,
    workflow: overrides.workflow ?? 'CI',
    started_at: overrides.started_at ?? '2025-01-01T10:00:00Z',
    duration: overrides.duration ?? '2m15s',
    log_command: `gh run view ${overrides.run_id ?? 12345}`,
  };
}

/**
 * Helper: Setup standard history summary mock data
 */
function mockHistorySummary(overrides = {}) {
  return {
    total_runs: 0,
    recent_pattern: 'No previous runs',
    ...overrides,
  };
}

/**
 * Helper: Setup standard run jobs mock data
 */
function mockRunJobs(runId = 12345, overrides: Record<string, unknown>[] = []) {
  const defaultJobs = [
    {
      id: 1,
      run_id: runId,
      name: 'build (ubuntu-latest, 22)',
      status: 'completed',
      conclusion: 'success',
      started_at: '2025-12-20T00:00:00Z',
      completed_at: '2025-12-20T00:05:00Z',
      html_url: `https://github.com/test-owner/test-repo/runs/1`,
    },
  ];

  return overrides.length > 0 ? overrides : defaultJobs;
}

/**
 * Helper: Setup mocks for buildResultForRun tests
 */
function setupRunMocks(
  prNumber: number,
  runId: number,
  runDetails: {
    name: string;
    workflow: string;
    status: string;
    conclusion?: string;
    started_at: string;
    duration: string;
  },
  jobs?: Record<string, unknown>[],
  options: {
    prDetails?: Record<string, unknown>;
    fileChanges?: Record<string, unknown>;
    historySummary?: Record<string, unknown>;
  } = {}
) {
  setupStandardMocks(prNumber, options);

  vi.spyOn(GitHubFetcher.prototype, 'fetchRunDetails').mockResolvedValue({
    run_id: runId,
    ...runDetails,
    url: `https://github.com/test-owner/test-repo/actions/runs/${runId}`,
  } as never);

  vi.spyOn(GitHubFetcher.prototype, 'fetchRunJobs').mockResolvedValue(
    mockRunJobs(runId, jobs) as never
  );
}

/**
 * Helper: Setup mocks for failed integration test scenario
 * (used by multiple tests that test extraction/retry logic)
 */
function setupFailedIntegrationTestMocks(prNumber: number, runId: number) {
  setupRunMocks(prNumber, runId, {
    name: 'Tests / Integration',
    workflow: 'Tests',
    status: 'completed',
    conclusion: 'failure',
    started_at: '2025-12-17T14:00:00Z',
    duration: '8m20s',
  }, [
    {
      id: 1,
      run_id: runId,
      name: 'integration-tests',
      status: 'completed',
      conclusion: 'failure',
      started_at: '2025-12-17T14:00:00Z',
      completed_at: '2025-12-17T14:08:20Z',
      html_url: `https://github.com/test-owner/test-repo/runs/1`,
    },
  ], {
    fileChanges: {
      files_changed: 4,
      insertions: 80,
      deletions: 40,
      commits: 2,
    },
  });
}

/**
 * Helper: Setup all standard mocks for WatchPROrchestrator tests
 */
function setupStandardMocks(prNumber = 123, options: {
  prDetails?: Record<string, unknown>;
  checks?: unknown[];
  fileChanges?: Record<string, unknown>;
  historySummary?: Record<string, unknown>;
} = {}) {
  vi.spyOn(GitHubFetcher.prototype, 'fetchPRDetails').mockResolvedValue(
    mockPRDetails(prNumber, options.prDetails) as never
  );

  vi.spyOn(GitHubFetcher.prototype, 'fetchChecks').mockResolvedValue(
    (options.checks ?? []) as never
  );

  vi.spyOn(GitHubFetcher.prototype, 'fetchFileChanges').mockResolvedValue(
    mockFileChanges(options.fileChanges) as never
  );

  vi.spyOn(HistorySummaryBuilder.prototype, 'buildSummary').mockResolvedValue(
    mockHistorySummary(options.historySummary) as never
  );
}

describe('WatchPROrchestrator', () => {
  let orchestrator: WatchPROrchestrator;
  const mockOwner = 'test-owner';
  const mockRepo = 'test-repo';
  const mockPRNumber = 123;

  beforeEach(() => {
    orchestrator = new WatchPROrchestrator(mockOwner, mockRepo);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildResult', () => {
    it('should build a result with all required fields', async () => {
      setupStandardMocks(mockPRNumber);

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      // Verify result has all required fields
      expect(result.pr).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.checks).toBeDefined();
    });

    it('should validate result against schema', async () => {
      setupStandardMocks(mockPRNumber);

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      // Should validate without throwing
      const validated = WatchPRResultSchema.parse(result);
      expect(validated).toBeDefined();
    });

    it('should classify GitHub Actions checks correctly', async () => {
      setupStandardMocks(mockPRNumber, {
        checks: [mockGitHubActionCheck()],
      });

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      expect(result.checks.github_actions).toHaveLength(1);
      expect(result.checks.github_actions[0].name).toBe('test');
      expect(result.checks.github_actions[0].run_id).toBe(12345);
    });

    it('should classify external checks correctly', async () => {
      setupStandardMocks(mockPRNumber, {
        checks: [
          {
            type: 'external',
            name: 'codecov/patch',
            status: 'completed',
            conclusion: 'success',
            url: 'https://codecov.io/...',
            provider: 'codecov',
          },
        ],
      });

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      expect(result.checks.external_checks).toHaveLength(1);
      expect(result.checks.external_checks[0].name).toBe('codecov/patch');
      expect(result.checks.external_checks[0].url).toBe('https://codecov.io/...');
    });

    it('should order checks with failures first', async () => {
      setupStandardMocks(mockPRNumber, {
        checks: [
          mockGitHubActionCheck({ name: 'test-1' }),
          mockGitHubActionCheck({
            name: 'test-2',
            conclusion: 'failure',
            run_id: 12346,
            started_at: '2025-01-01T10:05:00Z',
            duration: '1m30s'
          }),
        ],
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('test logs');

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      // Failed check should be first
      expect(result.checks.github_actions[0].conclusion).toBe('failure');
      expect(result.checks.github_actions[0].name).toBe('test-2');
    });

    it('should generate guidance for failed checks', async () => {
      setupStandardMocks(mockPRNumber, {
        checks: [mockGitHubActionCheck({ conclusion: 'failure' })],
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('test logs');

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      expect(result.guidance).toBeDefined();
      expect(result.guidance?.status).toBe('failed');
      expect(result.guidance?.severity).toBe('error');
      expect(result.guidance?.next_steps).toBeDefined();
    });

    it('should calculate check counts correctly', async () => {
      setupStandardMocks(mockPRNumber, {
        checks: [
          {
            type: 'github_action',
            name: 'test-1',
            status: 'completed',
            conclusion: 'success',
            run_id: 12345,
            workflow: 'CI',
            started_at: '2025-01-01T10:00:00Z',
            duration: '2m15s',
            log_command: 'gh run view 12345',
          },
          {
            type: 'github_action',
            name: 'test-2',
            status: 'completed',
            conclusion: 'failure',
            run_id: 12346,
            workflow: 'CI',
            started_at: '2025-01-01T10:05:00Z',
            duration: '1m30s',
            log_command: 'gh run view 12346',
          },
          {
            type: 'github_action',
            name: 'test-3',
            status: 'in_progress',
            run_id: 12347,
            workflow: 'CI',
            started_at: '2025-01-01T10:10:00Z',
            duration: '0s',
            log_command: 'gh run view 12347',
          },
        ],
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('test logs');

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      expect(result.checks.total).toBe(3);
      expect(result.checks.passed).toBe(1);
      expect(result.checks.failed).toBe(1);
      expect(result.checks.pending).toBe(1);
    });
  });

  describe('buildResultForRun', () => {
    const mockRunId = 12345;

    it('should build result for a specific run with all required fields', async () => {
      setupRunMocks(mockPRNumber, mockRunId, {
        name: 'CI / Build',
        workflow: 'CI',
        status: 'completed',
        conclusion: 'failure',
        started_at: '2025-12-17T10:00:00Z',
        duration: '5m30s',
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('test logs for run');

      const result = await orchestrator.buildResultForRun(mockPRNumber, mockRunId, { useCache: false });

      // Verify result structure
      expect(result.pr).toBeDefined();
      expect(result.pr.number).toBe(mockPRNumber);
      expect(result.status).toBeDefined();
      expect(result.checks).toBeDefined();
      expect(result.checks.github_actions).toHaveLength(1);
      expect(result.checks.github_actions[0].run_id).toBe(mockRunId);
    });

    it('should validate result against schema', async () => {
      setupRunMocks(mockPRNumber, mockRunId, {
        name: 'Tests / Unit',
        workflow: 'Tests',
        status: 'completed',
        conclusion: 'success',
        started_at: '2025-12-17T11:00:00Z',
        duration: '3m15s',
      }, undefined, {
        fileChanges: {
          files_changed: 2,
          insertions: 50,
          deletions: 25,
          commits: 1,
        },
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('test logs');

      const result = await orchestrator.buildResultForRun(mockPRNumber, mockRunId, { useCache: false });

      // Should validate without throwing
      const validated = WatchPRResultSchema.parse(result);
      expect(validated).toBeDefined();
    });

    it('should handle failed runs correctly', async () => {
      setupRunMocks(mockPRNumber, mockRunId, {
        name: 'Lint / ESLint',
        workflow: 'Lint',
        status: 'completed',
        conclusion: 'failure',
        started_at: '2025-12-17T12:00:00Z',
        duration: '1m45s',
      }, [
        {
          id: 1,
          run_id: mockRunId,
          name: 'lint',
          status: 'completed',
          conclusion: 'failure',
          started_at: '2025-12-17T12:00:00Z',
          completed_at: '2025-12-17T12:01:45Z',
          html_url: `https://github.com/test-owner/test-repo/runs/1`,
        },
      ], {
        fileChanges: {
          files_changed: 3,
          insertions: 75,
          deletions: 30,
          commits: 2,
        },
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('lint error logs');

      const result = await orchestrator.buildResultForRun(mockPRNumber, mockRunId, { useCache: false });

      expect(result.status).toBe('failed');
      expect(result.checks.failed).toBe(1);
      expect(result.checks.passed).toBe(0);
      expect(result.checks.github_actions[0].conclusion).toBe('failure');
    });

    it('should handle in-progress runs', async () => {
      setupRunMocks(mockPRNumber, mockRunId, {
        name: 'Deploy / Production',
        workflow: 'Deploy',
        status: 'in_progress',
        conclusion: undefined,
        started_at: '2025-12-17T13:00:00Z',
        duration: '2m30s',
      }, [
        {
          id: 1,
          run_id: mockRunId,
          name: 'deploy',
          status: 'in_progress',
          conclusion: null,
          started_at: '2025-12-17T13:00:00Z',
          completed_at: null,
          html_url: `https://github.com/test-owner/test-repo/runs/1`,
        },
      ], {
        fileChanges: {
          files_changed: 1,
          insertions: 10,
          deletions: 5,
          commits: 1,
        },
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('deployment in progress...');

      const result = await orchestrator.buildResultForRun(mockPRNumber, mockRunId, { useCache: false });

      expect(result.status).toBe('pending');
      expect(result.checks.pending).toBe(1);
      expect(result.checks.github_actions[0].status).toBe('in_progress');
    });

    it('should attempt extraction for failed runs', async () => {
      // This test verifies that extraction is attempted for failed runs
      // The actual extraction logic is tested in extraction-mode-detector.test.ts
      setupFailedIntegrationTestMocks(mockPRNumber, mockRunId);

      const fetchLogsSpy = vi
        .spyOn(GitHubFetcher.prototype, 'fetchRunLogs')
        .mockResolvedValue('mock test failure logs');

      const result = await orchestrator.buildResultForRun(mockPRNumber, mockRunId, { useCache: false });

      // Verify logs were fetched (extraction was attempted)
      expect(fetchLogsSpy).toHaveBeenCalledWith(mockRunId);

      // Verify result structure is correct
      expect(result.checks.github_actions).toHaveLength(1);
      expect(result.checks.github_actions[0].conclusion).toBe('failure');
    });

    it('should retry log extraction on race condition errors', async () => {
      // Test for Issue #4: Noisy error extraction race condition
      // When GitHub marks check as complete but logs aren't ready yet,
      // we should retry with exponential backoff instead of failing loudly

      // Use fake timers to avoid actual delays
      vi.useFakeTimers();

      setupFailedIntegrationTestMocks(mockPRNumber, mockRunId);

      // Simulate race condition: first 2 calls fail, 3rd succeeds
      let callCount = 0;
      const fetchLogsSpy = vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          const error = new Error(
            'run 12345 is still in progress; logs will be available when it is complete'
          ) as Error & { code: string };
          error.code = 'GH_LOGS_NOT_READY';
          throw error;
        }
        return Promise.resolve('mock test failure logs');
      });

      // Run the operation in the background
      const resultPromise = orchestrator.buildResultForRun(mockPRNumber, mockRunId, { useCache: false });

      // Fast-forward through all timers (2s, 4s delays)
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      // Restore real timers
      vi.useRealTimers();

      // Should have retried 3 times total
      expect(fetchLogsSpy).toHaveBeenCalledTimes(3);

      // Result should still be valid (graceful handling)
      expect(result.checks.github_actions).toHaveLength(1);
      expect(result.checks.github_actions[0].conclusion).toBe('failure');
    });

    it('should gracefully handle extraction failures after retries', async () => {
      // Test that we don't fail the entire operation if extraction never succeeds

      // Use fake timers to avoid actual delays
      vi.useFakeTimers();

      setupFailedIntegrationTestMocks(mockPRNumber, mockRunId);

      // Always fail (simulate persistent GitHub API issue)
      const fetchLogsSpy = vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockRejectedValue(
        new Error('GitHub API error: Rate limit exceeded')
      );

      // Run the operation in the background
      const resultPromise = orchestrator.buildResultForRun(mockPRNumber, mockRunId, { useCache: false });

      // Fast-forward through all timers (2s, 4s delays)
      await vi.runAllTimersAsync();

      // Should NOT throw - operation should succeed without extraction
      const result = await resultPromise;

      // Restore real timers
      vi.useRealTimers();

      // Should have attempted retries (default 3 attempts)
      expect(fetchLogsSpy).toHaveBeenCalledTimes(3);

      // Result should still be valid
      expect(result.checks.github_actions).toHaveLength(1);
      expect(result.checks.github_actions[0].conclusion).toBe('failure');
      // Extraction field should be absent (not undefined, not error object)
      expect(result.checks.github_actions[0].extraction).toBeUndefined();
    });

    it('should still fetch PR details and file changes', async () => {
      setupRunMocks(mockPRNumber, mockRunId, {
        name: 'CI / Build',
        workflow: 'CI',
        status: 'completed',
        conclusion: 'success',
        started_at: '2025-12-17T15:00:00Z',
        duration: '4m10s',
      });

      const fetchPRSpy = vi.spyOn(GitHubFetcher.prototype, 'fetchPRDetails');
      const fetchFileChangesSpy = vi.spyOn(GitHubFetcher.prototype, 'fetchFileChanges');

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('build logs');

      await orchestrator.buildResultForRun(mockPRNumber, mockRunId, { useCache: false });

      // Verify PR context is still fetched
      expect(fetchPRSpy).toHaveBeenCalledWith(mockPRNumber);
      expect(fetchFileChangesSpy).toHaveBeenCalledWith(mockPRNumber);
    });
  });

  describe('output format selection', () => {
    it('should output YAML on failure', () => {
      const shouldYAML = orchestrator.shouldOutputYAML('failed', false);
      expect(shouldYAML).toBe(true);
    });

    it('should output text on success', () => {
      const shouldYAML = orchestrator.shouldOutputYAML('passed', false);
      expect(shouldYAML).toBe(false);
    });

    it('should respect --yaml flag', () => {
      const shouldYAML = orchestrator.shouldOutputYAML('passed', true);
      expect(shouldYAML).toBe(true);
    });
  });
});
