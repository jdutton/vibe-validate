import { describe, it, expect } from 'vitest';

import { findFailedStepResult, isOwnStepFailure } from '../src/result-schema.js';

interface TestStep {
  name: string;
  passed: boolean;
  stoppedByFailFast?: boolean;
  extraction?: { summary: string };
}

const anyStep = (): boolean => true;

function blame(failedStep: string | undefined, ...phases: TestStep[][]): string | undefined {
  return findFailedStepResult(
    { ...(failedStep ? { failedStep } : {}), phases: phases.map(steps => ({ steps })) },
    anyStep
  )?.name;
}

describe('findFailedStepResult', () => {
  it('blames the run\'s failedStep, whatever order the steps finished in', () => {
    expect(blame('Slow', [{ name: 'Fast', passed: false }, { name: 'Slow', passed: false }])).toBe('Slow');
  });

  it('never blames a step fail-fast stopped, even when failedStep names it', () => {
    expect(blame('ESLint', [
      { name: 'ESLint', passed: false, stoppedByFailFast: true },
      { name: 'Typecheck', passed: false },
    ])).toBe('Typecheck');
  });

  it('skips a passing step that shares the failed step\'s name in another phase', () => {
    const result = findFailedStepResult({
      failedStep: 'build',
      phases: [
        { steps: [{ name: 'build', passed: true, command: 'deps' }] },
        { steps: [{ name: 'build', passed: false, command: 'package' }] },
      ],
    }, anyStep);
    expect(result?.command).toBe('package');
  });

  it('blames the first own failure when the result has no failedStep', () => {
    expect(blame(undefined, [{ name: 'A', passed: true }], [{ name: 'B', passed: false }, { name: 'C', passed: false }])).toBe('B');
  });

  it('only considers steps the caller accepts', () => {
    const result = findFailedStepResult({
      failedStep: 'A',
      phases: [{ steps: [{ name: 'A', passed: false }, { name: 'B', passed: false, extraction: { summary: 'x' } }] }],
    }, step => step.extraction !== undefined);
    expect(result?.name).toBe('B');
  });

  it('returns undefined when nothing failed on its own', () => {
    expect(blame('A', [{ name: 'A', passed: false, stoppedByFailFast: true }])).toBeUndefined();
  });

  // Runners older than stoppedByFailFast gave this summary to ANY failure that
  // printed little (a silent `git diff --quiet` included), so it proves nothing.
  it('blames a silent real failure from an older runner that failedStep names', () => {
    expect(blame('Guard', [
      { name: 'Lint', passed: false, extraction: { summary: '2 lint errors' } },
      { name: 'Guard', passed: false, extraction: { summary: 'Process stopped (fail-fast)' } },
    ])).toBe('Guard');
  });
});

describe('isOwnStepFailure', () => {
  it.each([
    [{ passed: true }, false],
    [{ passed: false }, true],
    [{ passed: false, stoppedByFailFast: true }, false],
  ])('%j -> %s', (step, expected) => {
    expect(isOwnStepFailure(step)).toBe(expected);
  });
});
