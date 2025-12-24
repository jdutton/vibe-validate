/**
 * Test helpers for sandboxed-extractor tests
 * Eliminates duplication in test setup and assertions
 */

import { expect } from 'vitest';

import type { ExtractorPlugin, ExtractionResult } from '../../src/types.js';

/**
 * Standard metadata structure for test results
 */
export interface TestMetadata {
  extractor?: string;
  confidence?: number;
  patterns?: string[];
  reason?: string;
  completeness?: number;
  issues?: string[];
}

/**
 * Creates standard metadata for test extraction results
 * @param overrides - Optional metadata overrides
 * @returns Complete metadata object
 */
export function createTestMetadata(overrides: Partial<TestMetadata> = {}): ExtractionResult['metadata'] {
  const {
    extractor = 'test-extractor',
    confidence = 100,
    patterns = ['test'],
    reason = 'Test',
    completeness = 100,
    issues = [],
  } = overrides;

  return {
    detection: {
      extractor,
      confidence,
      patterns,
      reason,
    },
    confidence,
    completeness,
    issues,
  };
}

/**
 * Creates a simple extraction result with the given properties
 * @param errors - Array of error objects
 * @param summary - Summary message
 * @param guidance - Guidance message
 * @param metadata - Optional metadata overrides
 * @returns Complete extraction result
 */
export function createTestResult(
  errors: Array<{ file?: string; line?: number; message: string }>,
  summary: string,
  guidance: string,
  metadata: Partial<TestMetadata> = {}
): ExtractionResult {
  return {
    errors,
    totalErrors: errors.length,
    summary,
    guidance,
    metadata: createTestMetadata(metadata),
  };
}

/**
 * Type for extractor function used in tests
 */
export type TestExtractorFn = (_output: string, _command?: string) => ExtractionResult;

/**
 * Creates a mock extractor plugin for testing
 * @param extractFn - Function to extract errors from output
 * @param name - Plugin name (default: 'test-extractor')
 * @param priority - Plugin priority (default: 50)
 * @returns Mock extractor plugin
 */
export function createMockPlugin(
  extractFn: TestExtractorFn,
  name = 'test-extractor',
  priority = 50
): ExtractorPlugin {
  return {
    metadata: {
      name,
      version: '1.0.0',
      description: 'Test extractor for sandboxing',
    },
    priority,
    detect: () => ({ confidence: 100, patterns: ['test'], reason: 'Test' }),
    extract: extractFn,
    samples: [],
  };
}

/**
 * Creates a mock plugin that returns a single error from output
 * Self-contained - works in sandbox.
 *
 * @returns Mock plugin
 */
export function createSingleErrorFromOutputPlugin(): ExtractorPlugin {
  return createMockPlugin((output) => ({
    errors: [{ file: 'test.ts', line: 1, message: output }],
    totalErrors: 1,
    summary: '1 error',
    guidance: 'Fix it',
    metadata: {
      detection: {
        extractor: 'test-extractor',
        confidence: 100,
        patterns: ['test'],
        reason: 'Test',
      },
      confidence: 100,
      completeness: 100,
      issues: [],
    },
  }));
}

/**
 * Creates a mock plugin that returns output:command error
 * Self-contained - works in sandbox.
 *
 * @returns Mock plugin
 */
export function createCommandPrefixErrorPlugin(): ExtractorPlugin {
  return createMockPlugin((output, command) => ({
    errors: [{ file: 'test.ts', line: 1, message: `${command}: ${output}` }],
    totalErrors: 1,
    summary: '1 error',
    guidance: 'Fix it',
    metadata: {
      detection: {
        extractor: 'test-extractor',
        confidence: 100,
        patterns: ['test'],
        reason: 'Test',
      },
      confidence: 100,
      completeness: 100,
      issues: [],
    },
  }));
}

/**
 * Creates a mock plugin that returns multiple errors
 * Self-contained - works in sandbox.
 *
 * @returns Mock plugin
 */
export function createMultipleErrorPlugin(): ExtractorPlugin {
  return createMockPlugin(() => ({
    errors: [
      { file: 'test1.ts', line: 1, message: 'Error 1' },
      { file: 'test2.ts', line: 2, message: 'Error 2' },
      { file: 'test3.ts', line: 3, message: 'Error 3' },
    ],
    totalErrors: 3,
    summary: '3 errors',
    guidance: 'Fix them',
    metadata: {
      detection: {
        extractor: 'test-extractor',
        confidence: 100,
        patterns: ['test'],
        reason: 'Test',
      },
      confidence: 100,
      completeness: 100,
      issues: [],
    },
  }));
}

