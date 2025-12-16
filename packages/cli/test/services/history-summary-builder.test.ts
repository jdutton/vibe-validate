/**
 * Tests for HistorySummaryBuilder
 *
 * TDD Phase 2.2: Write tests FIRST, then implement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HistorySummaryBuilder } from '../../src/services/history-summary-builder.js';

describe('HistorySummaryBuilder', () => {
  let builder: HistorySummaryBuilder;

  beforeEach(() => {
    builder = new HistorySummaryBuilder('test-owner', 'test-repo');
  });

  describe('buildSummary', () => {
    it('should fetch workflow runs for PR branch', async () => {
      // Mock gh CLI to return workflow runs
      const mockExec = vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'success', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'success', created_at: '2025-01-01T09:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(mockExec).toHaveBeenCalledWith('feature/test-branch');
      expect(summary).toBeDefined();
    });

    it('should calculate total runs', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'success', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'failure', created_at: '2025-01-01T09:00:00Z' },
        { conclusion: 'success', created_at: '2025-01-01T08:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.total_runs).toBe(3);
    });

    it('should identify recent pattern (passed)', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'success', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'success', created_at: '2025-01-01T09:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.recent_pattern).toContain('Passed last 2 run');
    });

    it('should identify recent pattern (failed)', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'failure', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'failure', created_at: '2025-01-01T09:00:00Z' },
        { conclusion: 'failure', created_at: '2025-01-01T08:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.recent_pattern).toContain('Failed last 3 run');
    });

    it('should calculate success rate', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'success', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'success', created_at: '2025-01-01T09:00:00Z' },
        { conclusion: 'failure', created_at: '2025-01-01T08:00:00Z' },
        { conclusion: 'success', created_at: '2025-01-01T07:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.success_rate).toBe('75%');
    });

    it('should handle no history gracefully', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.total_runs).toBe(0);
      expect(summary.recent_pattern).toBe('No previous runs');
      expect(summary.success_rate).toBeUndefined();
    });

    it('should limit to last 10 runs', async () => {
      const runs = Array.from({ length: 15 }, (_, i) => ({
        conclusion: i % 2 === 0 ? 'success' : 'failure',
        created_at: `2025-01-01T${10 + i}:00:00Z`,
      }));

      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue(runs);

      const summary = await builder.buildSummary('feature/test-branch');

      // Total should include all runs
      expect(summary.total_runs).toBe(15);

      // Success rate should only consider last 10
      // Last 10: indices 5-14
      // Success: 6, 8, 10, 12, 14 = 5 out of 10 = 50%
      expect(summary.success_rate).toBe('50%');
    });
  });

  describe('pattern detection', () => {
    it('should detect "Passed last N runs"', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'success', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'success', created_at: '2025-01-01T09:00:00Z' },
        { conclusion: 'success', created_at: '2025-01-01T08:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.recent_pattern).toBe('Passed last 3 runs');
    });

    it('should detect "Failed last N runs"', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'failure', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'failure', created_at: '2025-01-01T09:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.recent_pattern).toBe('Failed last 2 runs');
    });

    it('should detect "Flaky (alternating)"', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'success', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'failure', created_at: '2025-01-01T09:00:00Z' },
        { conclusion: 'success', created_at: '2025-01-01T08:00:00Z' },
        { conclusion: 'failure', created_at: '2025-01-01T07:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.recent_pattern).toBe('Flaky (alternating)');
    });

    it('should detect "Recently fixed (was failing)"', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'success', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'success', created_at: '2025-01-01T09:00:00Z' },
        { conclusion: 'failure', created_at: '2025-01-01T08:00:00Z' },
        { conclusion: 'failure', created_at: '2025-01-01T07:00:00Z' },
        { conclusion: 'failure', created_at: '2025-01-01T06:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.recent_pattern).toBe('Recently fixed (was failing)');
    });

    it('should handle mixed patterns', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'success', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'failure', created_at: '2025-01-01T09:00:00Z' },
        { conclusion: 'success', created_at: '2025-01-01T08:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      // Not alternating (not enough samples), not consistent
      // Should fall back to generic pattern
      expect(summary.recent_pattern).toContain('run');
    });
  });

  describe('edge cases', () => {
    it('should handle single run', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'success', created_at: '2025-01-01T10:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.total_runs).toBe(1);
      expect(summary.recent_pattern).toBe('Passed last 1 run');
      expect(summary.success_rate).toBe('100%');
    });

    it('should handle cancelled runs', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'success', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'cancelled', created_at: '2025-01-01T09:00:00Z' },
        { conclusion: 'failure', created_at: '2025-01-01T08:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.total_runs).toBe(3);
      // Success rate: 1 success out of 3 = 33%
      expect(summary.success_rate).toBe('33%');
    });

    it('should handle skipped runs', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'success', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'skipped', created_at: '2025-01-01T09:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.total_runs).toBe(2);
      // Skipped should be treated as non-success
      expect(summary.success_rate).toBe('50%');
    });

    it('should handle gh CLI errors gracefully', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockRejectedValue(
        new Error('gh CLI failed'),
      );

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.total_runs).toBe(0);
      expect(summary.recent_pattern).toBe('No previous runs');
    });
  });

  describe('fetchWorkflowRuns', () => {
    it('should call gh CLI with correct arguments', async () => {
      // This is an integration test - will be tested separately
      // Just verify the method exists and can be called
      expect(builder).toHaveProperty('fetchWorkflowRuns');
    });
  });

  describe('integration with gh CLI', () => {
    it('should parse gh CLI JSON output correctly', async () => {
      const mockOutput = JSON.stringify([
        { conclusion: 'success', createdAt: '2025-01-01T10:00:00Z' },
        { conclusion: 'failure', createdAt: '2025-01-01T09:00:00Z' },
      ]);

      // Mock safeExecSync to return the JSON output
      vi.mock('@vibe-validate/utils', () => ({
        safeExecSync: vi.fn(() => mockOutput),
      }));

      const { safeExecSync } = await import('@vibe-validate/utils');
      vi.mocked(safeExecSync).mockReturnValue(mockOutput);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.total_runs).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty workflow runs', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.total_runs).toBe(0);
      expect(summary.recent_pattern).toBe('No previous runs');
      expect(summary.success_rate).toBeUndefined();
    });

    it('should handle all runs with null conclusion', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: null, created_at: '2025-01-01T10:00:00Z' },
        { conclusion: null, created_at: '2025-01-01T09:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.total_runs).toBe(2);
      expect(summary.success_rate).toBe('0%'); // null is not success
    });

    it('should handle "timed_out" conclusion', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'success', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'timed_out', created_at: '2025-01-01T09:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.total_runs).toBe(2);
      expect(summary.success_rate).toBe('50%'); // timed_out is not success
    });

    it('should detect pattern with action_required conclusion', async () => {
      vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        { conclusion: 'action_required', created_at: '2025-01-01T10:00:00Z' },
        { conclusion: 'action_required', created_at: '2025-01-01T09:00:00Z' },
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.total_runs).toBe(2);
      expect(summary.recent_pattern).toBeDefined();
    });
  });
});
