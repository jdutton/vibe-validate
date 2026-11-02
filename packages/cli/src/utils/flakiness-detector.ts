/**
 * Flakiness Detection Module
 *
 * Detects when validation passes after previous failure on same tree hash.
 * Helps identify flaky tests that pass/fail on the same code.
 */

import { isOwnStepFailure, type ValidationResult, type StepResult } from '@vibe-validate/core';
import type { HistoryNote, ValidationRun } from '@vibe-validate/history';

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

  // Failed runs at ANY level, newest first. Runs at different levels execute
  // different step sets, so the comparison is step by step: only a step both
  // runs executed can be flaky (a full red on a commit-level step followed by a
  // commit green on it is; a full red on a full-only step says nothing here).
  const failedRuns = note.runs
    .filter((run) => !run.passed)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const flakySteps = findFlakySteps(failedRuns, currentResult);

  // No step that failed before passes now - not flakiness
  if (flakySteps.length === 0) {
    return null;
  }

  // Format warning message
  return formatFlakinessWarning(flakySteps);
}

/** Every step a result executed, by name */
function stepsByName(result: ValidationResult): Map<string, StepResult> {
  const steps = new Map<string, StepResult>();
  for (const phase of result.phases ?? []) {
    for (const step of phase.steps) {
      steps.set(step.name, step);
    }
  }
  return steps;
}

/**
 * Steps that pass in the current run and failed on their own (not stopped by
 * fail-fast) in a previous run, each paired with the newest run it failed in
 *
 * A step the current run did not execute is never compared: only steps
 * present in both runs can flip.
 */
function findFlakySteps(failedRunsNewestFirst: ValidationRun[], currentResult: ValidationResult): FlakyStep[] {
  const failedRunSteps = failedRunsNewestFirst.map((run) => ({ run, steps: stepsByName(run.result) }));
  const flakySteps: FlakyStep[] = [];

  for (const [name, step] of stepsByName(currentResult)) {
    if (!step.passed) continue;
    const failedIn = failedRunSteps.find(({ steps }) => {
      const previousStep = steps.get(name);
      return previousStep !== undefined && isOwnStepFailure(previousStep);
    });
    if (failedIn) {
      flakySteps.push({ name, failedTimestamp: failedIn.run.timestamp, passedTimestamp: currentResult.timestamp });
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
