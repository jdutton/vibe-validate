/**
 * Shared utilities for test framework extractors
 *
 * Common logic for processing test failures across different frameworks
 * (Jasmine, Mocha, AVA, TAP, etc.)
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, FormattedError, ExtractionMetadata } from '../types.js';

import { formatCleanOutput } from './formatter-utils.js';
import { generateGuidanceFromPatterns } from './guidance-generator.js';

/**
 * Common failure information structure across test frameworks
 */
export interface TestFailureInfo {
  file?: string;
  line?: number;
  message?: string;
  testName?: string;
  errorType?: string;
}

/**
 * Process test failures into structured error results
 *
 * This function encapsulates the common logic shared across test framework extractors:
 * - Converts parsed failures to FormattedError objects
 * - Generates summaries and guidance
 * - Calculates quality metadata (completeness, confidence)
 *
 * @param failures - Array of parsed failure information
 * @param frameworkConfidence - Framework-specific confidence score (0-100)
 * @returns Structured error extraction result
 *
 * @example
 * ```typescript
 * const failures = extractMochaFailures(output);
 * return processTestFailures(failures, 95); // 95% confidence for Mocha
 * ```
 */
export function processTestFailures(
  failures: TestFailureInfo[],
  frameworkConfidence: number = 95
): ErrorExtractorResult {
  // Handle no failures case
  if (failures.length === 0) {
    return {
      summary: '0 test(s) failed',
      errors: [],
      totalErrors: 0,
      errorSummary: '',
      guidance: '',
      metadata: {
        confidence: 100,
        completeness: 100,
        issues: []
      }
    };
  }

  // Convert failures to formatted errors
  const errors: FormattedError[] = [];
  let completeCount = 0;

  for (const failure of failures) {
    const file = failure.file ?? 'unknown';
    const message = failure.message ?? 'Test failed';
    const context = failure.testName ?? '';

    const isComplete = file !== 'unknown' && failure.line && message;
    if (isComplete) {
      completeCount++;
    }

    errors.push({
      file,
      line: failure.line,
      message,
      context
    });
  }

  // Generate summary
  const summary = `${failures.length} test(s) failed`;

  // Generate guidance
  const guidance = generateGuidanceFromPatterns(failures);

  // Calculate quality metadata
  const completeness = (completeCount / failures.length) * 100;
  const confidence = frameworkConfidence;

  const metadata: ExtractionMetadata = {
    confidence,
    completeness,
    issues: []
  };

  return {
    summary,
    errors,
    totalErrors: failures.length,
    errorSummary: formatCleanOutput(errors),
    guidance,
    metadata
  };
}
