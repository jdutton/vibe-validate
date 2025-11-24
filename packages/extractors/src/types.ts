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

/**
 * Detection result from pattern matching
 */
export interface DetectionResult {
  /** Confidence level (0-100) - higher means more certain */
  confidence: number;
  /** Patterns that matched in the output */
  patterns: string[];
  /** Human-readable explanation of detection */
  reason: string;
}

/**
 * Fast filtering hints for efficient multi-extractor detection
 * Uses simple string.includes() checks (no regex) for O(M) single-pass filtering
 */
export interface ExtractorHints {
  /** Required keywords - all must be present */
  required?: string[];
  /** Any-of keywords - at least one must be present */
  anyOf?: string[];
  /** Forbidden keywords - if present, skip this extractor */
  forbidden?: string[];
}

/**
 * Sample test data for extractor validation
 */
export interface ExtractorSample {
  /** Unique name for this sample */
  name: string;
  /** Human-readable description */
  description: string;
  /** Inline sample data OR */
  input?: string;
  /** Path to sample file (relative to extractor directory) */
  inputFile?: string;
  /** Expected extraction result (partial match) */
  expected?: Partial<ExtractorResult>;
  /** Expected number of errors (simplified validation) */
  expectedErrors?: number;
  /** Expected patterns in output (simplified validation) */
  expectedPatterns?: string[];
}

/**
 * Extractor plugin metadata
 */
export interface ExtractorMetadata {
  /** Unique name identifying this extractor (source of truth for registration) */
  name: string;
  /** Semantic version */
  version: string;
  /** Author name and email */
  author?: string;
  /** Human-readable description */
  description: string;
  /** Repository URL */
  repository?: string;
  /** Tags for discovery and categorization */
  tags?: string[];
}

/**
 * Complete extractor plugin interface
 *
 * This is the unified interface for all extractors (built-in and external plugins).
 */
export interface ExtractorPlugin {
  /** Plugin metadata (source of truth for name/version) */
  metadata: ExtractorMetadata;

  /** Fast filtering hints for efficient detection */
  hints?: ExtractorHints;

  /** Priority for detection order (higher = check first) */
  priority: number;

  /**
   * Detection function - determines if this extractor can handle the output
   * Only called if hints match (or no hints provided)
   *
   * @param _output - Raw command output
   * @returns Detection result with confidence score
   */
  detect(_output: string): DetectionResult;

  /**
   * Extraction function - parses errors from output
   * Only called if detect() returns confidence >= threshold
   *
   * @param _output - Raw command output
   * @param _command - Optional command that produced output (for guidance)
   * @returns Structured error information
   */
  extract(_output: string, _command?: string): ExtractorResult;

  /**
   * Sample test data (REQUIRED for contributions)
   * Used to auto-generate tests and validate extractor functionality
   */
  samples: ExtractorSample[];
}
