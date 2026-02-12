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

async function expectValidationRun(
  options: Partial<ValidateWorkflowOptions>,
  expectedPreviousRun?: ValidationRun
) {
  const { runValidation } = await import('@vibe-validate/core');

  vi.mocked(runValidation).mockResolvedValue({
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
