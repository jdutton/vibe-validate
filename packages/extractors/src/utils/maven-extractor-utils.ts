/**
 * Shared utility functions for Maven extractors
 *
 * These utilities eliminate duplication across maven-compiler, maven-surefire, and maven-checkstyle extractors.
 */

import type { DetectionResult, ErrorExtractorResult, ExtractionMetadata } from '../types.js';

/**
 * Create a low-confidence result when detection confidence is below threshold
 *
 * All Maven extractors return early with this structure when confidence < 40
 */
export function createLowConfidenceResult(
  extractorName: string,
  detection: DetectionResult
): ErrorExtractorResult {
  return {
    summary: `Not Maven ${extractorName} output`,
    totalErrors: 0,
    errors: [],
    metadata: {
      detection: {
        extractor: extractorName,
        confidence: detection.confidence,
        patterns: detection.patterns,
        reason: detection.reason,
      },
      confidence: detection.confidence,
      completeness: 100,
      issues: [],
    },
  };
}

/**
 * Create final result with detection metadata
 *
 * Used by maven-compiler and maven-checkstyle for final result construction
 */
export function createMavenResult(
  extractorName: string,
  detection: DetectionResult,
  summary: string,
  errors: Array<{
    file?: string;
    line?: number;
    column?: number;
    message: string;
    context?: string;
    guidance?: string;
  }>,
  totalErrors: number,
  guidance: string | undefined,
  errorSummary: string | undefined
): ErrorExtractorResult {
  const metadata: ExtractionMetadata = {
    detection: {
      extractor: extractorName,
      confidence: detection.confidence,
      patterns: detection.patterns,
      reason: detection.reason,
    },
    confidence: 100,
    completeness: 100,
    issues: [],
  };

  return {
    summary,
    totalErrors,
    errors,
    guidance,
    errorSummary,
    metadata,
  };
}
