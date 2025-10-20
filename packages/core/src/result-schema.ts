/**
 * Zod Schema for Validation Results
 *
 * This schema defines the structure of validation state files and enables
 * runtime validation and JSON Schema generation for documentation.
 */

import { z } from 'zod';

/**
 * Validation Step Result Schema
 */
export const StepResultSchema = z.object({
  /** Step name */
  name: z.string(),

  /** Did the step pass? */
  passed: z.boolean(),

  /** Execution duration in seconds */
  durationSecs: z.number(),

  /** Output from the step (stdout + stderr) */
  output: z.string().optional(),
});

/**
 * Validation Phase Result Schema
 */
export const PhaseResultSchema = z.object({
  /** Phase name */
  name: z.string(),

  /** Phase execution duration in seconds */
  durationSecs: z.number(),

  /** Did the phase pass? */
  passed: z.boolean(),

  /** Results from individual steps */
  steps: z.array(StepResultSchema),

  /** Output from failed step (if any) */
  output: z.string().optional(),
});

/**
 * Validation Result Schema
 *
 * This is the complete schema for the validation state file
 * (.vibe-validate-state.yaml)
 */
export const ValidationResultSchema = z.object({
  /** Did validation pass? */
  passed: z.boolean(),

  /** ISO 8601 timestamp */
  timestamp: z.string(),

  /** Git tree hash (if in git repo) */
  treeHash: z.string(),

  /** Results from each phase */
  phases: z.array(PhaseResultSchema).optional(),

  /** Name of failed step (if any) */
  failedStep: z.string().optional(),

  /** Command to re-run failed step */
  rerunCommand: z.string().optional(),

  /** Output from the failed step */
  failedStepOutput: z.string().optional(),

  /** Failed test names (if applicable) */
  failedTests: z.array(z.string()).optional(),

  /** Path to full log file */
  fullLogFile: z.string().optional(),

  /** Summary message */
  summary: z.string().optional(),
});

/**
 * Inferred TypeScript types from Zod schemas
 */
export type StepResult = z.infer<typeof StepResultSchema>;
export type PhaseResult = z.infer<typeof PhaseResultSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/**
 * Safe validation function
 *
 * Validates a validation result object against the schema.
 *
 * @param data - Data to validate
 * @returns Validation result with success/error information
 */
export function safeValidateResult(data: unknown):
  | { success: true; data: ValidationResult }
  | { success: false; errors: string[] } {
  const result = ValidationResultSchema.safeParse(data);

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
 * Strict validation function
 *
 * Validates and throws on error.
 *
 * @param data - Data to validate
 * @returns Validated result
 * @throws {Error} If validation fails
 */
export function validateResult(data: unknown): ValidationResult {
  return ValidationResultSchema.parse(data);
}
