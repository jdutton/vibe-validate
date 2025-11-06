/**
 * Error Extractor Types
 *
 * Type definitions for LLM-optimized error extraction.
 *
 * NOTE: These types are now derived from Zod schemas in result-schema.ts
 * This file re-exports them for backward compatibility.
 *
 * @package @vibe-validate/extractors
 */

// Import type for use in this file
import type { ErrorExtractorResult as ExtractorResult } from './result-schema.js';

// Re-export types from Zod schemas for backward compatibility
export type {
  FormattedError,
  DetectionMetadata,
  ExtractionMetadata,
  ErrorExtractorResult,
} from './result-schema.js';

/**
 * Input for error extraction with separated streams
 *
 * Allows extractors to choose the most appropriate stream(s) for extraction:
 * - stdout: Standard output (clean, structured data)
 * - stderr: Error output (warnings, errors, debug info)
 * - combined: Chronological mix (for context-dependent extraction)
 */
export interface ExtractorInput {
  /** Raw stdout output */
  stdout: string;
  /** Raw stderr output */
  stderr: string;
  /** Combined chronological output (stdout + stderr) */
  combined: string;
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
  format(_output: string): ExtractorResult;
}
