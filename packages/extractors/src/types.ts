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
  /** File path where the error occurred (undefined if location cannot be determined) */
  file?: string;

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

  /** Guidance for fixing the error */
  guidance?: string;
}

/**
 * Metadata about extraction quality (what the extractor knows about its own extraction)
 *
 * Note: Extractor doesn't know expected count - test infrastructure compares against ground truth
 */
export interface ExtractionMetadata {
  /** Extraction confidence (0-100) based on pattern match quality */
  confidence: number;

  /** Percentage of extracted errors with complete data (file + line + message) */
  completeness: number;

  /** Issues encountered during extraction (e.g., "ambiguous patterns", "missing line numbers") */
  issues: string[];

  /** Suggestions for improving extraction quality (only included when developerFeedback: true) */
  suggestions?: string[];
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

  /** Extraction quality metadata (only included when developerFeedback: true) */
  metadata?: ExtractionMetadata;
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
