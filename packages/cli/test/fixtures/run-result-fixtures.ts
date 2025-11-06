/**
 * Test fixtures for RunResult objects
 *
 * Provides factory functions to create test data for run command results,
 * reducing duplication across test files.
 */

import type {
  RunResult,
  ExtractionResult,
  ExtractionMetadata,
} from '../../src/schemas/run-result-schema.js';

/**
 * Creates extraction metadata with sensible defaults
 */
export function createExtractionMetadata(
  overrides?: Partial<ExtractionMetadata>
): ExtractionMetadata {
  return {
    confidence: 100,
    completeness: 100,
    issues: [],
    detection: {
      extractor: 'vitest',
      confidence: 100,
      patterns: [],
      reason: 'test',
    },
    ...overrides,
  };
}

/**
 * Creates a successful extraction result (no errors)
 */
export function createSuccessfulExtraction(
  overrides?: Partial<ExtractionResult>
): ExtractionResult {
  return {
    errors: [],
    summary: 'All tests passed',
    totalErrors: 0,
    guidance: '',
    errorSummary: '',
    metadata: createExtractionMetadata(),
    ...overrides,
  };
}

/**
 * Creates a failed extraction result (with errors)
 */
export function createFailedExtraction(
  overrides?: Partial<ExtractionResult>
): ExtractionResult {
  return {
    errors: [
      {
        file: 'test/example.test.ts',
        line: 42,
        message: 'Expected true to be false',
      },
    ],
    summary: '1 test failed',
    totalErrors: 1,
    guidance: 'Fix the failing assertion',
    errorSummary: 'Test failure in test/example.test.ts:42',
    metadata: createExtractionMetadata(),
    ...overrides,
  };
}

/**
 * Creates a valid RunResult with all required fields
 *
 * @example
 * ```typescript
 * const result = createValidRunResult();
 * const customResult = createValidRunResult({ exitCode: 1 });
 * ```
 */
export function createValidRunResult(
  overrides?: Partial<RunResult>
): RunResult {
  return {
    command: 'npm test',
    exitCode: 0,
    durationSecs: 1.5,
    timestamp: new Date().toISOString(),
    treeHash: 'abc123def456',
    extraction: createSuccessfulExtraction(),
    ...overrides,
  };
}

/**
 * Creates a RunResult for a failed command
 *
 * @example
 * ```typescript
 * const result = createFailedRunResult();
 * const customResult = createFailedRunResult({ exitCode: 2 });
 * ```
 */
export function createFailedRunResult(
  overrides?: Partial<RunResult>
): RunResult {
  return createValidRunResult({
    exitCode: 1,
    extraction: createFailedExtraction(),
    ...overrides,
  });
}

/**
 * Creates a RunResult marked as a cached result
 *
 * @example
 * ```typescript
 * const result = createCachedRunResult();
 * ```
 */
export function createCachedRunResult(
  overrides?: Partial<RunResult>
): RunResult {
  return createValidRunResult({
    isCachedResult: true,
    ...overrides,
  });
}

/**
 * Creates a RunResult with output files
 *
 * @example
 * ```typescript
 * const result = createRunResultWithOutputFiles();
 * ```
 */
export function createRunResultWithOutputFiles(
  overrides?: Partial<RunResult>
): RunResult {
  return createValidRunResult({
    outputFiles: {
      // eslint-disable-next-line sonarjs/publicly-writable-directories -- Test fixture path
      combined: '/tmp/output.jsonl',
    },
    ...overrides,
  });
}

/**
 * Creates a RunResult without treeHash field (for validation testing)
 *
 * @example
 * ```typescript
 * const result = createRunResultWithoutTreeHash();
 * // Should fail schema validation
 * ```
 */
export function createRunResultWithoutTreeHash(
  overrides?: Partial<Omit<RunResult, 'treeHash'>>
): Omit<RunResult, 'treeHash'> {
  return {
    command: 'npm test',
    exitCode: 0,
    durationSecs: 1.5,
    timestamp: new Date().toISOString(),
    extraction: createSuccessfulExtraction(),
    ...overrides,
  };
}

/**
 * Creates a RunResult with invalid treeHash type (for validation testing)
 *
 * @example
 * ```typescript
 * const result = createRunResultWithInvalidTreeHash();
 * // Should fail schema validation
 * ```
 */
export function createRunResultWithInvalidTreeHash(
  overrides?: Partial<Omit<RunResult, 'treeHash'>>
): Omit<RunResult, 'treeHash'> & { treeHash: number } {
  return {
    command: 'npm test',
    exitCode: 0,
    durationSecs: 1.5,
    timestamp: new Date().toISOString(),
    treeHash: 123, // Invalid: should be string
    extraction: createSuccessfulExtraction(),
    ...overrides,
  } as unknown as Omit<RunResult, 'treeHash'> & { treeHash: number };
}
