/**
 * Tests for --retry-failed flag in validate workflow
 *
 * The history note is served through readHistoryNote; the cache and retry
 * lookups are the real pure functions.
 */

import './validate-workflow-test-setup.js';

import { readHistoryNote } from '@vibe-validate/history';
import type { ValidationRun } from '@vibe-validate/history';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { ValidateWorkflowOptions } from '../../src/utils/validate-workflow.js';


import {
  createMockRun,
  setupConsoleMocks,
  setupGitMock,
  setupHistoryNote,
  executeWorkflow,
  MOCK_TREE_HASH,
  MOCK_TREE_HASH_RESULT,
} from './validate-workflow-test-helpers.js';

// Test Helpers

async function getRunValidationMock() {
  const { runValidation } = await import('@vibe-validate/core');
  return vi.mocked(runValidation);
}

async function expectValidationRun(
  options: Partial<ValidateWorkflowOptions>,
  expectedPreviousRun?: ValidationRun
) {
  const runValidation = await getRunValidationMock();

  runValidation.mockResolvedValue({
    passed: true,
    timestamp: new Date().toISOString(),
    level: 'full',
    summary: 'All steps passed',
    phases: [],
  });

  await executeWorkflow(options);

  expect(runValidation).toHaveBeenCalledTimes(1);
  expect(runValidation).toHaveBeenCalledWith(
    expect.objectContaining({
      previousRun: expectedPreviousRun,
    })
  );
}

async function expectCacheUsed(options: Partial<ValidateWorkflowOptions>) {
  const runValidation = await getRunValidationMock();

  const result = await executeWorkflow(options);

  expect(runValidation).not.toHaveBeenCalled();
  expect(result.passed).toBe(true);
  expect(result.isCachedResult).toBe(true);
}

describe('validate-workflow retry-failed', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setupGitMock();
    ({ errorSpy: consoleErrorSpy } = setupConsoleMocks());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('retryFailed=false (normal validation)', () => {
    it('should not use retry logic when retryFailed=false', async () => {
      // A failed run exists, but without --retry-failed it is never handed to the runner
      setupHistoryNote([createMockRun(false)]);

      await expectValidationRun({
        retryFailed: false,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      });

      expect(readHistoryNote).toHaveBeenCalledTimes(1);
      expect(readHistoryNote).toHaveBeenCalledWith(MOCK_TREE_HASH);
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('No failed validation at level'));
    });

    it('hands the runner the tree hash it already computed, so the worktree is hashed once', async () => {
      setupHistoryNote(null);

      await expectValidationRun({ retryFailed: false, treeHashResult: MOCK_TREE_HASH_RESULT });

      const runValidation = await getRunValidationMock();
      expect(runValidation).toHaveBeenCalledWith(expect.objectContaining({ treeHash: MOCK_TREE_HASH }));
    });
  });

  describe('retryFailed=true with no previous validation', () => {
    it('should show message and run full validation', async () => {
      setupHistoryNote(null);

      await expectValidationRun({
        retryFailed: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      });

      expect(readHistoryNote).toHaveBeenCalledWith(MOCK_TREE_HASH);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`No failed validation at level full to retry for tree ${MOCK_TREE_HASH}`)
      );
    });

    it('does not retry a failed run recorded at another level', async () => {
      setupHistoryNote([createMockRun(false, '2026-02-12T10:00:00Z', 'commit')]);

      await expectValidationRun({
        retryFailed: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      });

      // A failure exists, so "no failed validation" would be false: name it and why it is not used
      const printed = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n');
      expect(printed).toContain('The newest run on tree');
      expect(printed).toContain('at level commit, failed');
      expect(printed).toContain('Running every step at level full');
      expect(printed).not.toContain('No failed validation');
    });
  });

  describe('retryFailed=true with previous validation that passed', () => {
    it('should use cached result when cached validation passed, with no retry message', async () => {
      // A pass at the requested level is a cache hit before the retry lookup runs
      // (nothing to retry — validation already succeeded)
      setupHistoryNote([createMockRun(true)]);

      await expectCacheUsed({
        retryFailed: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      });

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('No failed validation at level'));
    });

    it('a newer failure overturns an older pass: the retry builds on the failure', async () => {
      const newerRed = createMockRun(false, '2026-02-12T10:00:00Z');
      setupHistoryNote([createMockRun(true, '2026-02-12T09:00:00Z'), newerRed]);

      await expectValidationRun({
        retryFailed: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      }, newerRed);
    });
  });

  describe('retryFailed=false with a stored failed validation (regression guard)', () => {
    it('never replays a stored failure without the retry flag: the steps run again', async () => {
      setupHistoryNote([createMockRun(false)]);

      const runValidation = await getRunValidationMock();
      runValidation.mockResolvedValue({
        passed: true,
        timestamp: new Date().toISOString(),
        level: 'full',
        summary: 'All steps passed',
        phases: [],
      });

      const result = await executeWorkflow({ retryFailed: false, treeHashResult: MOCK_TREE_HASH_RESULT });

      expect(runValidation).toHaveBeenCalledTimes(1);
      expect(runValidation).toHaveBeenCalledWith(expect.objectContaining({ previousRun: undefined }));
      expect(result.isCachedResult).toBeUndefined();
    });
  });

  describe('retryFailed=true with previous validation that failed', () => {
    it('should pass previous run to runner', async () => {
      const previousRun = createMockRun(false);
      setupHistoryNote([previousRun]);

      await expectValidationRun({
        retryFailed: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      }, previousRun);

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('No failed validation at level')
      );
    });

    it('retries the newest failed run when several failures are recorded', async () => {
      const older = { ...createMockRun(false, '2026-02-12T09:00:00Z'), id: 'run-older' };
      const newer = { ...createMockRun(false, '2026-02-12T10:00:00Z'), id: 'run-newer' };
      setupHistoryNote([older, newer]);

      await expectValidationRun({
        retryFailed: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      }, newer);
    });
  });

  describe('retryFailed=true with force flag', () => {
    it('should ignore retry logic when force=true', async () => {
      const previousRun = createMockRun(false);
      setupHistoryNote([previousRun]);

      await expectValidationRun({
        retryFailed: true,
        force: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      });

      // The failed run is never handed to the runner, and no retry message is printed
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('No failed validation at level'));
    });

    it('re-runs a stored pass when force=true', async () => {
      setupHistoryNote([createMockRun(true)]);

      await expectValidationRun({
        force: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      });
    });
  });
});
