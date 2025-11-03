/**
 * Zod Schema for Error Extractor Results
 *
 * This schema defines the structure of extractor output and enables
 * runtime validation and JSON Schema generation for documentation.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * Formatted Error Schema
 *
 * Structured error information extracted from validation output
 */
export const FormattedErrorSchema = z.object({
  /** File path where the error occurred */
  file: z.string().optional(),

  /** Line number (1-indexed) */
  line: z.number().int().positive().optional(),

  /** Column number (1-indexed) */
  column: z.number().int().positive().optional(),

  /** Error message */
  message: z.string(),

  /** Error code (e.g., TS2322, ESLint rule name) */
  code: z.string().optional(),

  /** Severity level */
  severity: z.enum(['error', 'warning']).optional(),

  /** Additional context (surrounding code, stack trace excerpt) */
  context: z.string().optional(),

  /** Guidance for fixing the error */
  guidance: z.string().optional(),
});

/**
 * Detection Metadata Schema
 *
 * Information about which extractor was selected and why
 */
export const DetectionMetadataSchema = z.object({
  /** Which extractor was used */
  extractor: z.string(),

  /** Confidence in detection (0-100) */
  confidence: z.number().min(0).max(100),

  /** Patterns that matched */
  patterns: z.array(z.string()),

  /** Why this extractor was chosen */
  reason: z.string(),
});

/**
 * Extraction Metadata Schema
 *
 * Quality information about the extraction process
 */
export const ExtractionMetadataSchema = z.object({
  /** Detection information (only included when developerFeedback: true) */
  detection: DetectionMetadataSchema.optional(),

  /** Extraction confidence (0-100) */
  confidence: z.number().min(0).max(100),

  /** Percentage of extracted errors with complete data (0-100) */
  completeness: z.number().min(0).max(100),

  /** Issues encountered during extraction */
  issues: z.array(z.string()),

  /** Suggestions for improvement (only included when developerFeedback: true) */
  suggestions: z.array(z.string()).optional(),
});

/**
 * Error Extractor Result Schema
 *
 * Complete result structure from error extraction operation
 */
export const ErrorExtractorResultSchema = z.object({
  /** Human-readable summary (e.g., "2 test failures", "5 type errors") */
  summary: z.string(),

  /** Total error count (may exceed errors.length if truncated) */
  totalCount: z.number().int().nonnegative(),

  /** Step-specific actionable guidance for fixing errors */
  guidance: z.string().optional(),

  /** Parsed and structured errors (limited to first 10 for token efficiency) */
  errors: z.array(FormattedErrorSchema),

  /** Extraction quality metadata (only included when developerFeedback: true) */
  metadata: ExtractionMetadataSchema.optional(),

  /**
   * Formatted error summary - LLM-optimized text view of errors (placed last for readability)
   *
   * When errors exist: Concise file:line:column - message format
   * When no errors: Keyword extraction from output (FAILED, Error, etc.)
   * ANSI codes stripped, limited to first 10-20 relevant lines
   * Provides 40x context window savings vs raw output
   */
  errorSummary: z.string(),
});

/**
 * Inferred TypeScript types from Zod schemas
 */
export type FormattedError = z.infer<typeof FormattedErrorSchema>;
export type DetectionMetadata = z.infer<typeof DetectionMetadataSchema>;
export type ExtractionMetadata = z.infer<typeof ExtractionMetadataSchema>;
export type ErrorExtractorResult = z.infer<typeof ErrorExtractorResultSchema>;

/**
 * Safe validation function for ErrorExtractorResult
 *
 * Validates an extractor result object against the schema without throwing.
 *
 * @param data - Data to validate
 * @returns Validation result with success/error information
 */
export function safeValidateExtractorResult(data: unknown):
  | { success: true; data: ErrorExtractorResult }
  | { success: false; errors: string[] } {
  const result = ErrorExtractorResultSchema.safeParse(data);

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
 * Strict validation function for ErrorExtractorResult
 *
 * Validates and throws on error.
 *
 * @param data - Data to validate
 * @returns Validated result
 * @throws {Error} If validation fails
 */
export function validateExtractorResult(data: unknown): ErrorExtractorResult {
  return ErrorExtractorResultSchema.parse(data);
}
