/**
 * Shared test helpers for error extractor plugins
 *
 * Eliminates duplication across extractor tests by providing common assertion
 * patterns for detection, extraction, metadata, and error object validation.
 *
 * @package @vibe-validate/extractors
 */

import { expect } from 'vitest';

import type { ErrorExtractorResult, ExtractorPlugin, FormattedError } from '../../types.js';

/**
 * Options for plugin metadata verification
 */
interface MetadataExpectation {
  /** Expected plugin name */
  name: string;
  /** Expected priority value */
  priority: number;
  /** Expected required hint patterns (must all be present) */
  requiredHints?: string[];
  /** Expected anyOf hint patterns (at least one must be present) */
  anyOfHints?: string[];
  /** Expected plugin tags */
  tags?: string[];
}

/**
 * Options for detection result verification
 */
interface DetectionExpectation {
  /** Expected confidence (exact value or min/max range) */
  confidence: number | { min?: number; max?: number };
  /** Expected pattern descriptions that should appear in result.patterns */
  patterns?: string[];
  /** Expected substring in detection reason */
  reasonContains?: string;
}

/**
 * Options for extraction result verification
 */
interface ExtractionExpectation {
  /** Expected number of errors */
  errorCount: number;
  /** Expected summary (exact string or regex pattern) */
  summaryPattern?: string | RegExp;
  /** Expected substrings in guidance (all must be present) */
  guidanceContains?: string[];
  /** Expected substrings in errorSummary (all must be present) */
  errorSummaryContains?: string[];
}

/**
 * Options for individual error object verification
 */
interface ErrorExpectation {
  /** Expected file path */
  file?: string;
  /** Expected line number */
  line?: number;
  /** Expected column number */
  column?: number;
  /** Expected substring(s) in error message (all must be present) */
  messageContains?: string | string[];
  /** Expected severity level */
  severity?: 'error' | 'warning';
  /** Expected error code */
  code?: string;
}

/**
 * Verify plugin metadata matches expected values
 *
 * Reduces duplication in plugin metadata tests by consolidating common
 * assertions for name, priority, hints, and tags.
 *
 * @param plugin - The extractor plugin to test
 * @param expected - Expected metadata values
 *
 * @example
 * ```typescript
 * expectPluginMetadata(vitestPlugin, {
 *   name: 'vitest',
 *   priority: 85,
 *   requiredHints: [],
 *   anyOfHints: ['FAIL', 'test.ts', '❯'],
 * });
 * ```
 */
export function expectPluginMetadata(plugin: ExtractorPlugin, expected: MetadataExpectation): void {
  expect(plugin.metadata.name).toBe(expected.name);
  expect(plugin.priority).toBe(expected.priority);

  if (expected.requiredHints !== undefined) {
    if (expected.requiredHints.length === 0) {
      expect(plugin.hints?.required ?? []).toEqual([]);
    } else {
      for (const hint of expected.requiredHints) {
        expect(plugin.hints?.required).toContain(hint);
      }
    }
  }

  if (expected.anyOfHints !== undefined) {
    for (const hint of expected.anyOfHints) {
      expect(plugin.hints?.anyOf).toContain(hint);
    }
  }

  if (expected.tags !== undefined) {
    for (const tag of expected.tags) {
      expect(plugin.metadata.tags).toContain(tag);
    }
  }
}

/**
 * Verify detection result matches expected confidence and patterns
 *
 * Reduces duplication in detect() tests by consolidating confidence checks,
 * pattern verification, and reason validation.
 *
 * @param plugin - The extractor plugin
 * @param output - Test output string to detect
 * @param expected - Expected detection results
 *
 * @example
 * ```typescript
 * // Exact confidence
 * expectDetection(vitestPlugin, sampleOutput, {
 *   confidence: 90,
 *   patterns: ['Vitest', 'test failure marker'],
 *   reasonContains: 'Vitest'
 * });
 *
 * // Confidence range
 * expectDetection(vitestPlugin, sampleOutput, {
 *   confidence: { min: 70, max: 95 },
 *   reasonContains: 'Vitest'
 * });
 *
 * // No detection
 * expectDetection(vitestPlugin, 'random text', {
 *   confidence: 0
 * });
 * ```
 */
export function expectDetection(
  plugin: ExtractorPlugin,
  output: string,
  expected: DetectionExpectation
): void {
  const result = plugin.detect(output);

  // Check confidence (exact value or range)
  if (typeof expected.confidence === 'number') {
    expect(result.confidence).toBe(expected.confidence);
  } else {
    if (expected.confidence.min !== undefined) {
      expect(result.confidence).toBeGreaterThanOrEqual(expected.confidence.min);
    }
    if (expected.confidence.max !== undefined) {
      expect(result.confidence).toBeLessThanOrEqual(expected.confidence.max);
    }
  }

  // Check patterns
  if (expected.patterns !== undefined) {
    for (const pattern of expected.patterns) {
      expect(result.patterns).toContain(pattern);
    }
  }

  // Check reason
  if (expected.reasonContains !== undefined) {
    expect(result.reason).toContain(expected.reasonContains);
  }
}

