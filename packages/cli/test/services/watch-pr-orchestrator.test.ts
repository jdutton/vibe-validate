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
        checks: [
          {
            type: 'github_action',
            name: 'test',
            status: 'completed',
            conclusion: 'success',
            run_id: 12345,
            workflow: 'CI',
            started_at: '2025-01-01T10:00:00Z',
            duration: '2m15s',
            log_command: 'gh run view 12345',
          },
        ],
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
        checks: [
          {
            type: 'github_action',
            name: 'test',
            status: 'completed',
            conclusion: 'failure',
            run_id: 12345,
            workflow: 'CI',
            started_at: '2025-01-01T10:00:00Z',
            duration: '2m15s',
            log_command: 'gh run view 12345',
          },
        ],
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
      setupStandardMocks(mockPRNumber);

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunDetails').mockResolvedValue({
        run_id: mockRunId,
        name: 'CI / Build',
        workflow: 'CI',
        status: 'completed',
        conclusion: 'failure',
        started_at: '2025-12-17T10:00:00Z',
        duration: '5m30s',
        url: 'https://github.com/test-owner/test-repo/actions/runs/12345',
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
      setupStandardMocks(mockPRNumber, {
        fileChanges: {
          files_changed: 2,
          insertions: 50,
          deletions: 25,
          commits: 1,
        },
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunDetails').mockResolvedValue({
        run_id: mockRunId,
        name: 'Tests / Unit',
        workflow: 'Tests',
        status: 'completed',
        conclusion: 'success',
        started_at: '2025-12-17T11:00:00Z',
        duration: '3m15s',
        url: 'https://github.com/test-owner/test-repo/actions/runs/12345',
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('test logs');

      const result = await orchestrator.buildResultForRun(mockPRNumber, mockRunId, { useCache: false });

      // Should validate without throwing
      const validated = WatchPRResultSchema.parse(result);
      expect(validated).toBeDefined();
    });

    it('should handle failed runs correctly', async () => {
      setupStandardMocks(mockPRNumber, {
        fileChanges: {
          files_changed: 3,
          insertions: 75,
          deletions: 30,
          commits: 2,
        },
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunDetails').mockResolvedValue({
        run_id: mockRunId,
        name: 'Lint / ESLint',
        workflow: 'Lint',
        status: 'completed',
        conclusion: 'failure',
        started_at: '2025-12-17T12:00:00Z',
        duration: '1m45s',
        url: 'https://github.com/test-owner/test-repo/actions/runs/12345',
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('lint error logs');

      const result = await orchestrator.buildResultForRun(mockPRNumber, mockRunId, { useCache: false });

      expect(result.status).toBe('failed');
      expect(result.checks.failed).toBe(1);
      expect(result.checks.passed).toBe(0);
      expect(result.checks.github_actions[0].conclusion).toBe('failure');
    });

    it('should handle in-progress runs', async () => {
      setupStandardMocks(mockPRNumber, {
        fileChanges: {
          files_changed: 1,
          insertions: 10,
          deletions: 5,
          commits: 1,
        },
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunDetails').mockResolvedValue({
        run_id: mockRunId,
        name: 'Deploy / Production',
        workflow: 'Deploy',
        status: 'in_progress',
        conclusion: undefined,
        started_at: '2025-12-17T13:00:00Z',
        duration: '2m30s',
        url: 'https://github.com/test-owner/test-repo/actions/runs/12345',
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
      setupStandardMocks(mockPRNumber, {
        fileChanges: {
          files_changed: 4,
          insertions: 80,
          deletions: 40,
          commits: 2,
        },
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunDetails').mockResolvedValue({
        run_id: mockRunId,
        name: 'Tests / Integration',
        workflow: 'Tests',
        status: 'completed',
        conclusion: 'failure',
        started_at: '2025-12-17T14:00:00Z',
        duration: '8m20s',
        url: 'https://github.com/test-owner/test-repo/actions/runs/12345',
      });

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

    it('should still fetch PR details and file changes', async () => {
      const fetchPRSpy = vi.spyOn(GitHubFetcher.prototype, 'fetchPRDetails').mockResolvedValue(
        mockPRDetails(mockPRNumber) as never
      );

      const fetchFileChangesSpy = vi.spyOn(GitHubFetcher.prototype, 'fetchFileChanges').mockResolvedValue(
        mockFileChanges() as never
      );

      vi.spyOn(HistorySummaryBuilder.prototype, 'buildSummary').mockResolvedValue(
        mockHistorySummary() as never
      );

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunDetails').mockResolvedValue({
        run_id: mockRunId,
        name: 'CI / Build',
        workflow: 'CI',
        status: 'completed',
        conclusion: 'success',
        started_at: '2025-12-17T15:00:00Z',
        duration: '4m10s',
        url: 'https://github.com/test-owner/test-repo/actions/runs/12345',
      });

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
