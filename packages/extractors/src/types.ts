/**
 * Error Extractor Types
 *
 * Type definitions for LLM-optimized error extraction.
 *
 * @package @vibe-validate/extractors
 */

/**
 * Structured error information extracted from validation output
 */
export interface FormattedError {
  /** File path where the error occurred */
  file: string;

  /** Line number (1-indexed) */
  line?: number;

  /** Column number (1-indexed) */
  column?: number;

  /** Error message */
  message: string;

  /** Error code (e.g., TS2322, ESLint rule name) */
  code?: string;

  /** Severity level */
  severity?: 'error' | 'warning';

  /** Additional context (surrounding code, stack trace excerpt) */
  context?: string;
}

/**
 * Result of error extraction operation
 */
export interface ErrorExtractorResult {
  /** Parsed and structured errors (limited to first 10 for token efficiency) */
  errors: FormattedError[];

  /** Human-readable summary (e.g., "3 type errors, 2 warnings") */
  summary: string;

  /** Total error count (may exceed errors.length if truncated) */
  totalCount: number;

  /** Step-specific actionable guidance for fixing errors */
  guidance?: string;

  /** Clean, formatted output for YAML/JSON embedding */
  cleanOutput: string;
}

/**
 * Error extractor interface for specific tool/format
 */
export interface ErrorExtractor {
  /**
   * Format tool-specific error output into structured result
   *
   * @param _output - Raw command output (may include ANSI codes, noise)
   * @returns Structured error information optimized for LLM consumption
   */
  format(_output: string): ErrorExtractorResult;
}
