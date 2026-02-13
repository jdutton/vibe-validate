/**
 * Tests for flakiness detection
 */

import type { ValidationResult } from '@vibe-validate/core';
import type { HistoryNote, ValidationRun } from '@vibe-validate/history';
import { describe, it, expect } from 'vitest';

/**
 * Helper: Create validation run
 */
function createValidationRun(overrides: Partial<ValidationRun> = {}): ValidationRun {
  return {
    id: 'run-1234567890',
    timestamp: '2026-02-12T10:00:00Z',
    duration: 5000,
    passed: false,
    branch: 'main',
    headCommit: 'abc123',
    uncommittedChanges: false,
    result: {
      passed: false,
      timestamp: '2026-02-12T10:00:00Z',
      phases: [],
    },
    ...overrides,
  };
}

/**
 * Helper: Create validation result
 */
function createValidationResult(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return {
    passed: true,
    timestamp: '2026-02-12T10:05:00Z',
    phases: [],
    ...overrides,
  };
}

/**
 * Helper: Create history note
 */
function createHistoryNote(runs: ValidationRun[] = []): HistoryNote {
  return {
    treeHash: 'abc123def456',
    runs,
  };
}

/**
 * Helper: Create step result
 */
function createStepResult(
  name: string,
  passed: boolean,
  command = 'npm test',
  exitCode = passed ? 0 : 1,
  durationSecs = 60,
) {
  return {
    name,
    passed,
    command,
    exitCode,
    durationSecs,
  };
}

/**
 * Helper: Create phase result
 */
function createPhaseResult(name: string, steps: ReturnType<typeof createStepResult>[]) {
  return {
    name,
    passed: steps.every((s) => s.passed),
    durationSecs: steps.reduce((sum, s) => sum + s.durationSecs, 0),
    steps,
  };
}

/**
 * Helper: Create failed validation run with specific step failures
 */
function createFailedRun(
  timestamp: string,
  failedStepNames: string[],
  allStepNames: string[] = failedStepNames,
) {
  const steps = allStepNames.map((name) =>
    createStepResult(name, !failedStepNames.includes(name), 'npm test'),
  );

  return createValidationRun({
    passed: false,
    timestamp,
    result: {
      passed: false,
      timestamp,
      phases: [createPhaseResult('Tests', steps)],
    },
  });
}

/**
 * Helper: Create passed validation result with specific step passes
 */
function createPassedResult(
  timestamp: string,
  passedStepNames: string[],
  allStepNames: string[] = passedStepNames,
) {
  const steps = allStepNames.map((name) =>
    createStepResult(name, passedStepNames.includes(name), 'npm test'),
  );

  return createValidationResult({
    passed: steps.every((s) => s.passed),
    timestamp,
    phases: [createPhaseResult('Tests', steps)],
  });
}

/**
 * Helper: Test flakiness detection scenario
 */
async function expectFlakinessDetection(
  previousRuns: ValidationRun[],
  currentResult: ValidationResult,
  expectedWarning: boolean,
) {
  const { detectFlakiness } = await import('../../src/utils/flakiness-detector.js');
  const note = createHistoryNote(previousRuns);
  const warning = detectFlakiness(note, currentResult);

  if (expectedWarning) {
    expect(warning).not.toBeNull();
  } else {
    expect(warning).toBeNull();
  }

  return warning;
}

/**
 * Helper: Test simple flaky scenario (single step failed → passed)
 */
async function expectSimpleFlakyScenario(
  stepName: string,
  failedTime = '2026-02-12T10:00:00Z',
  passedTime = '2026-02-12T10:05:00Z',
) {
  const previousRun = createFailedRun(failedTime, [stepName]);
  const currentResult = createPassedResult(passedTime, [stepName]);
  return expectFlakinessDetection([previousRun], currentResult, true);
}

