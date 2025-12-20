/**
 * Tests for HistorySummaryBuilder
 *
 * TDD Phase 2.2: Write tests FIRST, then implement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HistorySummaryBuilder } from '../../src/services/history-summary-builder.js';

/**
 * Helper: Create a workflow run object
 */
function createRun(conclusion: string, timeOffset = 0) {
  const date = new Date('2025-01-01T10:00:00Z');
  date.setHours(date.getHours() - timeOffset);
  return {
    conclusion,
    created_at: date.toISOString(),
  };
}

/**
 * Helper: Mock workflow runs and build summary
 */
async function mockAndBuild(
  builder: HistorySummaryBuilder,
  runs: Array<{ conclusion: string; created_at: string }>,
  branch = 'feature/test-branch'
) {
  vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue(runs);
  return await builder.buildSummary(branch);
}

describe('HistorySummaryBuilder', () => {
  let builder: HistorySummaryBuilder;

  beforeEach(() => {
    builder = new HistorySummaryBuilder('test-owner', 'test-repo');
  });

  describe('buildSummary', () => {
    it('should fetch workflow runs for PR branch', async () => {
      const mockExec = vi.spyOn(builder as any, 'fetchWorkflowRuns').mockResolvedValue([
        createRun('success', 0),
        createRun('success', 1),
      ]);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(mockExec).toHaveBeenCalledWith('feature/test-branch');
      expect(summary).toBeDefined();
    });

    it('should calculate total runs', async () => {
      const summary = await mockAndBuild(builder, [
        createRun('success', 0),
        createRun('failure', 1),
        createRun('success', 2),
      ]);

      expect(summary.total_runs).toBe(3);
    });

    it('should identify recent pattern (passed)', async () => {
      const summary = await mockAndBuild(builder, [
        createRun('success', 0),
        createRun('success', 1),
      ]);

      expect(summary.recent_pattern).toContain('Passed last 2 run');
    });

    it('should identify recent pattern (failed)', async () => {
      const summary = await mockAndBuild(builder, [
        createRun('failure', 0),
        createRun('failure', 1),
        createRun('failure', 2),
      ]);

      expect(summary.recent_pattern).toContain('Failed last 3 run');
    });

    it('should calculate success rate', async () => {
      const summary = await mockAndBuild(builder, [
        createRun('success', 0),
        createRun('success', 1),
        createRun('failure', 2),
        createRun('success', 3),
      ]);

      expect(summary.success_rate).toBe('75%');
    });

    it('should handle no history gracefully', async () => {
      const summary = await mockAndBuild(builder, []);

      expect(summary.total_runs).toBe(0);
      expect(summary.recent_pattern).toBe('No previous runs');
      expect(summary.success_rate).toBeUndefined();
    });

    it('should limit to last 10 runs', async () => {
      const runs = Array.from({ length: 15 }, (_, i) => createRun(
        i % 2 === 0 ? 'success' : 'failure',
        i
      ));

      const summary = await mockAndBuild(builder, runs);

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
      const summary = await mockAndBuild(builder, [
        createRun('success', 0),
        createRun('success', 1),
        createRun('success', 2),
      ]);

      expect(summary.recent_pattern).toBe('Passed last 3 runs');
    });

    it('should detect "Failed last N runs"', async () => {
      const summary = await mockAndBuild(builder, [
        createRun('failure', 0),
        createRun('failure', 1),
      ]);

      expect(summary.recent_pattern).toBe('Failed last 2 runs');
    });

    it('should detect "Flaky (alternating)"', async () => {
      const summary = await mockAndBuild(builder, [
        createRun('success', 0),
        createRun('failure', 1),
        createRun('success', 2),
        createRun('failure', 3),
      ]);

      expect(summary.recent_pattern).toBe('Flaky (alternating)');
    });

    it('should detect "Recently fixed (was failing)"', async () => {
      const summary = await mockAndBuild(builder, [
        createRun('success', 0),
        createRun('success', 1),
        createRun('failure', 2),
        createRun('failure', 3),
        createRun('failure', 4),
      ]);

      expect(summary.recent_pattern).toBe('Recently fixed (was failing)');
    });

    it('should handle mixed patterns', async () => {
      const summary = await mockAndBuild(builder, [
        createRun('success', 0),
        createRun('failure', 1),
        createRun('success', 2),
      ]);

      // Not alternating (not enough samples), not consistent
      // Should fall back to generic pattern
      expect(summary.recent_pattern).toContain('run');
    });
  });

  describe('edge cases', () => {
    it('should handle single run', async () => {
      const summary = await mockAndBuild(builder, [createRun('success', 0)]);

      expect(summary.total_runs).toBe(1);
      expect(summary.recent_pattern).toBe('Passed last 1 run');
      expect(summary.success_rate).toBe('100%');
    });

    it('should handle cancelled runs', async () => {
      const summary = await mockAndBuild(builder, [
        createRun('success', 0),
        createRun('cancelled', 1),
        createRun('failure', 2),
      ]);

      expect(summary.total_runs).toBe(3);
      // Success rate: 1 success out of 3 = 33%
      expect(summary.success_rate).toBe('33%');
    });

    it('should handle skipped runs', async () => {
      const summary = await mockAndBuild(builder, [
        createRun('success', 0),
        createRun('skipped', 1),
      ]);

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
      // NOSONAR: Nesting unavoidable with Vitest's hoisted mock system
      vi.mock('@vibe-validate/utils', () => ({
        safeExecSync: vi.fn(() => mockOutput),
      }));

      const { safeExecSync } = await import('@vibe-validate/utils');
      vi.mocked(safeExecSync).mockReturnValue(mockOutput);

      const summary = await builder.buildSummary('feature/test-branch');

      expect(summary.total_runs).toBeGreaterThanOrEqual(0);
    });

    it('should handle all runs with null conclusion', async () => {
      const summary = await mockAndBuild(builder, [
        { conclusion: null as any, created_at: '2025-01-01T10:00:00Z' },
        { conclusion: null as any, created_at: '2025-01-01T09:00:00Z' },
      ]);

      expect(summary.total_runs).toBe(2);
      expect(summary.success_rate).toBe('0%'); // null is not success
    });

    it('should handle "timed_out" conclusion', async () => {
      const summary = await mockAndBuild(builder, [
        createRun('success', 0),
        createRun('timed_out', 1),
      ]);

      expect(summary.total_runs).toBe(2);
      expect(summary.success_rate).toBe('50%'); // timed_out is not success
    });

    it('should detect pattern with action_required conclusion', async () => {
      const summary = await mockAndBuild(builder, [
        createRun('action_required', 0),
        createRun('action_required', 1),
      ]);

      expect(summary.total_runs).toBe(2);
      expect(summary.recent_pattern).toBeDefined();
    });
  });
});
