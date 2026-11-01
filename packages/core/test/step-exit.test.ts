import { describe, it, expect } from 'vitest';

import { classifyStepExit, explainStepExit, type StepExitInput, type StepExitKind } from '../src/step-exit.js';

const parsed = {
  summary: '2 type errors',
  totalErrors: 2,
  errors: [{ file: 'src/index.ts', line: 3, message: 'bad' }],
  guidance: 'Fix the type errors',
};

interface Row {
  input: StepExitInput;
  kind: StepExitKind;
  exitCode: number;
  summary: string | null;
}

// Every combination of the four inputs that matters: exit 0 / non-zero / null,
// signal or none, stopped or not, output or none
const exitCodes = [0, 2, 143, null] as const;
const signals = [null, 'SIGKILL', 'SIGTERM'] as const;
const stoppers = [null, 'Typecheck'] as const;

function expected(input: StepExitInput): Omit<Row, 'input'> {
  const { exitCode, signal, stoppedBy, hasOutput } = input;
  if (stoppedBy !== null) {
    return { kind: 'stopped', exitCode: exitCode === null || exitCode === 0 ? 1 : exitCode, summary: `Stopped by fail-fast after ${stoppedBy} failed` };
  }
  if (signal !== null) {
    return { kind: 'signal-killed', exitCode: 1, summary: hasOutput ? `Terminated by ${signal}` : `Terminated by ${signal} and produced no output` };
  }
  if (exitCode === 0) {
    return { kind: 'passed', exitCode: 0, summary: null };
  }
  const code = exitCode ?? 1;
  return { kind: 'own-failure', exitCode: code, summary: hasOutput ? null : `Exited with code ${code} and produced no output` };
}

const rows: Row[] = exitCodes.flatMap(exitCode =>
  signals.flatMap(signal =>
    stoppers.flatMap(stoppedBy =>
      [true, false].map(hasOutput => {
        const input = { exitCode, signal, stoppedBy, hasOutput };
        return { input, ...expected(input) };
      })
    )
  )
);

describe('classifyStepExit', () => {
  it.each(rows)('$input → $kind (exit $exitCode)', ({ input, kind, exitCode, summary }) => {
    const exit = classifyStepExit(input);
    expect(exit.kind).toBe(kind);
    expect(exit.exitCode).toBe(exitCode);
    expect(exit.passed).toBe(kind === 'passed');
    expect(exit.explanation?.summary ?? null).toBe(summary);
  });

  it('never stores 0 for a step that did not pass', () => {
    for (const { input } of rows) {
      const exit = classifyStepExit(input);
      expect(exit.passed || exit.exitCode !== 0).toBe(true);
    }
  });

  it('gives a signal-killed step the signal guidance whether or not it printed', () => {
    for (const hasOutput of [true, false]) {
      const exit = classifyStepExit({ exitCode: null, signal: 'SIGKILL', stoppedBy: null, hasOutput });
      expect(exit.explanation?.guidance).toContain('Something outside the command sent it SIGKILL');
    }
  });

  it('names the failing sibling in a stopped step guidance', () => {
    const exit = classifyStepExit({ exitCode: null, signal: 'SIGTERM', stoppedBy: 'Typecheck', hasOutput: true });
    expect(exit.explanation?.guidance).toContain('terminated when Typecheck failed');
  });
});

describe('explainStepExit', () => {
  it('keeps parsed errors for a signal-killed step but leads with the signal', () => {
    const exit = classifyStepExit({ exitCode: null, signal: 'SIGKILL', stoppedBy: null, hasOutput: true });
    const result = explainStepExit(exit, parsed);
    expect(result?.summary).toBe('Terminated by SIGKILL: 2 type errors');
    expect(result?.errors).toEqual(parsed.errors);
    expect(result?.totalErrors).toBe(2);
    expect(result?.guidance).toContain('Something outside the command sent it SIGKILL');
  });

  it('explains a signal-killed step that printed nothing', () => {
    const exit = classifyStepExit({ exitCode: null, signal: 'SIGKILL', stoppedBy: null, hasOutput: false });
    expect(explainStepExit(exit)).toMatchObject({ summary: 'Terminated by SIGKILL and produced no output', totalErrors: 0, errors: [] });
  });

  it('ignores a stopped step partial output', () => {
    const exit = classifyStepExit({ exitCode: null, signal: 'SIGTERM', stoppedBy: 'Typecheck', hasOutput: true });
    expect(explainStepExit(exit, parsed)).toMatchObject({ summary: 'Stopped by fail-fast after Typecheck failed', totalErrors: 0, errors: [] });
  });

  it('leaves an own failure with output to its parsed errors', () => {
    const exit = classifyStepExit({ exitCode: 2, signal: null, stoppedBy: null, hasOutput: true });
    expect(explainStepExit(exit, parsed)).toBe(parsed);
  });

  it('names the exit code of an own failure that printed nothing', () => {
    const exit = classifyStepExit({ exitCode: 3, signal: null, stoppedBy: null, hasOutput: false });
    expect(explainStepExit(exit)?.summary).toBe('Exited with code 3 and produced no output');
  });

  it('adds nothing to a passing step', () => {
    const exit = classifyStepExit({ exitCode: 0, signal: null, stoppedBy: null, hasOutput: true });
    expect(explainStepExit(exit)).toBeUndefined();
  });
});
