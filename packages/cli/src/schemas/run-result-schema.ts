/**
 * Zod Schema for Run Command Results
 *
 * This schema defines the structure of `vibe-validate run` output and enables
 * runtime validation and JSON Schema generation for documentation.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import {
  OperationMetadataSchema,
  CommandExecutionSchema,
  createSafeValidator,
  createStrictValidator
} from '@vibe-validate/core';

/**
 * Run Result Schema
 *
 * Extends OperationMetadataSchema + CommandExecutionSchema with run-specific fields.
 *
 * Output structure from `vibe-validate run` command execution.
 * This is the YAML written to stdout and cached in git notes.
 *
 * Field ordering is optimized for LLM consumption:
 * - Command execution (command, exitCode, durationSecs, extraction)
 * - Operation metadata (timestamp, treeHash)
 * - Run-specific (fullOutputFile, isCachedResult, suggestedDirectCommand)
 *
 * v0.15.0 changes:
 * - Now extends CommandExecutionSchema (consistent with StepResult)
 * - Added durationSecs field
 * - Deprecated suggestedDirectCommand (will be replaced by runCommand in future)
 */
export const RunResultSchema = OperationMetadataSchema
  .merge(CommandExecutionSchema)
  .extend({
    /** Path to full output log file (may not exist if old/cleaned up) */
    fullOutputFile: z.string().optional(),

    /** Whether this result is from cache (true) or fresh execution (false/omitted) */
    isCachedResult: z.boolean().optional(),

    /** Suggested direct command (when nested vibe-validate detected) - DEPRECATED: will be replaced by runCommand */
    suggestedDirectCommand: z.string().optional(),
  }).passthrough(); // Allow additional fields from nested YAML merging (e.g., phases)

/**
 * Inferred TypeScript type from Zod schema
 */
export type RunResult = z.infer<typeof RunResultSchema>;

/**
 * Safe validation function for RunResult (uses shared utility)
 *
 * @example
 * ```typescript
 * const result = safeValidateRunResult(parsedYaml);
 * if (result.success) {
 *   console.log('Valid run result:', result.data);
 * } else {
 *   console.error('Invalid data:', result.errors);
 * }
 * ```
 */
export const safeValidateRunResult = createSafeValidator(RunResultSchema);

/**
 * Strict validation function for RunResult (uses shared utility)
 *
 * @example
 * ```typescript
 * try {
 *   const result = validateRunResult(parsedYaml);
 *   // Use validated result
 * } catch (error) {
 *   console.error('Validation failed:', error);
 * }
 * ```
 */
export const validateRunResult = createStrictValidator(RunResultSchema);
