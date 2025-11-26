/**
 * Zod Schema for Error Extractor Results
 *
 * This schema defines the structure of extractor output and enables
 * runtime validation and JSON Schema generation for documentation.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { createSafeValidator, createStrictValidator } from '@vibe-validate/config';

/**
 * Maximum number of errors to include in errors array
 *
 * Limits token usage in LLM context window. Full count available in totalErrors field.
 */
export const MAX_ERRORS_IN_ARRAY = 10;

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
 *
 * Field ordering optimized for LLM consumption:
 * - Summary and count first (high-level overview)
 * - Structured errors (detailed breakdown)
 * - Guidance and errorSummary (actionable context)
 * - Metadata last (quality metrics)
 */
export const ErrorExtractorResultSchema = z.object({
  /** Human-readable summary (e.g., "2 test failures", "5 type errors") */
  summary: z.string(),

  /** Total error count (may exceed errors.length if truncated to MAX_ERRORS_IN_ARRAY) */
  totalErrors: z.number().int().nonnegative(),

  /** Parsed and structured errors (limited to MAX_ERRORS_IN_ARRAY for token efficiency) */
  errors: z.array(FormattedErrorSchema),

  /** Step-specific actionable guidance for fixing errors */
  guidance: z.string().optional(),

  /**
   * Formatted error summary - LLM-optimized text view of errors
   *
   * When errors exist: Concise file:line:column - message format
   * When no errors: Keyword extraction from output (FAILED, Error, etc.)
   * ANSI codes stripped, limited to first 10-20 relevant lines
   * Provides 40x context window savings vs raw output
   *
   * Optional - only included when it provides value beyond structured errors array
   */
  errorSummary: z.string().optional(),

  /** Extraction quality metadata (only included when developerFeedback: true) */
  metadata: ExtractionMetadataSchema.optional(),
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
 * @param data - Data to validate
 * @returns Validation result with success/error information
 */
export const safeValidateExtractorResult = createSafeValidator(ErrorExtractorResultSchema);

/**
 * Strict validation function for ErrorExtractorResult
 *
 * Validates and throws on error.
 *
 * @param data - Data to validate
 * @returns Validated result
 * @throws {Error} If validation fails
 */
export const validateExtractorResult = createStrictValidator(ErrorExtractorResultSchema);
