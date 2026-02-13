/**
 * Tests for --retry-failed flag in validate workflow
 */

import './validate-workflow-test-setup.js';

import { findCachedValidation } from '@vibe-validate/history';
import type { ValidationRun } from '@vibe-validate/history';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { ValidateWorkflowOptions } from '../../src/utils/validate-workflow.js';


import {
  createMockRun,
  setupConsoleMocks,
  setupGitMock,
  executeWorkflow,
  MOCK_TREE_HASH,
  MOCK_TREE_HASH_RESULT,
} from './validate-workflow-test-helpers.js';

// Test Helpers

function setupFindCachedValidationMock(
  firstCallResult: ValidationRun | null,
  secondCallResult?: ValidationRun | null
) {
  if (secondCallResult === undefined) {
    // Single call expected
    vi.mocked(findCachedValidation).mockResolvedValue(firstCallResult);
  } else {
    // Two calls expected (checkCache, then retry logic)
    let callCount = 0;
    vi.mocked(findCachedValidation).mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? firstCallResult : secondCallResult;
    });
  }
}

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
    summary: 'All steps passed',
    phases: [],
  });

  await executeWorkflow(options);

  expect(runValidation).toHaveBeenCalledWith(
    expect.objectContaining({
      previousRun: expectedPreviousRun,
    })
  );
}

async function expectCacheUsed(
  options: Partial<ValidateWorkflowOptions>,
  expectedPassed: boolean
) {
  const runValidation = await getRunValidationMock();

  const result = await executeWorkflow(options);

  expect(runValidation).not.toHaveBeenCalled();
  expect(result.passed).toBe(expectedPassed);
  expect(result.isCachedResult).toBe(true);
}

describe('validate-workflow retry-failed', () => {
  beforeEach(() => {
    setupGitMock();
    setupConsoleMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('retryFailed=false (normal validation)', () => {
    it('should not use retry logic when retryFailed=false', async () => {
      setupFindCachedValidationMock(null);

      await expectValidationRun({
        retryFailed: false,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      });

      // findCachedValidation called once for normal cache check
      expect(findCachedValidation).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryFailed=true with no previous validation', () => {
    it('should show message and run full validation', async () => {
      setupFindCachedValidationMock(null);
      const consoleErrorSpy = vi.spyOn(console, 'error');

      await expectValidationRun({
        retryFailed: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      });

      expect(findCachedValidation).toHaveBeenCalledWith(MOCK_TREE_HASH_RESULT);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No failed validation found')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(MOCK_TREE_HASH)
      );
    });
  });

  describe('retryFailed=true with previous validation that passed', () => {
    it('should show message and run full validation', async () => {
      const previousRun = createMockRun(true);
      setupFindCachedValidationMock(null, previousRun);
      const consoleErrorSpy = vi.spyOn(console, 'error');

      await expectValidationRun({
        retryFailed: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Previous validation passed')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(MOCK_TREE_HASH)
      );
    });

    it('should use cached result when cached validation passed', async () => {
      // When the cached result PASSED, --retry-failed should still use the cache
      // (nothing to retry — validation already succeeded)
      const passedRun = createMockRun(true);
      setupFindCachedValidationMock(passedRun);

      await expectCacheUsed({
        retryFailed: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      }, true);
    });
  });

  describe('retryFailed=false with cached failed validation (regression guard)', () => {
    it('should still return cached failed result without retry flag', async () => {
      // Without --retry-failed, a cached failure should be returned as-is
      // (existing behavior must not break)
      const failedRun = createMockRun(false);
      setupFindCachedValidationMock(failedRun);

      await expectCacheUsed({
        retryFailed: false,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      }, false);
    });
  });

  describe('retryFailed=true with previous validation that failed', () => {
    it('should pass previous run to runner', async () => {
      const previousRun = createMockRun(false);
      setupFindCachedValidationMock(null, previousRun);
      const consoleErrorSpy = vi.spyOn(console, 'error');

      await expectValidationRun({
        retryFailed: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      }, previousRun);

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('No failed validation found')
      );
    });

    it('should bypass cache and retry when cached result is a failure', async () => {
      // This models the REAL scenario: findCachedValidation returns the failed
      // run on BOTH calls — first for checkCache(), then for retry logic.
      // The cache check must NOT short-circuit when --retry-failed is set and
      // the cached result is a failure.
      const failedRun = createMockRun(false);
      setupFindCachedValidationMock(failedRun, failedRun);

      await expectValidationRun({
        retryFailed: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      }, failedRun);
    });
  });

  describe('retryFailed=true with force flag', () => {
    it('should ignore retry logic when force=true', async () => {
      const previousRun = createMockRun(false);
      vi.mocked(findCachedValidation).mockResolvedValue(previousRun);

      await expectValidationRun({
        retryFailed: true,
        force: true,
        treeHashResult: MOCK_TREE_HASH_RESULT,
      });

      // Should NOT call findCachedValidation for retry when force=true
      expect(findCachedValidation).not.toHaveBeenCalled();
    });
  });
});
