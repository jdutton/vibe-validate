import { describe, it, expect } from 'vitest';

import { classifyStepExit, explainStepExit, type StepExitInput, type StepExitKind } from '../src/step-exit.js';

const parsed = {
  summary: '2 type errors',
  totalErrors: 2,
  errors: [{ file: 'src/index.ts', line: 3, message: 'bad' }],
  guidance: 'Fix the type errors',
};

const OUTSIDE = 'Something outside the command sent it';
const CRASH = 'The command crashed with';
const NO_OUTPUT = 'The command failed without printing anything';
const STOPPED = 'This step did not fail on its own';

interface Row {
  input: StepExitInput;
  kind: StepExitKind;
  exitCode: number;
  summary: string | null;
  /** A phrase the guidance must contain, or null when there is no explanation */
  guidance: string | null;
}

// Every combination of the inputs that matters: exit 0 / non-zero / 128+N
// (what a shell reports for a child a signal killed) / null; no signal, an
// outside signal or a crash signal; stopped or not; output or none; POSIX or
// Windows (where 128+N means nothing)
const exitCodes = [0, 2, 137, 139, 143, null] as const;
const signals = [null, 'SIGKILL', 'SIGTERM', 'SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGILL'] as const;
const stoppers = [null, 'Typecheck'] as const;
const platforms = ['linux', 'darwin', 'win32'] as const;

// Same number on Linux and macOS
const SHELL_SIGNALS: Record<number, string> = { 137: 'SIGKILL', 139: 'SIGSEGV', 143: 'SIGTERM' };
const CRASH_SIGNALS = new Set(['SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGILL']);

function signalGuidance(signal: string): string {
  return CRASH_SIGNALS.has(signal) ? `${CRASH} ${signal}` : `${OUTSIDE} ${signal}`;
}

function expectedOwnFailure(code: number, hasOutput: boolean, platform: string): Omit<Row, 'input'> {
  const shellSignal = platform === 'win32' ? undefined : SHELL_SIGNALS[code];
  if (shellSignal) {
    const note = `(exit 128+${code - 128}: likely killed by ${shellSignal})`;
    return {
      kind: 'own-failure',
      exitCode: code,
      summary: hasOutput ? `Exited with code ${code} ${note}` : `Exited with code ${code} and produced no output ${note}`,
      guidance: note,
    };
  }
  return hasOutput
    ? { kind: 'own-failure', exitCode: code, summary: null, guidance: null }
    : { kind: 'own-failure', exitCode: code, summary: `Exited with code ${code} and produced no output`, guidance: NO_OUTPUT };
}

function expected(input: StepExitInput): Omit<Row, 'input'> {
  const { exitCode, signal, stoppedBy, hasOutput, platform } = input;
  if (stoppedBy !== null) {
    return { kind: 'stopped', exitCode: exitCode === null || exitCode === 0 ? 1 : exitCode, summary: `Stopped by fail-fast after ${stoppedBy} failed`, guidance: STOPPED };
  }
  if (signal !== null) {
    return {
      kind: 'signal-killed',
      exitCode: 1,
      summary: hasOutput ? `Terminated by ${signal}` : `Terminated by ${signal} and produced no output`,
      guidance: signalGuidance(signal),
    };
  }
  if (exitCode === 0) {
    return { kind: 'passed', exitCode: 0, summary: null, guidance: null };
  }
  return expectedOwnFailure(exitCode ?? 1, hasOutput, platform);
}

const inputs: StepExitInput[] = exitCodes.flatMap(exitCode =>
  signals.flatMap(signal => stoppers.map(stoppedBy => ({ exitCode, signal, stoppedBy, hasOutput: true, platform: 'linux' as const })))
);
const rows: Row[] = inputs
  .flatMap(input => platforms.map(platform => ({ ...input, platform })))
  .flatMap(input => [true, false].map(hasOutput => ({ ...input, hasOutput })))
  .map(input => ({ input, ...expected(input) }));

