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
      // Mock GitHubFetcher methods
      vi.spyOn(GitHubFetcher.prototype, 'fetchPRDetails').mockResolvedValue({
        number: mockPRNumber,
        title: 'Test PR',
        url: 'https://github.com/test-owner/test-repo/pull/123',
        branch: 'feature/test',
        base_branch: 'main',
        author: 'test-author',
        draft: false,
        mergeable: true,
        merge_state_status: 'CLEAN',
        labels: [],
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchChecks').mockResolvedValue([]);

      vi.spyOn(GitHubFetcher.prototype, 'fetchFileChanges').mockResolvedValue({
        files_changed: 5,
        insertions: 100,
        deletions: 50,
        commits: 3,
      });

      vi.spyOn(HistorySummaryBuilder.prototype, 'buildSummary').mockResolvedValue({
        total_runs: 0,
        recent_pattern: 'No previous runs',
      });

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      // Verify result has all required fields
      expect(result.pr).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.checks).toBeDefined();
    });

    it('should validate result against schema', async () => {
      vi.spyOn(GitHubFetcher.prototype, 'fetchPRDetails').mockResolvedValue({
        number: mockPRNumber,
        title: 'Test PR',
        url: 'https://github.com/test-owner/test-repo/pull/123',
        branch: 'feature/test',
        base_branch: 'main',
        author: 'test-author',
        draft: false,
        mergeable: true,
        merge_state_status: 'CLEAN',
        labels: [],
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchChecks').mockResolvedValue([]);

      vi.spyOn(GitHubFetcher.prototype, 'fetchFileChanges').mockResolvedValue({
        files_changed: 5,
        insertions: 100,
        deletions: 50,
        commits: 3,
      });

      vi.spyOn(HistorySummaryBuilder.prototype, 'buildSummary').mockResolvedValue({
        total_runs: 0,
        recent_pattern: 'No previous runs',
      });

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      // Should validate without throwing
      const validated = WatchPRResultSchema.parse(result);
      expect(validated).toBeDefined();
    });

    it('should classify GitHub Actions checks correctly', async () => {
      vi.spyOn(GitHubFetcher.prototype, 'fetchPRDetails').mockResolvedValue({
        number: mockPRNumber,
        title: 'Test PR',
        url: 'https://github.com/test-owner/test-repo/pull/123',
        branch: 'feature/test',
        base_branch: 'main',
        author: 'test-author',
        draft: false,
        mergeable: true,
        merge_state_status: 'CLEAN',
        labels: [],
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchChecks').mockResolvedValue([
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
      ]);

      vi.spyOn(GitHubFetcher.prototype, 'fetchFileChanges').mockResolvedValue({
        files_changed: 5,
        insertions: 100,
        deletions: 50,
        commits: 3,
      });

      vi.spyOn(HistorySummaryBuilder.prototype, 'buildSummary').mockResolvedValue({
        total_runs: 0,
        recent_pattern: 'No previous runs',
      });

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      expect(result.checks.github_actions).toHaveLength(1);
      expect(result.checks.github_actions[0].name).toBe('test');
      expect(result.checks.github_actions[0].run_id).toBe(12345);
    });

    it('should classify external checks correctly', async () => {
      vi.spyOn(GitHubFetcher.prototype, 'fetchPRDetails').mockResolvedValue({
        number: mockPRNumber,
        title: 'Test PR',
        url: 'https://github.com/test-owner/test-repo/pull/123',
        branch: 'feature/test',
        base_branch: 'main',
        author: 'test-author',
        draft: false,
        mergeable: true,
        merge_state_status: 'CLEAN',
        labels: [],
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchChecks').mockResolvedValue([
        {
          type: 'external',
          name: 'codecov/patch',
          status: 'completed',
          conclusion: 'success',
          url: 'https://codecov.io/...',
          provider: 'codecov',
        },
      ]);

      vi.spyOn(GitHubFetcher.prototype, 'fetchFileChanges').mockResolvedValue({
        files_changed: 5,
        insertions: 100,
        deletions: 50,
        commits: 3,
      });

      vi.spyOn(HistorySummaryBuilder.prototype, 'buildSummary').mockResolvedValue({
        total_runs: 0,
        recent_pattern: 'No previous runs',
      });

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      expect(result.checks.external_checks).toHaveLength(1);
      expect(result.checks.external_checks[0].name).toBe('codecov/patch');
      expect(result.checks.external_checks[0].url).toBe('https://codecov.io/...');
    });

    it('should order checks with failures first', async () => {
      vi.spyOn(GitHubFetcher.prototype, 'fetchPRDetails').mockResolvedValue({
        number: mockPRNumber,
        title: 'Test PR',
        url: 'https://github.com/test-owner/test-repo/pull/123',
        branch: 'feature/test',
        base_branch: 'main',
        author: 'test-author',
        draft: false,
        mergeable: true,
        merge_state_status: 'CLEAN',
        labels: [],
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchChecks').mockResolvedValue([
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
      ]);

      vi.spyOn(GitHubFetcher.prototype, 'fetchFileChanges').mockResolvedValue({
        files_changed: 5,
        insertions: 100,
        deletions: 50,
        commits: 3,
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('test logs');

      vi.spyOn(HistorySummaryBuilder.prototype, 'buildSummary').mockResolvedValue({
        total_runs: 0,
        recent_pattern: 'No previous runs',
      });

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      // Failed check should be first
      expect(result.checks.github_actions[0].conclusion).toBe('failure');
      expect(result.checks.github_actions[0].name).toBe('test-2');
    });

    it('should generate guidance for failed checks', async () => {
      vi.spyOn(GitHubFetcher.prototype, 'fetchPRDetails').mockResolvedValue({
        number: mockPRNumber,
        title: 'Test PR',
        url: 'https://github.com/test-owner/test-repo/pull/123',
        branch: 'feature/test',
        base_branch: 'main',
        author: 'test-author',
        draft: false,
        mergeable: true,
        merge_state_status: 'CLEAN',
        labels: [],
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchChecks').mockResolvedValue([
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
      ]);

      vi.spyOn(GitHubFetcher.prototype, 'fetchFileChanges').mockResolvedValue({
        files_changed: 5,
        insertions: 100,
        deletions: 50,
        commits: 3,
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('test logs');

      vi.spyOn(HistorySummaryBuilder.prototype, 'buildSummary').mockResolvedValue({
        total_runs: 0,
        recent_pattern: 'No previous runs',
      });

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      expect(result.guidance).toBeDefined();
      expect(result.guidance?.status).toBe('failed');
      expect(result.guidance?.severity).toBe('error');
      expect(result.guidance?.next_steps).toBeDefined();
    });

    it('should calculate check counts correctly', async () => {
      vi.spyOn(GitHubFetcher.prototype, 'fetchPRDetails').mockResolvedValue({
        number: mockPRNumber,
        title: 'Test PR',
        url: 'https://github.com/test-owner/test-repo/pull/123',
        branch: 'feature/test',
        base_branch: 'main',
        author: 'test-author',
        draft: false,
        mergeable: true,
        merge_state_status: 'CLEAN',
        labels: [],
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchChecks').mockResolvedValue([
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
      ]);

      vi.spyOn(GitHubFetcher.prototype, 'fetchFileChanges').mockResolvedValue({
        files_changed: 5,
        insertions: 100,
        deletions: 50,
        commits: 3,
      });

      vi.spyOn(GitHubFetcher.prototype, 'fetchRunLogs').mockResolvedValue('test logs');

      vi.spyOn(HistorySummaryBuilder.prototype, 'buildSummary').mockResolvedValue({
        total_runs: 0,
        recent_pattern: 'No previous runs',
      });

      const result = await orchestrator.buildResult(mockPRNumber, { useCache: false });

      expect(result.checks.total).toBe(3);
      expect(result.checks.passed).toBe(1);
      expect(result.checks.failed).toBe(1);
      expect(result.checks.pending).toBe(1);
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
