/**
 * Jasmine Error Extractor Plugin
 *
 * Parses and formats Jasmine test output for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

// max-depth disabled: Test framework output parsing requires nested loops for message/stack
// section handling, pattern matching, and state tracking across multiple parsing phases.
/* eslint-disable max-depth */

import type {
  ExtractorPlugin,
  ErrorExtractorResult,
  DetectionResult,
  ExtractorSample,
} from '../../types.js';
import {
  collectLinesUntil,
  parseStackLocation,
  extractErrorType,
  type StackLocationPattern,
} from '../../utils/parser-utils.js';
import { processTestFailures, type TestFailureInfo } from '../../utils/test-framework-utils.js';

/**
 * Extract failure information from Jasmine output
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 28 acceptable for Jasmine output parsing (handles numbered failures, message extraction, and stack trace parsing)
function extractFailures(output: string): TestFailureInfo[] {
  const failures: TestFailureInfo[] = [];
  const lines = output.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Look for numbered failure markers (e.g., "1) Test name")
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Jasmine test framework output (controlled output), not user input
    const failureMatch = /^(\d+)\)\s+(.+)$/.exec(line);

    if (failureMatch) {
      // failureMatch[1] contains the failure number (not used - line number extracted from stack trace instead)
      const testName = failureMatch[2].trim();

      let j = i + 1;
      let message: string | undefined;
      let errorType: string | undefined;
      let file: string | undefined;
      let lineNumber: number | undefined;

      // Scan for Message: and Stack: sections
      while (j < lines.length && j < i + 30) {
        const nextLine = lines[j];

        // Stop if we hit the next failure
        if (/^\d+\)\s+/.exec(nextLine)) {
          break;
        }

        // Extract message (comes after "  Message:" line)
        if (nextLine.trim() === 'Message:') {
          j++;
          // Collect message lines until we hit "Stack:" or empty line
          const { lines: messageLines, nextIndex } = collectLinesUntil(
            lines,
            j,
            (line) => line.trim() === 'Stack:' || line.trim() === ''
          );
          j = nextIndex;
          message = messageLines.map((line) => line.trim()).join(' ').trim();

          // Extract error type if present (e.g., "TypeError:", "Error:")
          errorType = extractErrorType(message);

          continue;
        }

        // Extract file location from stack trace
        if (nextLine.trim() === 'Stack:') {
          j++;
          // Scan stack trace for file location
          const { lines: stackLines, nextIndex } = collectLinesUntil(
            lines,
            j,
            (line, index) =>
              /^\d+\)\s+/.exec(line) !== null ||
              (line.trim() === '' && /^\d+\)\s+/.exec(lines[index + 1] ?? '') !== null) ||
              index >= i + 40
          );
          j = nextIndex;

          // Parse stack lines to extract file location
          const jasminePatterns: StackLocationPattern[] = [
            // UserContext.<anonymous> pattern (Jasmine-specific)
            {
              // eslint-disable-next-line security/detect-unsafe-regex -- Safe: only parses Jasmine test framework stack traces (controlled output), not user input
              regex: /UserContext\.<anonymous> \(([^:)]+):(\d+)(?::(\d+))?\)/,
              fileGroup: 1,
              lineGroup: 2,
              columnGroup: 3,
            },
            // Generic function call pattern (fallback)
            {
              // eslint-disable-next-line sonarjs/slow-regex, security/detect-unsafe-regex -- Safe: only parses Jasmine test framework stack traces (controlled output), not user input
              regex: /\(([^:)]+):(\d+)(?::(\d+))?\)/,
              fileGroup: 1,
              lineGroup: 2,
              columnGroup: 3,
            },
          ];

          for (const stackLine of stackLines) {
            const location = parseStackLocation(stackLine, jasminePatterns);
            if (location.file) {
              file = location.file;
              lineNumber = location.line;
              break;
            }
          }

          continue;
        }

        j++;
      }

      failures.push({
        testName,
        message,
        errorType,
        file,
        line: lineNumber
      });

      i = j; // Skip to after this failure
    } else {
      i++;
    }
  }

  return failures;
}

/**
 * Extract errors from Jasmine test output
 *
 * @param output - Jasmine text output
 * @returns Structured error information
 */
