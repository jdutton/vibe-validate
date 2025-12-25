/**
 * Shared test helper for MAX_ERRORS_IN_ARRAY truncation behavior
 *
 * Eliminates duplication across extractor tests that verify error array truncation.
 *
 * @package @vibe-validate/extractors
 */

import { expect } from 'vitest';

import type { ErrorExtractorResult } from '../../types.js';

/**
 * Options for MAX_ERRORS_IN_ARRAY truncation assertion
 */
interface MaxErrorsOptions {
  /** Expected totalErrors count (e.g., 15) */
  totalCount: number;
  /** Expected value for first error (file or message content) */
  firstError: string;
  /** Expected value for last kept error at index 9 (file or message content) */
  lastTruncatedError: string;
  /** Regex or string to match in summary (e.g., "15 test failure(s)") */
  summaryPattern: string | RegExp;
  /** Field to check ('file' or 'message'). Defaults to 'file' */
  checkField?: 'file' | 'message';
  /** For 'message' field, use contains check instead of exact match */
  messageContains?: boolean;
}

/**
 * Assert MAX_ERRORS_IN_ARRAY truncation behavior
 *
 * Verifies that extractors correctly:
 * 1. Preserve full error count in totalErrors
 * 2. Truncate errors array to MAX_ERRORS_IN_ARRAY
 * 3. Return first N errors in order
 * 4. Include full count in summary
 *
 * @param result - Extraction result to verify
 * @param options - Assertion options
 *
 * @example
 * ```typescript
 * // Check file field (default)
 * const result = extract(fifteenErrors);
 * await expectMaxErrorsTruncation(result, {
 *   totalCount: 15,
 *   firstError: 'file1.ts',
 *   lastTruncatedError: 'file10.ts',
 *   summaryPattern: '15 test failure(s)'
 * });
 *
 * // Check message field with contains
 * await expectMaxErrorsTruncation(result, {
 *   totalCount: 15,
 *   firstError: 'test 1',
 *   lastTruncatedError: 'test 10',
 *   summaryPattern: /15 test/,
 *   checkField: 'message',
 *   messageContains: true
 * });
 * ```
 */
export async function expectMaxErrorsTruncation(
  result: ErrorExtractorResult,
  options: MaxErrorsOptions
): Promise<void> {
  const { totalCount, firstError, lastTruncatedError, summaryPattern, checkField = 'file', messageContains = false } = options;

  // Import MAX_ERRORS_IN_ARRAY to verify we're testing the right value
  const { MAX_ERRORS_IN_ARRAY } = await import('../../result-schema.js');

  // totalErrors should preserve full count
  expect(result.totalErrors).toBe(totalCount);

  // errors array should be truncated to MAX_ERRORS_IN_ARRAY
  expect(result.errors).toHaveLength(MAX_ERRORS_IN_ARRAY);
  expect(result.errors).toHaveLength(10); // Explicit check for documentation

  // Verify we got the first N errors (in order)
  if (checkField === 'file') {
    expect(result.errors[0].file).toBe(firstError);
    expect(result.errors[9].file).toBe(lastTruncatedError);
  } else {
    // Check message field
    if (messageContains) {
      expect(result.errors[0].message).toContain(firstError);
      expect(result.errors[9].message).toContain(lastTruncatedError);
    } else {
      expect(result.errors[0].message).toBe(firstError);
      expect(result.errors[9].message).toBe(lastTruncatedError);
    }
  }

  // Summary should show full count
  if (typeof summaryPattern === 'string') {
    expect(result.summary).toBe(summaryPattern);
  } else {
    expect(result.summary).toMatch(summaryPattern);
  }
}
