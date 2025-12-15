/**
 * Shared test helpers for extractor tests
 *
 * Provides utilities to validate extractor output invariants
 */

import { expect } from 'vitest';

import type { ErrorExtractorResult } from '../src/types.js';

/**
 * Validate data integrity of extractor result
 *
 * Ensures critical invariants:
 * - totalErrors === errors.length (data consistency)
 * - errors array is properly structured
 * - summary and guidance are consistent with error state
 *
 * Usage in tests:
 * ```typescript
 * const result = extractVitestErrors(output);
 * expectValidExtractorResult(result);
 * ```
 *
 * @param result - Extractor result to validate
 */
export function expectValidExtractorResult(result: ErrorExtractorResult): void {
  // CRITICAL INVARIANT: totalErrors must always equal errors.length
  expect(
    result.totalErrors,
    `totalErrors (${result.totalErrors}) must equal errors.length (${result.errors.length})`
  ).toBe(result.errors.length);

  // Validate errors array structure
  expect(result.errors).toBeInstanceOf(Array);

  // Validate each error object has required fields
  for (const error of result.errors) {
    expect(error).toHaveProperty('message');
    expect(typeof error.message).toBe('string');
    expect(error.message.length).toBeGreaterThan(0);

    // file is optional, but if present must be a string
    if (error.file !== undefined) {
      expect(typeof error.file).toBe('string');
    }

    // line is optional, but if present must be a number
    if (error.line !== undefined) {
      expect(typeof error.line).toBe('number');
      expect(error.line).toBeGreaterThan(0);
    }

    // column is optional, but if present must be a number
    if (error.column !== undefined) {
      expect(typeof error.column).toBe('number');
      expect(error.column).toBeGreaterThan(0);
    }
  }

  // Validate summary field
  expect(result.summary).toBeDefined();
  expect(typeof result.summary).toBe('string');

  // Validate guidance field
  expect(result.guidance).toBeDefined();
  expect(typeof result.guidance).toBe('string');

  // Validate errorSummary field
  expect(result.errorSummary).toBeDefined();
  expect(typeof result.errorSummary).toBe('string');

  // Consistency checks
  if (result.totalErrors === 0) {
    // No errors detected
    expect(result.errors).toEqual([]);
  }

  if (result.totalErrors > 0) {
    // Errors detected - errorSummary should have content
    expect(result.errorSummary.trim().length).toBeGreaterThan(0);
  }
}

/**
 * Quick helper to validate and check error count
 *
 * Combines invariant validation with error count assertion.
 *
 * Usage:
 * ```typescript
 * const result = extractVitestErrors(output);
 * expectValidExtractorResultWithCount(result, 3); // Expects exactly 3 errors
 * ```
 *
 * @param result - Extractor result to validate
 * @param expectedCount - Expected number of errors
 */
export function expectValidExtractorResultWithCount(
  result: ErrorExtractorResult,
  expectedCount: number
): void {
  expectValidExtractorResult(result);
  expect(result.totalErrors).toBe(expectedCount);
  expect(result.errors).toHaveLength(expectedCount);
}
