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
    level: 'full',
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
    level: 'full',
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

  it('does not call a step flaky when fail-fast stopped it in the failed run', async () => {
    const allSteps = ['Typecheck', 'ESLint'];
    const previousRun = createFailedRun('2026-02-12T10:00:00Z', allSteps, allSteps);
    const stoppedStep = previousRun.result.phases?.[0]?.steps.find((s) => s.name === 'ESLint');
    if (!stoppedStep) throw new Error('fixture: expected an ESLint step');
    stoppedStep.stoppedByFailFast = true;
    const currentResult = createPassedResult('2026-02-12T10:05:00Z', allSteps, allSteps);

    const warning = await expectFlakinessDetection([previousRun], currentResult, true);

    expect(warning).toContain('Typecheck');
    expect(warning).not.toContain('ESLint');
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

  describe('levels', () => {
    // A level-filtered run executes a subset of the steps. Only steps both runs
    // executed are compared, so no level filter is needed (or wanted).

    it('a commit green after a full red whose only failed step is full-only is not flakiness', async () => {
      // Full ran Lint (passed) and E2E (full-only, failed); commit ran only Lint
      const fullRed = createFailedRun('2026-02-12T10:00:00Z', ['E2E Tests'], ['Lint', 'E2E Tests']);
      const commitGreen = { ...createPassedResult('2026-02-12T10:05:00Z', ['Lint']), level: 'commit' };

      await expectFlakinessDetection([fullRed], commitGreen, false);
    });

    it('a commit green after a full red on a commit-level step is flakiness', async () => {
      // Full ran Lint (a commit-level step, failed) and E2E; commit ran Lint, which now passes
      const fullRed = createFailedRun('2026-02-12T10:00:00Z', ['Lint'], ['Lint', 'E2E Tests']);
      const commitGreen = { ...createPassedResult('2026-02-12T10:05:00Z', ['Lint']), level: 'commit' };

      const warning = await expectFlakinessDetection([fullRed], commitGreen, true);

      expect(warning).toContain('Lint');
      expect(warning).not.toContain('E2E Tests');
    });

    it('finds a flaky step behind a newer red at another level that did not run it', async () => {
      // commit red on Lint, then a full red that ran only E2E, then commit green on Lint
      const commitRed = { ...createFailedRun('2026-02-12T10:00:00Z', ['Lint']), level: 'commit' };
      const fullRed = createFailedRun('2026-02-12T10:02:00Z', ['E2E Tests'], ['E2E Tests']);
      const commitGreen = { ...createPassedResult('2026-02-12T10:05:00Z', ['Lint']), level: 'commit' };

      const warning = await expectFlakinessDetection([commitRed, fullRed], commitGreen, true);

      expect(warning).toContain('Lint (failed 2026-02-12T10:00:00Z');
    });

    it('compares each step with its own newest earlier result, so a flip is reported once', async () => {
      // Lint failed, then a commit green passed it (reported then); a later full green
      // passes it again: its newest earlier result is that pass, so nothing flipped
      const commitRed = { ...createFailedRun('2026-02-12T10:00:00Z', ['Lint']), level: 'commit' };
      const commitGreen = { ...createValidationRun({ passed: true, timestamp: '2026-02-12T10:02:00Z', level: 'commit' }), result: createPassedResult('2026-02-12T10:02:00Z', ['Lint']) };
      const fullGreen = createPassedResult('2026-02-12T10:05:00Z', ['Lint', 'E2E Tests']);

      await expectFlakinessDetection([commitRed, commitGreen], fullGreen, false);
    });

    it('a pass after a red at the same level is', async () => {
      const commitRed = { ...createFailedRun('2026-02-12T10:00:00Z', ['Unit Tests']), level: 'commit' };
      const commitGreen = { ...createPassedResult('2026-02-12T10:05:00Z', ['Unit Tests']), level: 'commit' };

      await expectFlakinessDetection([commitRed], commitGreen, true);
    });
  });
});
