/**
 * Tests for flakiness detection integration in validate workflow
 */

import './validate-workflow-test-setup.js';

import { runValidation } from '@vibe-validate/core';
import { findCachedValidation, readHistoryNote } from '@vibe-validate/history';
import type { ValidationRun } from '@vibe-validate/history';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createMockResult,
  createMockRun,
  createMockNote,
  setupConsoleMocks,
  setupGitMock,
  executeWorkflow,
  MOCK_TREE_HASH,
} from './validate-workflow-test-helpers.js';

/**
 * Setup mocks for workflow execution with optional cached run and history
 */
function setupWorkflowMocks(options: {
  cachedRun?: ValidationRun | null;
  historyNote?: Parameters<typeof createMockNote>[0] | null;
  validationResult?: Parameters<typeof createMockResult>[0];
}) {
  const { cachedRun, historyNote, validationResult } = options;

  setupGitMock();
  vi.mocked(findCachedValidation).mockResolvedValue(cachedRun ?? null);

  if (historyNote !== undefined) {
    vi.mocked(readHistoryNote).mockResolvedValue(historyNote === null ? null : createMockNote(historyNote));
  }

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

  describe('when validation passes (cached run)', () => {
    it('should check for flakiness and display warning if detected', async () => {
      const failedRun = createMockRun(false, '2026-02-12T10:00:00Z');
      const passedRun = createMockRun(true, '2026-02-12T10:05:00Z');

      setupWorkflowMocks({
        cachedRun: passedRun,
        historyNote: [failedRun, passedRun],
      });

      await executeWorkflow();

      // Should load history note
      expect(readHistoryNote).toHaveBeenCalledWith(MOCK_TREE_HASH);

      // Should display flakiness warning
      expectFlakinessWarning(consoleWarnSpy);
    });
  });

  describe('when validation fails', () => {
    it('should not check for flakiness', async () => {
      setupWorkflowMocks({
        validationResult: false,
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

      // Simulate retry logic: second call to findCachedValidation returns failed run
      vi.mocked(findCachedValidation)
        .mockResolvedValueOnce(null) // Cache check
        .mockResolvedValueOnce(failedRun); // Retry check

      await executeWorkflow({ retryFailed: true });

      // Should display flakiness warning
      expectFlakinessWarning(consoleWarnSpy);
    });
  });
});
