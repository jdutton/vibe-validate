/**
 * Mocha Error Extractor
 *
 * Parses Mocha test output and formats failures for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult } from './types.js';
import { processTestFailures, type TestFailureInfo } from './utils/test-framework-utils.js';

/**
 * Extract errors from Mocha test output
 *
 * @param output - Mocha text output
 * @returns Structured error information
 *
 * @example
 * ```typescript
 * const mochaOutput = execSync('mocha tests/**\/*.test.js', { encoding: 'utf-8' });
 * const result = extractMochaErrors(mochaOutput);
 * console.log(result.summary); // "5 test(s) failed"
 * ```
 */
export function extractMochaErrors(output: string): ErrorExtractorResult {
  // Note: ANSI codes are stripped centrally in smart-extractor.ts

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
        while (j < lines.length) {
          const nextLine = lines[j];

          // Blank line marks end of hierarchy
          if (nextLine.trim() === '') {
            break;
          }

          // Error line marks end of hierarchy
          if (/^\s+(Error|AssertionError|TypeError)/.exec(nextLine)) {
            break;
          }

          // Indented lines are part of hierarchy (at least 5 spaces for Mocha)
          if (/^\s{5,}\S/.exec(nextLine)) {
            const part = nextLine.trim().replace(/:$/, ''); // Remove trailing colon
            testNameParts.push(part);
          }

          j++;
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
          // Match various path formats:
          // - file:///path/to/file.js:10:20
          // - /absolute/path/file.js:10:20
          // - relative/path/file.js:10:20
          const locationMatch = /at Context\.<anonymous> \((?:file:\/\/)?([^:)]+):(\d+)(?::(\d+))?\)/.exec(nextLine);
          if (locationMatch) {
            file = locationMatch[1];
            lineNumber = Number.parseInt(locationMatch[2], 10);
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

