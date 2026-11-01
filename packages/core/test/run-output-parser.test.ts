import { describe, it, expect } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';

import { parseVibeValidateOutput } from '../src/run-output-parser.js';

function failedStepResult(name: string, exitCode: number, summary: string, totalErrors: number): Record<string, unknown> {
  return {
    name,
    command: `pnpm ${name.toLowerCase()}`,
    exitCode,
    durationSecs: 0.3,
    passed: false,
    extraction: { summary, totalErrors, errors: [] },
  };
}

function validateOutput(steps: Array<Record<string, unknown>>): string {
  return `---\n${stringifyYaml({
    passed: false,
    timestamp: '2026-11-01T10:00:00Z',
    failedStep: 'Typecheck',
    phases: [{ name: 'Checks', passed: false, durationSecs: 1, steps }],
  })}`;
}

describe('parseVibeValidateOutput (nested validate result)', () => {
  it('surfaces the extraction of the step that failed, not a sibling fail-fast stopped ahead of it', () => {
    const output = validateOutput([
      {
        name: 'ESLint',
        command: 'pnpm lint',
        exitCode: 143,
        durationSecs: 0.4,
        passed: false,
        stoppedByFailFast: true,
        extraction: { summary: 'Stopped by fail-fast after Typecheck failed', totalErrors: 0, errors: [] },
      },
      failedStepResult('Typecheck', 2, '1 type error', 1),
    ]);

    expect(parseVibeValidateOutput(output)?.extraction.summary).toBe('1 type error');
  });

  it('surfaces the extraction of the run\'s failedStep when several steps failed, whatever order they finished in', () => {
    const output = validateOutput([
      failedStepResult('Lint', 1, '3 lint errors', 3),
      failedStepResult('Typecheck', 2, '1 type error', 1),
    ]);

    expect(parseVibeValidateOutput(output)?.extraction.summary).toBe('1 type error');
  });

  it('finds the failing failedStep when a passing step in an earlier phase has the same name', () => {
    const output = `---\n${stringifyYaml({
      passed: false,
      timestamp: '2026-11-01T10:00:00Z',
      failedStep: 'build',
      phases: [
        { name: 'Prepare', passed: true, durationSecs: 1, steps: [{ name: 'build', command: 'pnpm build:deps', exitCode: 0, durationSecs: 1, passed: true }] },
        {
          name: 'Package',
          passed: false,
          durationSecs: 1,
          steps: [failedStepResult('build', 2, '2 build errors', 2)],
        },
      ],
    })}`;

    expect(parseVibeValidateOutput(output)?.extraction.summary).toBe('2 build errors');
  });
});
