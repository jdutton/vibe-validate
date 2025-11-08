/**
 * Jasmine Error Extractor
 *
 * Parses Jasmine test output and formats failures for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult } from './types.js';
import { processTestFailures, type TestFailureInfo } from './utils/test-framework-utils.js';

/**
 * Extract errors from Jasmine test output
 *
 * @param output - Jasmine text output
 * @returns Structured error information
 *
 * @example
 * ```typescript
 * const jasmineOutput = execSync('jasmine tests/**\/*.spec.js', { encoding: 'utf-8' });
 * const result = extractJasmineErrors(jasmineOutput);
 * console.log(result.summary); // "5 test(s) failed"
 * ```
 */
export function extractJasmineErrors(output: string): ErrorExtractorResult {
  // Note: ANSI codes are stripped centrally in smart-extractor.ts

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
          const messageLines: string[] = [];
          while (j < lines.length) {
            const msgLine = lines[j];
            if (msgLine.trim() === 'Stack:' || msgLine.trim() === '') {
              break;
            }
            messageLines.push(msgLine.trim());
            j++;
          }
          message = messageLines.join(' ').trim();

          // Extract error type if present (e.g., "TypeError:", "Error:")
          const errorMatch = /^([A-Za-z]*Error):\s*/.exec(message);
          if (errorMatch) {
            errorType = errorMatch[1];
          }

          continue;
        }

        // Extract file location from stack trace
        if (nextLine.trim() === 'Stack:') {
          j++;
          // Scan stack trace for file location
          while (j < lines.length && j < i + 40) {
            const stackLine = lines[j];

            // Stop if we hit the next failure or empty section
            if (/^\d+\)\s+/.exec(stackLine) || (stackLine.trim() === '' && /^\d+\)\s+/.exec(lines[j + 1] ?? ''))) {
              break;
            }

            // Extract file from UserContext.<anonymous> stack lines
            if (stackLine.includes('UserContext.<anonymous>')) {
              const locationMatch = /UserContext\.<anonymous> \(([^:)]+):(\d+)(?::(\d+))?\)/.exec(stackLine);
              if (locationMatch) {
                file = locationMatch[1];
                lineNumber = Number.parseInt(locationMatch[2], 10);
                break;
              }
            }

            // Also try Object.* patterns
            if (!file && stackLine.includes(' (') && stackLine.includes('.js:')) {
              // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Jasmine test framework stack traces (controlled output), not user input
              const altMatch = /\(([^:)]+):(\d+)(?::(\d+))?\)/.exec(stackLine);
              if (altMatch) {
                file = altMatch[1];
                lineNumber = Number.parseInt(altMatch[2], 10);
                break;
              }
            }

            j++;
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

