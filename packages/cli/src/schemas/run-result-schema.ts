/**
 * Zod Schema for Run Command Results
 *
 * This schema defines the structure of `vibe-validate run` output and enables
 * runtime validation and JSON Schema generation for documentation.
 *
 * @packageDocumentation
 */

import {
  OperationMetadataSchema,
  CommandExecutionSchema,
  OutputFilesSchema,
  createSafeValidator,
  createStrictValidator
} from '@vibe-validate/core';
import { z } from 'zod';

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
 * - Run-specific (outputFiles, isCachedResult, suggestedDirectCommand)
 *
 * v0.15.0 BREAKING CHANGES:
 * - Now extends CommandExecutionSchema (consistent with StepResult)
 * - Added durationSecs field
 * - Added outputFiles with organized temp structure (stdout.log, stderr.log, combined.jsonl)
 * - REMOVED fullOutputFile (use outputFiles.combined instead)
 * - REMOVED suggestedDirectCommand (command now contains unwrapped command)
 */
export const RunResultSchema = OperationMetadataSchema
  .merge(CommandExecutionSchema)
  .extend({
    /** Organized output files (v0.15.0+) */
    outputFiles: OutputFilesSchema.optional(),

    /** Whether this result is from cache (true) or fresh execution (false/omitted) */
    isCachedResult: z.boolean().optional(),

    /**
     * The original command requested by the user (v0.17.3+)
     *
     * Only present when the actual executed command differs from what was requested.
     * This happens when nested vibe-validate commands are detected and unwrapped.
     *
     * Example: User runs `vv run "vv run 'echo test'"`, which executes `echo test`.
     * - command: "echo test" (what actually executed)
     * - requestedCommand: "vv run 'echo test'" (what user requested)
     */
    requestedCommand: z.string().optional(),
  }).passthrough(); // Allow additional fields from nested YAML merging (e.g., phases)

/**
 * Inferred TypeScript types from Zod schemas
 */
export type { OutputFiles } from '@vibe-validate/core';
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
