/**
 * How a finished step process ended, decided once for the sequential and the
 * parallel runner alike: what to store as its exit code, whether it passed, and
 * what its extraction summary and guidance say about how it ended.
 */

import { constants } from 'node:os';

import type { ErrorExtractorResult } from '@vibe-validate/extractors';

/**
 * - `passed`: exited 0 on its own.
 * - `own-failure`: exited non-zero. That includes a shell or script runner
 *   reporting 128+N for a child a signal killed: only a directly spawned
 *   process shows vibe-validate the signal itself, so a 128+N exit is only
 *   noted as a likely signal, never classified as one.
 * - `stopped`: fail-fast terminated it because a sibling failed.
 * - `signal-killed`: a signal ended it — either sent from outside the run
 *   (out-of-memory killer, CI timeout, external kill) or raised by the process
 *   itself when it crashed (SIGSEGV, SIGABRT, SIGBUS, SIGFPE, SIGILL).
 */
export type StepExitKind = 'passed' | 'own-failure' | 'stopped' | 'signal-killed';

export interface StepExitInput {
  /** Exit code from the process `close` event; null when a signal ended it */
  exitCode: number | null;
  /** Signal from the process `close` event; null when it exited */
  signal: NodeJS.Signals | null;
  /** Name of the step whose failure made fail-fast stop this one, or null */
  stoppedBy: string | null;
  /** Whether the step printed anything other than whitespace */
  hasOutput: boolean;
  /** Where the step ran: exit 128+N means "killed by signal N" only off Windows */
  platform: NodeJS.Platform;
}

export interface StepExit {
  kind: StepExitKind;
  /** Exit code to store: never 0 unless the step passed, never null */
  exitCode: number;
  passed: boolean;
  /**
   * What the extraction summary leads with, and the guidance that replaces the
   * extractor's, when how the step ended is itself the explanation. Null for a
   * pass, and for an own failure that printed output and exited with a code
   * that names no signal (its errors explain it).
   */
  explanation: { summary: string; guidance: string } | null;
}

const OWN_FAILURE = 'own-failure' satisfies StepExitKind;

/** Signals a process raises on itself when it crashes, rather than receives */
const CRASH_SIGNALS: ReadonlySet<string> = new Set(['SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGILL']);

function signalGuidance(signal: string): string {
  return CRASH_SIGNALS.has(signal)
    ? `The command crashed with ${signal} — a native crash or abort, usually in a native module or the runtime itself. Check for a core dump, or a native module built for another Node version, then run it directly.`
    : `Something outside the command sent it ${signal} — often running out of memory or a CI timeout. Check the machine or CI job, then run it directly.`;
}

/**
 * The signal a 128+N exit code most likely reports: a shell exits 128+N when
 * its child is killed by signal N. Undefined on Windows, outside 129–192, or
 * when N is not a signal this platform names.
 */
function signalFromShellExit(code: number, platform: NodeJS.Platform): { signal: string; number: number } | undefined {
  if (platform === 'win32' || code < 129 || code > 192) {
    return undefined;
  }
  const number = code - 128;
  const entry = Object.entries(constants.signals).find(([, value]) => value === number);
  return entry ? { signal: entry[0], number } : undefined;
}

function ownFailure(code: number, hasOutput: boolean, platform: NodeJS.Platform): StepExit {
  const shellSignal = signalFromShellExit(code, platform);
  if (shellSignal) {
    const note = `(exit 128+${shellSignal.number}: likely killed by ${shellSignal.signal})`;
    return {
      kind: OWN_FAILURE,
      exitCode: code,
      passed: false,
      explanation: {
        summary: hasOutput ? `Exited with code ${code} ${note}` : `Exited with code ${code} and produced no output ${note}`,
        guidance: `A shell or script runner between vibe-validate and the command reported ${note}. ${signalGuidance(shellSignal.signal)}`,
      },
    };
  }
  return {
    kind: OWN_FAILURE,
    exitCode: code,
    passed: false,
    explanation: hasOutput
      ? null
      : {
          summary: `Exited with code ${code} and produced no output`,
          guidance: 'The command failed without printing anything. Run it directly to see why it exited non-zero.',
        },
  };
}

/** Decide how a step ended. Pure: the same input always gives the same answer. */
export function classifyStepExit({ exitCode, signal, stoppedBy, hasOutput, platform }: StepExitInput): StepExit {
  if (stoppedBy !== null) {
    // Never stored as 0 even if it exited 0 on SIGTERM (a graceful cancel):
    // older releases reuse a step on --retry-failed by exitCode === 0 alone
    return {
      kind: 'stopped',
      exitCode: exitCode === null || exitCode === 0 ? 1 : exitCode,
      passed: false,
      explanation: {
        summary: `Stopped by fail-fast after ${stoppedBy} failed`,
        guidance: `This step did not fail on its own: it was terminated when ${stoppedBy} failed. Fix ${stoppedBy} first.`,
      },
    };
  }
  if (signal !== null) {
    // It never exited, so there is no exit cause to hunt for in the command
    return {
      kind: 'signal-killed',
      exitCode: 1,
      passed: false,
      explanation: {
        summary: hasOutput ? `Terminated by ${signal}` : `Terminated by ${signal} and produced no output`,
        guidance: signalGuidance(signal),
      },
    };
  }
  if (exitCode === 0) {
    return { kind: 'passed', exitCode: 0, passed: true, explanation: null };
  }
  // Node reports a code or a signal; null for both is treated as a failure
  return ownFailure(exitCode ?? 1, hasOutput, platform);
}

/**
 * The extraction to store for a step that ended as `exit` describes, given what
 * was extracted from its output (if anything).
 *
 * A step whose ending explains it (a signal, or a 128+N exit) keeps its parsed
 * errors, but its summary leads with that explanation and the guidance is its
 * (unless a 128+N exit's output parsed into errors: the extractor's guidance
 * stays, since that exit is only likely a signal). A stopped step's partial output is never used, and a failure that printed
 * nothing has nothing else to say.
 */
export function explainStepExit(exit: StepExit, extracted?: ErrorExtractorResult): ErrorExtractorResult | undefined {
  if (exit.explanation === null) {
    return extracted;
  }
  const { summary, guidance } = exit.explanation;
  // A 128+N exit is only likely a signal (Mocha and Cypress exit with their
  // failure count), so parsed errors keep the extractor's own guidance
  if (exit.kind === OWN_FAILURE && extracted && extracted.totalErrors > 0) {
    return { ...extracted, summary: `${summary}: ${extracted.summary}` };
  }
  if (exit.kind !== 'stopped' && extracted) {
    return { ...extracted, summary: `${summary}: ${extracted.summary}`, guidance };
  }
  return { summary, totalErrors: 0, errors: [], guidance };
}
