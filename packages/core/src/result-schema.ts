/**
 * Zod Schema for Validation Results
 *
 * This schema defines the structure of validation state files and enables
 * runtime validation and JSON Schema generation for documentation.
 */

import { z } from 'zod';
import { ErrorExtractorResultSchema } from '@vibe-validate/extractors';
import { createSafeValidator, createStrictValidator } from './schema-utils.js';

/**
 * Extraction Quality Schema (for developerFeedback mode)
 * @deprecated - Use extraction.metadata instead (v0.15.0+)
 */
export const ExtractionQualitySchema = z.object({
  /** Which tool was detected (e.g., "eslint", "typescript", "vitest") */
  detectedTool: z.string().optional(),

  /** Confidence level of detection */
  confidence: z.string().optional(),

  /** Quality score (0-100) */
  score: z.number().optional(),

  /** Number of warnings detected */
  warnings: z.number().optional(),

  /** Number of errors extracted */
  errorsExtracted: z.number().optional(),

  /** Whether the errors are actionable */
  actionable: z.boolean().optional(),
}).optional();

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
 * Base: Operation Metadata Schema
 *
 * Shared by top-level operations (RunResult, ValidationResult).
 * Every operation has:
 * - When it ran (timestamp)
 * - What code state (treeHash)
 */
export const OperationMetadataSchema = z.object({
  /** When the operation was executed (ISO 8601) */
  timestamp: z.string().datetime(),

  /** Git tree hash identifying the code state */
  treeHash: z.string().min(1),
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
 *
 * v0.15.0 changes:
 * - Now extends CommandExecutionSchema (adds command, exitCode)
 * - Removed extractionQuality (use extraction.metadata instead)
 * - Added isCachedResult to indicate when result came from cache
 * - Kept deprecated output and failedTests fields for backwards compatibility
 */
export const StepResultSchema = CommandExecutionSchema.extend({
  /** Step name */
  name: z.string(),

  /** Did the step pass? (derived from exitCode === 0) */
  passed: z.boolean(),

  /** Was this result retrieved from cache? (v0.15.0+) */
  isCachedResult: z.boolean().optional(),

  /** Output from the step (stdout + stderr) - DEPRECATED: use extraction instead */
  output: z.string().optional(),

  /** Extracted test failures (file:line - message) - DEPRECATED: use extraction.errors instead */
  failedTests: z.array(z.string()).optional(),
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
 * - Metadata last (fullLogFile)
 */
export const ValidationResultSchema = OperationMetadataSchema.extend({
  /** Did validation pass? */
  passed: z.boolean(),

  /** One-line summary for LLMs (e.g., "Validation passed" or "TypeScript type check failed") - Optional for backward compatibility with v0.14.x */
  summary: z.string().optional(),

  /** Was this entire validation result retrieved from cache? (v0.15.0+) */
  isCachedResult: z.boolean().optional(),

  /** Name of failed step (if any) - for quick navigation */
  failedStep: z.string().optional(),

  /** Results from each phase (steps include extraction for failures) */
  phases: z.array(PhaseResultSchema).optional(),

  /** Path to full log file */
  fullLogFile: z.string().optional(),
});

/**
 * Inferred TypeScript types from Zod schemas
 */
export type StepResult = z.infer<typeof StepResultSchema>;
export type PhaseResult = z.infer<typeof PhaseResultSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/**
 * Safe validation function (uses shared utility)
 */
export const safeValidateResult = createSafeValidator(ValidationResultSchema);

/**
 * Strict validation function (uses shared utility)
 */
export const validateResult = createStrictValidator(ValidationResultSchema);
