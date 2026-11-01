/**
 * Zod Schema for Validation Results
 *
 * This schema defines the structure of validation state files and enables
 * runtime validation and JSON Schema generation for documentation.
 */

import { createSafeValidator, createStrictValidator } from '@vibe-validate/config';
import { ErrorExtractorResultSchema } from '@vibe-validate/extractors';
import { z } from 'zod';

/**
 * Base: Command Execution Schema
 *
 * Shared by all command executions (RunResult, StepResult).
 * Every command execution has:
 * - What ran (command)
 * - How it ended (exitCode)
 * - How long it took (durationSecs)
 * - What errors occurred (extraction)
 */
export const CommandExecutionSchema = z.object({
  /** Command that was executed */
  command: z.string().min(1),

  /** Exit code from the command */
  exitCode: z.number().int(),

  /** Execution duration in seconds */
  durationSecs: z.coerce.number(),

  /** Extracted error information (LLM-optimized, structured errors) */
  extraction: ErrorExtractorResultSchema.optional(),
});

/**
 * Output Files Schema
 *
 * Shared by RunResult and StepResult.
 * Provides paths to organized output files for debugging and inspection.
 */
export const OutputFilesSchema = z.object({
  /** Path to stdout.log (omitted if empty) */
  stdout: z.string().optional(),
  /** Path to stderr.log (omitted if empty) */
  stderr: z.string().optional(),
  /** Path to combined.jsonl (chronological, ANSI-stripped) */
  combined: z.string(),
});

/**
 * Base: Operation Metadata Schema
 *
 * Shared by top-level operations (RunResult, ValidationResult).
 * Every operation has:
 * - When it ran (timestamp)
 * - What code state (treeHash) - optional to avoid duplication in output
 *
 * Note: treeHash is optional to allow output layers (history, state) to
 * provide it at the root level, avoiding token-wasting duplication in nested objects.
 */
export const OperationMetadataSchema = z.object({
  /** When the operation was executed (ISO 8601) */
  timestamp: z.string().datetime(),

  /** Git tree hash identifying the code state (optional when provided at root level) */
  treeHash: z.string().min(1).optional(),
});

/**
 * Validation Step Result Schema
 *
 * Extends CommandExecutionSchema with step-specific fields.
 *
 * Field ordering is optimized for LLM consumption:
 * - What step (name)
 * - Did it pass? (passed)
 * - Command execution details (command, exitCode, durationSecs, extraction)
 * - Debug resources (outputFiles)
 *
 * v0.15.0 BREAKING CHANGES:
 * - Now extends CommandExecutionSchema (adds command, exitCode)
 * - Removed extractionQuality (use extraction.metadata instead)
 * - Removed output field (use extraction instead)
 * - Removed failedTests field (use extraction.errors instead)
 * - Added isCachedResult to indicate when result came from cache
 * - Added .strict() to reject unknown properties (prevents internal fields from leaking)
 * - Added outputFiles for debugging (stdout.log, stderr.log, combined.jsonl)
 *   - Only shown in results when step fails or --debug flag enabled
 */
export const StepResultSchema = CommandExecutionSchema.extend({
  /** Step name */
  name: z.string(),

  /** Did the step pass? (exitCode === 0 and not stopped by fail-fast) */
  passed: z.boolean(),

  /**
   * Set when fail-fast terminated this step because a sibling in the same
   * parallel phase failed. The step did not fail on its own: `passed` is false
   * because it never finished, and the run's `failedStep` names the sibling.
   */
  stoppedByFailFast: z.boolean().optional(),

  /** Was this result retrieved from cache? (v0.15.0+) */
  isCachedResult: z.boolean().optional(),

  /** Output files from step execution (v0.15.1+) */
  outputFiles: OutputFilesSchema.optional(),
});

/**
 * Validation Phase Result Schema
 *
 * Field ordering optimized for LLM consumption:
 * - Phase identification (name)
 * - Status (passed)
 * - Duration (durationSecs)
 * - Step details (steps with extraction for failed steps)
 */
export const PhaseResultSchema = z.object({
  /** Phase name */
  name: z.string(),

  /** Did the phase pass? */
  passed: z.boolean(),

  /** Phase execution duration in seconds */
  durationSecs: z.coerce.number(),

  /** Results from individual steps */
  steps: z.array(StepResultSchema),
});

/**
 * Validation Result Schema
 *
 * Extends OperationMetadataSchema with validation-specific fields.
 *
 * This schema defines the validation result structure returned by the validation
 * runner and stored in git notes (v0.12.0+) for history tracking.
 *
 * Field ordering optimized for LLM consumption:
 * - Status first (passed, summary)
 * - Operation metadata (timestamp, treeHash)
 * - Cache indicator (isCachedResult) - v0.15.0+
 * - Quick navigation (failedStep)
 * - Detailed breakdown (phases with step-level extraction, each step has command)
 *
 * v0.15.0 BREAKING CHANGES:
 * - Removed rerunCommand (use phases[].steps[].command instead)
 * - Removed failedStepOutput (use phases[].steps[].extraction instead)
 * - Removed fullLogFile (use phases[].steps[].outputFiles instead)
 *
 * Note: Base schemas are permissive (strip unknown fields) for forward/backward
 * compatibility when reading from git notes. Use strict variants for validation
 * of freshly-produced results (prevents internal fields from leaking into public API).
 */
