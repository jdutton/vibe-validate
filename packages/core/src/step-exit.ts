/**
 * How a finished step process ended, decided once for the sequential and the
 * parallel runner alike: what to store as its exit code, whether it passed, and
 * what its extraction summary and guidance say about how it ended.
 */

import type { ErrorExtractorResult } from '@vibe-validate/extractors';

/**
 * - `passed`: exited 0 on its own.
 * - `own-failure`: exited non-zero on its own.
 * - `stopped`: fail-fast terminated it because a sibling failed.
 * - `signal-killed`: a signal from outside the run ended it (out-of-memory
 *   killer, CI timeout, external kill).
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
}

export interface StepExit {
  kind: StepExitKind;
  /** Exit code to store: never 0 unless the step passed, never null */
  exitCode: number;
  passed: boolean;
  /**
   * What the extraction summary leads with, and the guidance that replaces the
   * extractor's, when how the step ended is itself the explanation. Null for a
   * pass, and for an own failure that printed output (its errors explain it).
   */
  explanation: { summary: string; guidance: string } | null;
}

/** Decide how a step ended. Pure: the same input always gives the same answer. */
export function classifyStepExit({ exitCode, signal, stoppedBy, hasOutput }: StepExitInput): StepExit {
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
        guidance: `Something outside the command sent it ${signal} — often running out of memory or a CI timeout. Check the machine or CI job, then run it directly.`,
      },
    };
  }
  if (exitCode === 0) {
    return { kind: 'passed', exitCode: 0, passed: true, explanation: null };
  }
  // Node reports a code or a signal; null for both is treated as a failure
  const code = exitCode ?? 1;
  return {
    kind: 'own-failure',
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

/**
 * The extraction to store for a step that ended as `exit` describes, given what
 * was extracted from its output (if anything).
 *
 * A signal-killed step keeps its parsed errors, but its summary leads with the
 * signal and the guidance is the signal's. A stopped step's partial output is
 * never used, and a failure that printed nothing has nothing else to say.
 */
export function explainStepExit(exit: StepExit, extracted?: ErrorExtractorResult): ErrorExtractorResult | undefined {
  if (exit.explanation === null) {
    return extracted;
  }
  const { summary, guidance } = exit.explanation;
  if (exit.kind === 'signal-killed' && extracted) {
    return { ...extracted, summary: `${summary}: ${extracted.summary}`, guidance };
  }
  return { summary, totalErrors: 0, errors: [], guidance };
}