describe('detectFlakiness', () => {
  it('should return null when no previous runs exist', async () => {
    await expectFlakinessDetection([], createValidationResult({ passed: true }), false);
  });

  it('should return null when only one previous run exists', async () => {
    const previousRun = createValidationRun({
      passed: false,
      timestamp: '2026-02-12T10:00:00Z',
    });

    await expectFlakinessDetection(
      [previousRun],
      createValidationResult({ passed: true, timestamp: '2026-02-12T10:05:00Z' }),
      false,
    );
  });

  it('should return null when all previous runs passed', async () => {
    const previousRun = createValidationRun({
      passed: true,
      timestamp: '2026-02-12T10:00:00Z',
    });

    await expectFlakinessDetection(
      [previousRun],
      createValidationResult({ passed: true, timestamp: '2026-02-12T10:05:00Z' }),
      false,
    );
  });

  it('should return null when current validation failed', async () => {
    const previousRun = createValidationRun({
      passed: false,
      timestamp: '2026-02-12T10:00:00Z',
    });

    await expectFlakinessDetection(
      [previousRun],
      createValidationResult({ passed: false, timestamp: '2026-02-12T10:05:00Z' }),
      false,
    );
  });

  it('should detect validation-level flakiness (failed → passed)', async () => {
    const warning = await expectSimpleFlakyScenario('E2E Tests');

    expect(warning).toContain('⚠️  Validation passed, but failed on previous run without code changes.');
    expect(warning).toContain('Failed steps from previous run:');
    expect(warning).toContain('E2E Tests');
    expect(warning).toContain('failed 2026-02-12T10:00:00Z');
    expect(warning).toContain('passed 2026-02-12T10:05:00Z');
  });

  it('should only show steps that were flaky (failed → passed)', async () => {
    const allSteps = ['Unit Tests', 'E2E Tests'];
    const previousRun = createFailedRun('2026-02-12T10:00:00Z', ['E2E Tests'], allSteps);
    const currentResult = createPassedResult('2026-02-12T10:05:00Z', allSteps, allSteps);

    const warning = await expectFlakinessDetection([previousRun], currentResult, true);

    expect(warning).toContain('E2E Tests');
    expect(warning).not.toContain('Unit Tests'); // Consistently passed
  });

  it('should handle multiple flaky steps', async () => {
    const allSteps = ['E2E Tests', 'Integration Tests'];
    const previousRun = createFailedRun('2026-02-12T10:00:00Z', allSteps, allSteps);
    const currentResult = createPassedResult('2026-02-12T10:05:00Z', allSteps, allSteps);

    const warning = await expectFlakinessDetection([previousRun], currentResult, true);

    expect(warning).toContain('E2E Tests');
    expect(warning).toContain('Integration Tests');
  });

  it('should handle missing phases in previous run', async () => {
    const previousRun = createValidationRun({
      passed: false,
      timestamp: '2026-02-12T10:00:00Z',
      result: {
        passed: false,
        timestamp: '2026-02-12T10:00:00Z',
        phases: undefined,
      },
    });

    await expectFlakinessDetection(
      [previousRun],
      createValidationResult({ passed: true, timestamp: '2026-02-12T10:05:00Z' }),
      false,
    );
  });

  it('should handle missing phases in current result', async () => {
    const previousRun = createFailedRun('2026-02-12T10:00:00Z', ['E2E Tests']);

    await expectFlakinessDetection(
      [previousRun],
      createValidationResult({ passed: true, timestamp: '2026-02-12T10:05:00Z', phases: undefined }),
      false,
    );
  });

  it('should include investigation suggestions in warning', async () => {
    const warning = await expectSimpleFlakyScenario('E2E Tests');

    expect(warning).toContain('This may indicate flaky tests. Consider investigating:');
    expect(warning).toContain('Non-deterministic test behavior');
    expect(warning).toContain('System resource contention');
    expect(warning).toContain('External dependency issues');
  });

  it('should use most recent failed run when comparing', async () => {
    // Two previous runs, most recent one failed
    const olderRun = createValidationRun({
      passed: true,
      timestamp: '2026-02-12T09:00:00Z',
      result: {
        passed: true,
        timestamp: '2026-02-12T09:00:00Z',
        phases: [],
      },
    });

    const recentRun = createFailedRun('2026-02-12T10:00:00Z', ['E2E Tests']);
    const currentResult = createPassedResult('2026-02-12T10:05:00Z', ['E2E Tests']);

    const warning = await expectFlakinessDetection([olderRun, recentRun], currentResult, true);

    expect(warning).toContain('failed 2026-02-12T10:00:00Z'); // Recent run timestamp
  });
});