/**
 * Verify extraction result structure matches expected values
 *
 * Reduces duplication in extract() tests by consolidating common assertions
 * for error count, summary, guidance, and errorSummary.
 *
 * @param result - Extract result to verify
 * @param expected - Expected result structure
 *
 * @example
 * ```typescript
 * const result = extract(output);
 * expectExtractionResult(result, {
 *   errorCount: 3,
 *   summaryPattern: '3 test failure(s)',
 *   guidanceContains: ['Fix each failing test'],
 *   errorSummaryContains: ['Test 1/3']
 * });
 *
 * // With regex
 * expectExtractionResult(result, {
 *   errorCount: 5,
 *   summaryPattern: /5 (test|error)/,
 * });
 * ```
 */
export function expectExtractionResult(
  result: ErrorExtractorResult,
  expected: ExtractionExpectation
): void {
  expect(result.errors).toHaveLength(expected.errorCount);
  expect(result.totalErrors).toBe(expected.errorCount);

  if (expected.summaryPattern !== undefined) {
    if (typeof expected.summaryPattern === 'string') {
      expect(result.summary).toBe(expected.summaryPattern);
    } else {
      expect(result.summary).toMatch(expected.summaryPattern);
    }
  }

  if (expected.guidanceContains !== undefined) {
    for (const text of expected.guidanceContains) {
      expect(result.guidance).toContain(text);
    }
  }

  if (expected.errorSummaryContains !== undefined) {
    for (const text of expected.errorSummaryContains) {
      expect(result.errorSummary).toContain(text);
    }
  }
}

/**
 * Verify empty or no-match output behavior
 *
 * Reduces duplication in edge case tests by consolidating assertions for
 * empty string and non-matching output scenarios.
 *
 * @param extractFn - Extract function to test
 * @param expectedSummary - Expected summary for empty/no-match cases (string or regex)
 *
 * @example
 * ```typescript
 * expectEmptyExtraction(vitestPlugin.extract, '0 test failure(s)');
 * expectEmptyExtraction(eslintPlugin.extract, '0 ESLint error(s), 0 warning(s)');
 * expectEmptyExtraction(junitPlugin.extract, /0 test.*failed/);
 * ```
 */
export function expectEmptyExtraction(
  extractFn: (_output: string) => ErrorExtractorResult,
  expectedSummary: string | RegExp
): void {
  const result = extractFn('');

  expect(result.errors).toHaveLength(0);
  expect(result.totalErrors).toBe(0);

  if (typeof expectedSummary === 'string') {
    expect(result.summary).toBe(expectedSummary);
  } else {
    expect(result.summary).toMatch(expectedSummary);
  }
}

/**
 * Verify individual error object fields match expected values
 *
 * Reduces duplication in error validation tests by consolidating assertions
 * for file, line, column, message, severity, and code fields.
 *
 * @param error - The error object to verify
 * @param expected - Expected field values
 *
 * @example
 * ```typescript
 * // Basic fields
 * expectErrorObject(result.errors[0], {
 *   file: 'test/example.test.ts',
 *   line: 57,
 *   column: 30,
 *   messageContains: 'expected 3000 to be 9999'
 * });
 *
 * // Multiple message fragments
 * expectErrorObject(result.errors[0], {
 *   file: 'src/index.ts',
 *   line: 42,
 *   messageContains: ['Type error', 'not assignable'],
 *   severity: 'error',
 *   code: 'TS2322'
 * });
 * ```
 */
export function expectErrorObject(error: FormattedError, expected: ErrorExpectation): void {
  if (expected.file !== undefined) {
    expect(error.file).toBe(expected.file);
  }

  if (expected.line !== undefined) {
    expect(error.line).toBe(expected.line);
  }

  if (expected.column !== undefined) {
    expect(error.column).toBe(expected.column);
  }

  if (expected.messageContains !== undefined) {
    const messages = Array.isArray(expected.messageContains)
      ? expected.messageContains
      : [expected.messageContains];

    for (const msg of messages) {
      expect(error.message).toContain(msg);
    }
  }

  if (expected.severity !== undefined) {
    expect(error.severity).toBe(expected.severity);
  }

  if (expected.code !== undefined) {
    expect(error.code).toBe(expected.code);
  }
}