/**
 * Creates a mock plugin that always returns no errors
 * Self-contained for sandbox compatibility.
 *
 * @returns Mock plugin
 */
export function createNoErrorPlugin(): ExtractorPlugin {
  return createMockPlugin(() => ({
    errors: [],
    totalErrors: 0,
    summary: 'No errors',
    guidance: 'All good',
    metadata: {
      detection: {
        extractor: 'test-extractor',
        confidence: 100,
        patterns: ['test'],
        reason: 'Test',
      },
      confidence: 100,
      completeness: 100,
      issues: [],
    },
  }));
}

/**
 * Creates a mock plugin that throws "Syntax error: unexpected token"
 * Self-contained for sandbox compatibility.
 *
 * @returns Mock plugin
 */
export function createSyntaxErrorPlugin(): ExtractorPlugin {
  return createMockPlugin(() => {
    throw new Error('Syntax error: unexpected token');
  });
}

/**
 * Creates a mock plugin that throws "Extractor failed"
 * Self-contained for sandbox compatibility.
 *
 * @returns Mock plugin
 */
export function createExtractorFailedPlugin(): ExtractorPlugin {
  return createMockPlugin(() => {
    throw new Error('Extractor failed');
  });
}

/**
 * Parse output and create result (for string manipulation test)
 * Extracts lines containing 'ERROR'
 * Self-contained for sandbox compatibility.
 *
 * @param output - Output to parse
 * @returns Extraction result
 */
export function parseErrorLines(output: string): ExtractionResult {
  const lines = output.split('\n');
  const errorLines = lines.filter(line => line.includes('ERROR'));
  const errors = errorLines.map((line, idx) => ({
    file: 'test.ts',
    line: idx + 1,
    message: line.trim(),
  }));

  return {
    errors,
    totalErrors: errors.length,
    summary: `${errors.length} errors`,
    guidance: 'Fix errors',
    metadata: {
      detection: {
        extractor: 'test-extractor',
        confidence: 100,
        patterns: ['ERROR'],
        reason: 'Found ERROR keyword',
      },
      confidence: 100,
      completeness: 100,
      issues: [],
    },
  };
}

/**
 * Create extractor that uses regex to parse errors
 * Pattern: "Error at line N: message"
 * Self-contained for sandbox compatibility.
 *
 * @returns Extraction function
 */
export function createRegexErrorExtractor(): TestExtractorFn {
  return (output: string): ExtractionResult => {
    const errorRegex = /Error at line (\d+): (.+)/g;
    const errors = [];
    let match;

    while ((match = errorRegex.exec(output)) !== null) {
      errors.push({
        file: 'test.ts',
        line: Number.parseInt(match[1], 10),
        message: match[2],
      });
    }

    return {
      errors,
      totalErrors: errors.length,
      summary: `${errors.length} errors`,
      guidance: 'Fix errors',
      metadata: {
        detection: {
          extractor: 'test-extractor',
          confidence: 100,
          patterns: ['Error at line'],
          reason: 'Regex match',
        },
        confidence: 100,
        completeness: 100,
        issues: [],
      },
    };
  };
}

/**
 * Assertion helper: Verify result has expected error count
 * @param result - Extraction result
 * @param expectedCount - Expected number of errors
 */
export function expectErrorCount(result: ExtractionResult, expectedCount: number): void {
  expect(result.errors).toHaveLength(expectedCount);
  expect(result.totalErrors).toBe(expectedCount);
}

/**
 * Assertion helper: Verify result has single error with expected message
 * @param result - Extraction result
 * @param expectedMessage - Expected error message
 */
export function expectSingleError(result: ExtractionResult, expectedMessage: string): void {
  expectErrorCount(result, 1);
  expect(result.errors[0].message).toBe(expectedMessage);
}

/**
 * Assertion helper: Verify result has no errors
 * @param result - Extraction result
 */
export function expectNoErrors(result: ExtractionResult): void {
  expectErrorCount(result, 0);
}

/**
 * Assertion helper: Verify result indicates sandbox failure
 * @param result - Extraction result
 * @param expectedErrorMessage - Expected error message in issues
 */
export function expectSandboxFailure(result: ExtractionResult, expectedErrorMessage?: string): void {
  expectNoErrors(result);
  expect(result.summary).toContain('Sandbox execution failed');
  expect(result.metadata?.issues).toHaveLength(1);
  if (expectedErrorMessage) {
    expect(result.metadata?.issues[0]).toContain(expectedErrorMessage);
  }
  expect(result.metadata?.confidence).toBe(0);
}