function extract(output: string): ErrorExtractorResult {
  // Check if this looks like Jasmine output
  if (!output.includes('spec') && !output.includes('Failures:')) {
    return {
      summary: 'Unable to parse Jasmine output - invalid format',
      errors: [],
      totalErrors: 0,
      errorSummary: output.trim(),
      guidance: 'Ensure the input is valid Jasmine test output',
      metadata: {
        confidence: 0,
        completeness: 0,
        issues: ['Not Jasmine output format']
      }
    };
  }

  // Extract failure count
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Jasmine test framework summary (controlled output), not user input
  const failureMatch = /(\d+) spec(?:s)?, (\d+) failure(?:s)?/.exec(output);
  const failureCount = failureMatch ? Number.parseInt(failureMatch[2], 10) : 0;

  // Extract all failures
  const failures = extractFailures(output);

  // Early return if no failures detected (but failure count suggested there should be)
  if (failureCount === 0 && failures.length === 0) {
    return processTestFailures([], 95);
  }

  // Process failures using shared utility
  return processTestFailures(failures, 95);
}

/**
 * Detect if output is from Jasmine test framework
 *
 * @param output - Command output to analyze
 * @returns Detection result with confidence and patterns
 */
function detect(output: string): DetectionResult {
  // Require "spec" to avoid false positives on Maven output (which has "Failures:")
  const hasSpec = output.includes('spec');
  const hasFailures = output.includes('Failures:');

  // Strong signal: both spec and Failures: present
  if (hasSpec && hasFailures) {
    return {
      confidence: 90,
      patterns: ['spec', 'Failures:'],
      reason: 'Jasmine test framework output detected (spec + Failures)',
    };
  }

  // Weak signal: only spec (could be other frameworks)
  if (hasSpec) {
    return {
      confidence: 60,
      patterns: ['spec'],
      reason: 'Possible Jasmine output (spec keyword found)',
    };
  }

  return { confidence: 0, patterns: [], reason: '' };
}

/**
 * Sample test cases for Jasmine extractor
 */
const samples: ExtractorSample[] = [
  {
    name: 'single-assertion-error',
    description: 'Single Jasmine test failure with assertion error',
    input: `
Started
F

Failures:
1) Vibe-Validate Jasmine Test Matrix Failure Type 1: Assertion Errors should match expected value
  Message:
    Expected 4 to equal 5.
  Stack:
        at <Jasmine>
        at UserContext.<anonymous> (/private/tmp/jasmine-comprehensive.test.js:9:17)
        at <Jasmine>

1 spec, 1 failure
Finished in 0.037 seconds
`,
    expectedErrors: 1,
    expectedPatterns: ['Expected 4 to equal 5'],
  },
  {
    name: 'multiple-test-failures',
    description: 'Multiple Jasmine test failures with different error types',
    input: `
Started
FFF

Failures:
1) Suite > Test 1
  Message:
    Expected 1 to equal 2.
  Stack:
        at UserContext.<anonymous> (test.js:10:15)

2) Suite > Test 2
  Message:
    TypeError: Cannot read properties of null
  Stack:
        at UserContext.<anonymous> (test.js:20:15)

3) Suite > Test 3
  Message:
    Error: ENOENT: no such file or directory
  Stack:
        at UserContext.<anonymous> (test.js:30:15)

3 specs, 3 failures
`,
    expectedErrors: 3,
    expectedPatterns: ['Expected 1 to equal 2', 'TypeError', 'ENOENT'],
  },
];

/**
 * Jasmine Error Extractor Plugin
 *
 * Extracts Jasmine test framework errors with 85% confidence.
 * Parses Message: and Stack: sections with structured format.
 */
const jasminePlugin: ExtractorPlugin = {
  metadata: {
    name: 'jasmine',
    version: '1.0.0',
    author: 'vibe-validate',
    description: 'Extracts Jasmine test framework errors',
    repository: 'https://github.com/jdutton/vibe-validate',
    tags: ['jasmine', 'testing', 'javascript'],
  },
  hints: {
    required: ['spec'],
    anyOf: ['Failures:'],
  },
  priority: 90, // Updated to match highest confidence
  detect,
  extract,
  samples,
};

export default jasminePlugin;
