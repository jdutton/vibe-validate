/**
 * Tests for flakiness detection integration in validate workflow
 */

import './validate-workflow-test-setup.js';

import { runValidation } from '@vibe-validate/core';
import { readHistoryNote } from '@vibe-validate/history';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createMockResult,
  createMockRun,
  createMockNote,
  setupConsoleMocks,
  setupGitMock,
  executeWorkflow,
  MOCK_TREE_HASH,
  TWO_LEVEL_CONFIG,
} from './validate-workflow-test-helpers.js';

/**
 * Setup mocks for workflow execution with optional history (the real cache
 * lookup reads it: a passing run in it is a cache hit)
 */
function setupWorkflowMocks(options: {
  historyNote?: Parameters<typeof createMockNote>[0] | null;
  validationResult?: Parameters<typeof createMockResult>[0];
}) {
  const { historyNote, validationResult } = options;

  setupGitMock();

  vi.mocked(readHistoryNote).mockResolvedValue(historyNote ? createMockNote(historyNote) : null);

  if (validationResult !== undefined) {
    vi.mocked(runValidation).mockResolvedValue(
      typeof validationResult === 'boolean'
        ? createMockResult(validationResult)
        : validationResult
    );
  }
}

/**
 * Assert that flakiness warning was displayed
 */
function expectFlakinessWarning(warnSpy: ReturnType<typeof vi.spyOn>) {
  expect(warnSpy).toHaveBeenCalled();
  const warningCall = warnSpy.mock.calls.find((call: unknown[]) =>
    typeof call[0] === 'string' && call[0].includes('Validation passed, but failed on previous run')
  );
  expect(warningCall).toBeDefined();
  return warningCall;
}

/**
 * Assert that flakiness warning was NOT displayed
 */
function expectNoFlakinessWarning(warnSpy: ReturnType<typeof vi.spyOn>) {
  const warningCall = warnSpy.mock.calls.find((call: unknown[]) =>
    typeof call[0] === 'string' && call[0].includes('Validation passed, but failed on previous run')
  );
  expect(warningCall).toBeUndefined();
}

describe('validate-workflow flakiness integration', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = setupConsoleMocks();
    consoleWarnSpy = mocks.warnSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when validation passes (fresh run)', () => {
    it('should check for flakiness and display warning if detected', async () => {
      const failedRun = createMockRun(false, '2026-02-12T10:00:00Z');

      setupWorkflowMocks({
        validationResult: true,
        historyNote: [failedRun],
      });

      await executeWorkflow();

      // Should load history note
      expect(readHistoryNote).toHaveBeenCalledWith(MOCK_TREE_HASH);

      // Should display flakiness warning
      const warningCall = expectFlakinessWarning(consoleWarnSpy);
      expect(warningCall![0]).toContain('Tests');
      expect(warningCall![0]).toContain('2026-02-12T10:00:00Z');
    });

    it('should not display warning when no flakiness detected', async () => {
      const passedRun = createMockRun(true, '2026-02-12T10:00:00Z');

      setupWorkflowMocks({
        validationResult: true,
        historyNote: [passedRun],
      });

      await executeWorkflow();

      // Should not display flakiness warning
      expectNoFlakinessWarning(consoleWarnSpy);
    });

    it('should handle missing history note gracefully', async () => {
      setupWorkflowMocks({
        validationResult: true,
        historyNote: null,
      });

      await executeWorkflow();

      // Should not throw or display warning
      expectNoFlakinessWarning(consoleWarnSpy);
    });

    it('should handle readHistoryNote errors gracefully', async () => {
      setupWorkflowMocks({
        validationResult: true,
      });
      vi.mocked(readHistoryNote).mockRejectedValue(new Error('Git error'));

      await executeWorkflow();

      // Should not throw or display warning
      expectNoFlakinessWarning(consoleWarnSpy);
    });
  });

  describe('when the recorded failure is at another level', () => {
    it('does not warn: a run at another level ran a different set of steps', async () => {
      setupWorkflowMocks({
        validationResult: true,
        historyNote: [createMockRun(false, '2026-02-12T10:00:00Z', 'commit')],
      });

      await executeWorkflow({ level: 'full' }, TWO_LEVEL_CONFIG);

      expect(runValidation).toHaveBeenCalledTimes(1);
      expectNoFlakinessWarning(consoleWarnSpy);
    });
  });

  describe('when validation passes (cached run)', () => {
    it('does not warn: a cache hit is not a fresh pass, so nothing was observed to flip', async () => {
      const failedRun = createMockRun(false, '2026-02-12T10:00:00Z');
      const passedRun = createMockRun(true, '2026-02-12T10:05:00Z');

      setupWorkflowMocks({
        historyNote: [failedRun, passedRun],
      });

      const result = await executeWorkflow();

      expect(result.isCachedResult).toBe(true);
      expect(runValidation).not.toHaveBeenCalled();
      expectNoFlakinessWarning(consoleWarnSpy);
    });
  });

  describe('when validation fails', () => {
    it('should not check for flakiness', async () => {
      setupWorkflowMocks({
        validationResult: false,
        historyNote: [createMockRun(false, '2026-02-12T10:00:00Z')],
      });

      await executeWorkflow();

      // Should not display flakiness warning
      expectNoFlakinessWarning(consoleWarnSpy);
    });
  });

  describe('in YAML mode', () => {
    it('should not display flakiness warning', async () => {
      const failedRun = createMockRun(false, '2026-02-12T10:00:00Z');

      setupWorkflowMocks({
        validationResult: true,
        historyNote: [failedRun],
      });

      await executeWorkflow({ yaml: true });

      // Should not display flakiness warning (YAML mode)
      expectNoFlakinessWarning(consoleWarnSpy);
    });
  });

  describe('with --retry-failed flag', () => {
    it('should still check for flakiness after retry', async () => {
      const failedRun = createMockRun(false, '2026-02-12T10:00:00Z');

      setupWorkflowMocks({
        validationResult: true,
        historyNote: [failedRun],
      });

      await executeWorkflow({ retryFailed: true });

      // The failed run was handed to the runner as the retry base
      expect(runValidation).toHaveBeenCalledWith(expect.objectContaining({ previousRun: failedRun }));

      // Should display flakiness warning
      expectFlakinessWarning(consoleWarnSpy);
    });
  });
});