export const ValidationResultSchema = OperationMetadataSchema.extend({
  /** Did validation pass? */
  passed: z.boolean(),

  /** One-line summary for LLMs (e.g., "Validation passed" or "TypeScript type check failed") */
  summary: z.string().optional(),

  /** Was this entire validation result retrieved from cache? (v0.15.0+) */
  isCachedResult: z.boolean().optional(),

  /** Name of failed step (if any) - for quick navigation */
  failedStep: z.string().optional(),

  /** Results from each phase (steps include extraction for failures) */
  phases: z.array(PhaseResultSchema).optional(),

  /** Output files from validation run (only with --debug flag) */
  outputFiles: OutputFilesSchema.optional(),
});

/**
 * Strict Schema Variants
 *
 * These reject unknown properties and are used for validating freshly-produced
 * results (e.g., from the runner). This prevents internal fields like _fromCache
 * from leaking into the public API.
 *
 * The base schemas above are permissive (strip unknown fields) for reading
 * stored results from git notes, ensuring forward/backward compatibility.
 */
export const StepResultStrictSchema = StepResultSchema.strict();
export const PhaseResultStrictSchema = PhaseResultSchema
  .extend({ steps: z.array(StepResultStrictSchema) })
  .strict();
export const ValidationResultStrictSchema = ValidationResultSchema
  .extend({ phases: z.array(PhaseResultStrictSchema).optional() })
  .strict();

/**
 * Inferred TypeScript types from Zod schemas
 */
export type OutputFiles = z.infer<typeof OutputFilesSchema>;
export type StepResult = z.infer<typeof StepResultSchema>;
export type PhaseResult = z.infer<typeof PhaseResultSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/**
 * Did this step fail on its own?
 *
 * A step fail-fast stopped also has `passed: false`, but it is not a failure:
 * anything that picks "the failed step" from a result must use findFailedStepResult (or this),
 * never `!step.passed`, or it blames a sibling that was merely interrupted.
 */
export function isOwnStepFailure(step: { passed: boolean; stoppedByFailFast?: boolean }): boolean {
  return !step.passed && step.stoppedByFailFast !== true;
}

/**
 * The step a validation result blames — the one place that answers "which
 * step failed?" for a stored or parsed result.
 *
 * The run's `failedStep` is the authority, but a parallel phase lists step
 * results in completion order, and step names need not be unique across
 * phases, so the name only selects among steps that failed on their own.
 * Without a `failedStep`, the first such step is blamed.
 *
 * Results written before `stoppedByFailFast` existed cannot say which steps
 * fail-fast killed (their "Process stopped" summary also marked any real
 * failure that printed little), so for them `failedStep` is taken as written.
 *
 * @param accept - further narrows the candidates (e.g. "has an extraction")
 */
export function findFailedStepResult<S extends { name: string; passed: boolean; stoppedByFailFast?: boolean }>(
  result: { failedStep?: string; phases?: ReadonlyArray<{ steps: readonly S[] }> },
  accept: (step: S) => boolean
): S | undefined {
  const candidates = (result.phases ?? []).flatMap(phase => phase.steps).filter(step => isOwnStepFailure(step) && accept(step));
  return candidates.find(step => step.name === result.failedStep) ?? candidates[0];
}

/** A step read from untyped validation YAML (a CI log, nested output). */
export interface LooseStepResult {
  name: string;
  /** Only an explicit `passed: true` counts as passed */
  passed: boolean;
  stoppedByFailFast: boolean;
  /** The step as parsed, for fields the caller validates itself */
  raw: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read the phases of an untyped validation result for findFailedStepResult —
 * the one tolerant reader, so YAML no schema has checked never crashes a caller.
 * Anything that is not a list of phases with a list of step objects reads as empty.
 */
export function readLoosePhases(phases: unknown): Array<{ steps: LooseStepResult[] }> {
  if (!Array.isArray(phases)) {
    return [];
  }
  return phases.map(phase => {
    const steps = isRecord(phase) && Array.isArray(phase.steps) ? phase.steps.filter(isRecord) : [];
    return {
      steps: steps.map(step => ({
        name: typeof step.name === 'string' ? step.name : '',
        passed: step.passed === true,
        stoppedByFailFast: step.stoppedByFailFast === true,
        raw: step,
      })),
    };
  });
}

/**
 * Safe validation function (uses shared utility)
 */
export const safeValidateResult = createSafeValidator(ValidationResultSchema);

/**
 * Strict validation function (uses strict schema to reject unknown fields)
 */
export const validateResult = createStrictValidator(ValidationResultStrictSchema);