describe('classifyStepExit', () => {
  it.each(rows)('$input → $kind (exit $exitCode)', ({ input, kind, exitCode, summary, guidance }) => {
    const exit = classifyStepExit(input);
    expect(exit.kind).toBe(kind);
    expect(exit.exitCode).toBe(exitCode);
    expect(exit.passed).toBe(kind === 'passed');
    expect(exit.explanation?.summary ?? null).toBe(summary);
    if (guidance === null) {
      expect(exit.explanation).toBeNull();
    } else {
      expect(exit.explanation?.guidance).toContain(guidance);
    }
  });

  it('never stores 0 for a step that did not pass', () => {
    for (const { input } of rows) {
      const exit = classifyStepExit(input);
      expect(exit.passed || exit.exitCode !== 0).toBe(true);
    }
  });

  it('gives a signal-killed step the signal guidance whether or not it printed', () => {
    for (const hasOutput of [true, false]) {
      const exit = classifyStepExit({ exitCode: null, signal: 'SIGKILL', stoppedBy: null, hasOutput, platform: 'linux' });
      expect(exit.explanation?.guidance).toContain(`${OUTSIDE} SIGKILL`);
    }
  });

  it('does not blame something outside the command for a crash signal', () => {
    const exit = classifyStepExit({ exitCode: null, signal: 'SIGSEGV', stoppedBy: null, hasOutput: false, platform: 'linux' });
    expect(exit.explanation?.guidance).toContain('core dump');
    expect(exit.explanation?.guidance).not.toContain(OUTSIDE);
  });

  it('points a shell-reported signal exit at the signal, not at the command', () => {
    const exit = classifyStepExit({ exitCode: 137, signal: null, stoppedBy: null, hasOutput: false, platform: 'linux' });
    expect(exit.explanation?.guidance).toContain(`${OUTSIDE} SIGKILL`);
    expect(exit.explanation?.guidance).not.toContain(NO_OUTPUT);
  });

  it('names the failing sibling in a stopped step guidance', () => {
    const exit = classifyStepExit({ exitCode: null, signal: 'SIGTERM', stoppedBy: 'Typecheck', hasOutput: true, platform: 'linux' });
    expect(exit.explanation?.guidance).toContain('terminated when Typecheck failed');
  });
});

describe('explainStepExit', () => {
  it('keeps parsed errors for a signal-killed step but leads with the signal', () => {
    const exit = classifyStepExit({ exitCode: null, signal: 'SIGKILL', stoppedBy: null, hasOutput: true, platform: 'linux' });
    const result = explainStepExit(exit, parsed);
    expect(result?.summary).toBe('Terminated by SIGKILL: 2 type errors');
    expect(result?.errors).toEqual(parsed.errors);
    expect(result?.totalErrors).toBe(2);
    expect(result?.guidance).toContain(`${OUTSIDE} SIGKILL`);
  });

  it('keeps parsed errors for a shell-reported signal exit but leads with the note', () => {
    const exit = classifyStepExit({ exitCode: 137, signal: null, stoppedBy: null, hasOutput: true, platform: 'linux' });
    const result = explainStepExit(exit, parsed);
    expect(result?.summary).toBe('Exited with code 137 (exit 128+9: likely killed by SIGKILL): 2 type errors');
    expect(result?.errors).toEqual(parsed.errors);
  });

  it('explains a signal-killed step that printed nothing', () => {
    const exit = classifyStepExit({ exitCode: null, signal: 'SIGKILL', stoppedBy: null, hasOutput: false, platform: 'linux' });
    expect(explainStepExit(exit)).toMatchObject({ summary: 'Terminated by SIGKILL and produced no output', totalErrors: 0, errors: [] });
  });

  it('ignores a stopped step partial output', () => {
    const exit = classifyStepExit({ exitCode: null, signal: 'SIGTERM', stoppedBy: 'Typecheck', hasOutput: true, platform: 'linux' });
    expect(explainStepExit(exit, parsed)).toMatchObject({ summary: 'Stopped by fail-fast after Typecheck failed', totalErrors: 0, errors: [] });
  });

  it('leaves an own failure with output to its parsed errors', () => {
    const exit = classifyStepExit({ exitCode: 2, signal: null, stoppedBy: null, hasOutput: true, platform: 'linux' });
    expect(explainStepExit(exit, parsed)).toBe(parsed);
  });

  it('names the exit code of an own failure that printed nothing', () => {
    const exit = classifyStepExit({ exitCode: 3, signal: null, stoppedBy: null, hasOutput: false, platform: 'linux' });
    expect(explainStepExit(exit)?.summary).toBe('Exited with code 3 and produced no output');
  });

  it('adds nothing to a passing step', () => {
    const exit = classifyStepExit({ exitCode: 0, signal: null, stoppedBy: null, hasOutput: true, platform: 'linux' });
    expect(explainStepExit(exit)).toBeUndefined();
  });
});
