/**
 * Mocha Error Extractor Plugin
 *
 * Parses and formats Mocha test output for LLM consumption.
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
  COMMON_STACK_PATTERNS,
} from '../../utils/parser-utils.js';
import { processTestFailures, type TestFailureInfo } from '../../utils/test-framework-utils.js';

/**
 * Extract failure information from Mocha output
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 30 acceptable for Mocha output parsing (handles test hierarchies, error messages, and stack trace extraction)
function extractFailures(output: string): TestFailureInfo[] {
  const failures: TestFailureInfo[] = [];
  const lines = output.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Look for numbered failure markers (e.g., "  1) ")
    // Only match detailed format (2 spaces), not summary format (6+ spaces)
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Mocha test framework output (controlled output), not user input
    const failureMatch = /^ {2}(\d+)\)\s+(.*)$/.exec(line);

    if (failureMatch) {
      // failureMatch[1] contains the failure number (not used - test name is more important)
      const firstPart = failureMatch[2].trim();

      // Collect test hierarchy lines
      const testNameParts: string[] = [];

      // Check if first part ends with colon (simple format: "1) Test:")
      const isSimpleFormat = firstPart.endsWith(':');

      if (firstPart) {
        testNameParts.push(firstPart.replace(/:$/, '')); // Remove trailing colon
      }

      let j = i + 1;

      // If simple format, don't try to collect more hierarchy
      if (!isSimpleFormat) {
        // Continue collecting hierarchy lines until we hit blank line or error
        const { lines: hierarchyLines, nextIndex } = collectLinesUntil(
          lines,
          j,
          (line) =>
            line.trim() === '' || /^\s+(Error|AssertionError|TypeError)/.exec(line) !== null
        );
        j = nextIndex;

        // Extract indented hierarchy lines (at least 5 spaces for Mocha)
        for (const line of hierarchyLines) {
          if (/^\s{5,}\S/.exec(line)) {
            const part = line.trim().replace(/:$/, ''); // Remove trailing colon
            testNameParts.push(part);
          }
        }
      }

      const testName = testNameParts.join(' > ');

      // Now scan for error message and stack trace
      let message: string | undefined;
      let errorType: string | undefined;
      let file: string | undefined;
      let lineNumber: number | undefined;

      // Continue from where we left off
      while (j < lines.length && j < i + 40) {
        const nextLine = lines[j];

        // Stop if we hit the next failure
        if (/^\s+\d+\)\s+/.exec(nextLine)) {
          break;
        }

        // Extract error type and message
        // Pattern 1: "     AssertionError [ERR_ASSERTION]: Expected..."
        // Pattern 2: "     Error: ENOENT: no such file..."
        // Pattern 3: "     TypeError: Cannot read..."
        if (!message) {
          // Match plain "Error" or prefixed errors like "TypeError", "AssertionError"
          const errorMatch = /^\s+([A-Za-z]*Error)(?:\s\[\w+\])?\s*:\s*(.+)/.exec(nextLine);
          if (errorMatch) {
            errorType = errorMatch[1];
            message = errorMatch[2].trim();
          }
        }

        // Extract file location from stack trace
        if (!file && nextLine.includes('at Context.<anonymous>')) {
          const location = parseStackLocation(nextLine, COMMON_STACK_PATTERNS.contextAnonymous);
          if (location.file) {
            file = location.file;
            lineNumber = location.line;
          }
        }

        // Extract file from timeout error messages: "Error: Timeout... (/path/to/file.js)"
        if (!file && message?.includes('Timeout')) {
          // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Mocha test framework timeout messages (controlled output), not user input
          const timeoutFileMatch = /\(([^)]+\.(?:js|ts|mjs|cjs))\)/.exec(message);
          if (timeoutFileMatch) {
            file = timeoutFileMatch[1];
          }
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
 * Extract errors from Mocha test output
 *
 * @param output - Mocha text output
 * @returns Structured error information
 */
function extract(output: string): ErrorExtractorResult {
  // Check if this looks like Mocha output
  if (!output.includes('failing') && !output.includes('passing')) {
    return {
      summary: 'Unable to parse Mocha output - invalid format',
      errors: [],
      totalErrors: 0,
      errorSummary: output.trim(),
      guidance: 'Ensure the input is valid Mocha test output',
      metadata: {
        confidence: 0,
        completeness: 0,
        issues: ['Not Mocha output format']
      }
    };
  }

  // Extract failure count
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Mocha test framework summary (controlled output), not user input
  const failingMatch = /(\d+) failing/.exec(output);
  const failureCount = failingMatch ? Number.parseInt(failingMatch[1], 10) : 0;

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
 * Detect if output is from Mocha test framework
 *
 * @param output - Command output to analyze
 * @returns Detection result with confidence and patterns
 */
function detect(output: string): DetectionResult {
  if (output.includes('failing') || output.includes('passing')) {
    return {
      confidence: 85,
      patterns: ['failing/passing pattern'],
      reason: 'Mocha test framework output detected',
    };
  }
  return { confidence: 0, patterns: [], reason: '' };
}

/**
 * Sample test cases for Mocha extractor
 */
const samples: ExtractorSample[] = [
  {
    name: 'single-assertion-error',
    description: 'Single Mocha test failure with AssertionError',
    input: `
  Vibe-Validate Mocha Test Matrix
    Failure Type 1: Assertion Errors
      1) should match expected value

  0 passing (10ms)
  1 failing

  1) Vibe-Validate Mocha Test Matrix
       Failure Type 1: Assertion Errors
         should match expected value:

      AssertionError [ERR_ASSERTION]: Expected 4 to equal 5
      at Context.<anonymous> (file:///tmp/test.js:16:14)
`,
    expectedErrors: 1,
    expectedPatterns: ['AssertionError', 'Expected 4 to equal 5'],
  },
  {
    name: 'multiple-test-failures',
    description: 'Multiple Mocha test failures with different error types',
    input: `
  0 passing (20ms)
  3 failing

  1) Suite > Test 1:
     Error: First error
      at Context.<anonymous> (test.js:10:15)

  2) Suite > Test 2:
     TypeError: Cannot read properties of null
      at Context.<anonymous> (test.js:20:15)

  3) Suite > Test 3:
     AssertionError: Values not equal
      at Context.<anonymous> (test.js:30:15)
`,
    expectedErrors: 3,
    expectedPatterns: ['First error', 'TypeError', 'AssertionError'],
  },
];

/**
 * Mocha Error Extractor Plugin
 *
 * Extracts Mocha test framework errors with 85% confidence.
 * Parses test hierarchies, error types, and stack traces.
 */
const mochaPlugin: ExtractorPlugin = {
  metadata: {
    name: 'mocha',
    version: '1.0.0',
    author: 'vibe-validate',
    description: 'Extracts Mocha test framework errors',
    repository: 'https://github.com/jdutton/vibe-validate',
    tags: ['mocha', 'testing', 'javascript'],
  },
  hints: {
    required: ['failing'],
    anyOf: ['passing'],
  },
  priority: 85,
  detect,
  extract,
  samples,
};

export default mochaPlugin;
