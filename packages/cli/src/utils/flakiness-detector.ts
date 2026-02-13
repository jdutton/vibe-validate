/**
 * Flakiness Detection Module
 *
 * Detects when validation passes after previous failure on same tree hash.
 * Helps identify flaky tests that pass/fail on the same code.
 */

import type { ValidationResult, StepResult } from '@vibe-validate/core';
import type { HistoryNote } from '@vibe-validate/history';

/**
 * Flaky step information
 */
interface FlakyStep {
  name: string;
  failedTimestamp: string;
  passedTimestamp: string;
}

/**
 * Detect flakiness by comparing runs on same tree hash
 *
 * @param note - History note containing previous runs
 * @param currentResult - Current validation result
 * @returns Formatted warning message or null if no flakiness detected
 */
export function detectFlakiness(
  note: HistoryNote,
  currentResult: ValidationResult,
): string | null {
  // No previous runs - can't detect flakiness
  if (!note.runs || note.runs.length === 0) {
    return null;
  }

  // Current validation failed - not flakiness (still failing)
  if (!currentResult.passed) {
    return null;
  }

  // Find most recent failed run from previous runs
  const sortedRuns = [...note.runs].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const recentFailedRun = sortedRuns.find((run) => !run.passed);

  // No previous failures - not flakiness
  if (!recentFailedRun) {
    return null;
  }

  // Detect which steps were flaky (failed → passed)
  const flakySteps = findFlakySteps(
    recentFailedRun.result,
    currentResult,
    recentFailedRun.timestamp,
    currentResult.timestamp,
  );

  // No flaky steps found (shouldn't happen if validation failed → passed, but handle gracefully)
  if (flakySteps.length === 0) {
    return null;
  }

  // Format warning message
  return formatFlakinessWarning(flakySteps);
}

/**
 * Find steps that failed in previous run but passed in current run
 */
function findFlakySteps(
  previousResult: ValidationResult,
  currentResult: ValidationResult,
  failedTimestamp: string,
  passedTimestamp: string,
): FlakyStep[] {
  // Need phases in both results
  if (!previousResult.phases || !currentResult.phases) {
    return [];
  }

  const flakySteps: FlakyStep[] = [];

  // Get all previous steps that failed
  const previousSteps = new Map<string, StepResult>();
  for (const phase of previousResult.phases) {
    for (const step of phase.steps) {
      previousSteps.set(step.name, step);
    }
  }

  // Check current steps for ones that passed (but failed before)
  for (const phase of currentResult.phases) {
    for (const step of phase.steps) {
      const previousStep = previousSteps.get(step.name);

      // Skip if step doesn't exist in previous run
      if (!previousStep) {
        continue;
      }

      // Flaky: failed before, passed now
      if (!previousStep.passed && step.passed) {
        flakySteps.push({
          name: step.name,
          failedTimestamp,
          passedTimestamp,
        });
      }
    }
  }

  return flakySteps;
}

/**
 * Format flakiness warning message
 */
function formatFlakinessWarning(flakySteps: FlakyStep[]): string {
  const lines: string[] = [];

  lines.push(
    '⚠️  Validation passed, but failed on previous run without code changes.',
    '',
    '    Failed steps from previous run:',
  );

  for (const step of flakySteps) {
    lines.push(
      `    - ${step.name} (failed ${step.failedTimestamp}, passed ${step.passedTimestamp})`,
    );
  }

  lines.push(
    '',
    '    This may indicate flaky tests. Consider investigating:',
    '    - Non-deterministic test behavior',
    '    - System resource contention',
    '    - External dependency issues',
  );

  return lines.join('\n');
}
