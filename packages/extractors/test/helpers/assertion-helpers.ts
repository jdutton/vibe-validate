/**
 * Assertion Helpers - Shared utilities for extractor test assertions
 *
 * Eliminates duplication of assertion patterns in smart-extractor tests.
 */

import type { ErrorExtractorResult } from '../../src/types.js';
import { expect } from 'vitest';

/**
 * Assert that an extractor was detected correctly
 *
 * @param result - Extraction result
 * @param expectedExtractor - Expected extractor name
 * @param expectedPatterns - Expected detected patterns (optional)
 */
export function expectExtractorDetection(
  result: ErrorExtractorResult,
  expectedExtractor: string,
  expectedPatterns?: string[]
): void {
  expect(result.metadata?.detection?.extractor).toBe(expectedExtractor);

  if (expectedPatterns) {
    for (const pattern of expectedPatterns) {
      expect(result.metadata?.detection?.patterns).toContain(pattern);
    }
  }
}

/**
 * Assert extraction result quality
 *
 * @param result - Extraction result
 * @param expectations - Quality expectations
 */
export function expectExtractionQuality(
  result: ErrorExtractorResult,
  expectations: {
    minErrors?: number;
    maxErrors?: number;
    minConfidence?: number;
    hasSummary?: boolean;
    hasGuidance?: boolean;
  }
): void {
  if (expectations.minErrors !== undefined) {
    expect(result.errors.length).toBeGreaterThanOrEqual(expectations.minErrors);
  }

  if (expectations.maxErrors !== undefined) {
    expect(result.errors.length).toBeLessThanOrEqual(expectations.maxErrors);
  }

  if (expectations.minConfidence !== undefined) {
    expect(result.metadata?.confidence).toBeGreaterThanOrEqual(expectations.minConfidence);
  }

  if (expectations.hasSummary) {
    expect(result.summary).toBeDefined();
    expect(result.summary.length).toBeGreaterThan(0);
  }

  if (expectations.hasGuidance) {
    expect(result.guidance).toBeDefined();
    expect(result.guidance.length).toBeGreaterThan(0);
  }
}

/**
 * Assert detection metadata is complete
 *
 * @param result - Extraction result
 */
export function expectCompleteDetectionMetadata(result: ErrorExtractorResult): void {
  expect(result.metadata?.detection).toBeDefined();
  expect(result.metadata?.detection?.extractor).toBeDefined();
  expect(result.metadata?.detection?.confidence).toBeGreaterThan(0);
  expect(result.metadata?.detection?.confidence).toBeLessThanOrEqual(100);
  expect(result.metadata?.detection?.patterns).toBeDefined();
  expect(result.metadata?.detection?.patterns.length).toBeGreaterThan(0);
  expect(result.metadata?.detection?.reason).toBeDefined();
}
