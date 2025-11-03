/**
 * Zod Schema for Run Command Results
 *
 * This schema defines the structure of `vibe-validate run` output and enables
 * runtime validation and JSON Schema generation for documentation.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { ErrorExtractorResultSchema } from '@vibe-validate/extractors';

/**
 * Run Result Schema
 *
 * Output structure from `vibe-validate run` command execution.
 * This is the YAML written to stdout and cached in git notes.
 */
export const RunResultSchema = z.object({
  /** Command that was executed */
  command: z.string().min(1),

  /** Exit code from the command */
  exitCode: z.number().int(),

  /** When the command was executed (ISO 8601) - for cache age awareness */
  timestamp: z.string().datetime(),

  /** Path to full output log file (may not exist if old/cleaned up) */
  fullOutputFile: z.string().optional(),

  /** Whether this result is from cache (true) or fresh execution (false/omitted) */
  isCachedResult: z.boolean().optional(),

  /** Suggested direct command (when nested vibe-validate detected) */
  suggestedDirectCommand: z.string().optional(),

  /** Extracted error information (LLM-optimized) - placed last for readability */
  extraction: ErrorExtractorResultSchema,
}).passthrough(); // Allow additional fields from nested YAML merging (e.g., phases, treeHash)

/**
 * Inferred TypeScript type from Zod schema
 */
export type RunResult = z.infer<typeof RunResultSchema>;

/**
 * Safe validation function for RunResult
 *
 * Validates a run result object against the schema without throwing.
 *
 * @param data - Data to validate
 * @returns Validation result with success/error information
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
export function safeValidateRunResult(data: unknown):
  | { success: true; data: RunResult }
  | { success: false; errors: string[] } {
  const result = RunResultSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Extract error messages
  const errors = result.error.errors.map(err => {
    const path = err.path.join('.');
    return path ? `${path}: ${err.message}` : err.message;
  });

  return { success: false, errors };
}

/**
 * Strict validation function for RunResult
 *
 * Validates and throws on error.
 *
 * @param data - Data to validate
 * @returns Validated result
 * @throws {Error} If validation fails
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
export function validateRunResult(data: unknown): RunResult {
  return RunResultSchema.parse(data);
}
