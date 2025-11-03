/**
 * Playwright Test Error Extractor
 *
 * Extracts error information from Playwright test output.
 *
 * Output format:
 * ```
 * Running N tests using M workers
 *
 *   ✘   1 test.spec.ts:10:5 › Describe › test name (100ms)
 *   ✓   2 test.spec.ts:20:5 › passing test (50ms)
 *
 *   1) test.spec.ts:10:5 › Describe › test name
 *
 *     Error: expect(received).toBe(expected)
 *
 *     Expected: "foo"
 *     Received: "bar"
 *
 *       10 |     test('test name', async () => {
 *       11 |       const value = 'bar';
 *     > 12 |       expect(value).toBe('foo');
 *          |                     ^
 *       13 |     });
 *
 *       at test.spec.ts:12:21
 * ```
 */

import type { FormattedError, ErrorExtractorResult, ExtractionMetadata } from './types.js';
import { stripAnsiCodes } from './utils.js';

/**
 * Extract errors from Playwright test output
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 22 acceptable for Playwright output parsing (handles numbered failures, error blocks, and file path normalization)
export function extractPlaywrightErrors(output: string): ErrorExtractorResult {
  const errors: FormattedError[] = [];
  const issues: string[] = [];

  // Note: ANSI codes are stripped centrally in smart-extractor.ts
  // Split into lines for processing
  const lines = output.split('\n');

  // Parse numbered failure blocks: "  1) tests/path/test.spec.ts:10:5 › test name"
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Match numbered failure header: "  1) tests/path/test.spec.ts:10:5 › test name"
    // File path can include directories: "tests/playwright/test.spec.ts" or just "test.spec.ts"
    // Allow trailing whitespace
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Playwright test framework output (controlled output), not user input
    const failureMatch = /^\s+(\d+)\)\s+(.*\.spec\.ts):(\d+):(\d+)\s+›\s+(.+?)\s*$/.exec(line);

    if (failureMatch) {
      const [, , file, , , testName] = failureMatch;

      // Extract error block (everything until next numbered failure or end)
      const errorLines: string[] = [];
      i++;

      while (i < lines.length) {
        const nextLine = lines[i];

        // Stop at next numbered failure
        if (/^\s+\d+\)\s+/.exec(nextLine)) {
          break;
        }

        errorLines.push(nextLine);
        i++;
      }

      // Parse the error block
      const errorBlock = errorLines.join('\n');

      // Extract error message (first Error: line and subsequent details)
      // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Playwright test framework error messages (controlled output), not user input
      const errorMessageMatch = /Error:\s*(.+?)(?:\n\n|\n(?=\s+at\s))/s.exec(errorBlock);
      const errorMessage = errorMessageMatch ? errorMessageMatch[1].trim() : testName;

      // Extract file location from stack trace (last line with "at file:line:col")
      // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Playwright test framework stack traces (controlled output), not user input
      const stackMatch = /at\s+(.*\.spec\.ts):(\d+):(\d+)/.exec(errorBlock);
      let errorFile = file;
      let errorLine = 0;
      let errorColumn = 0;

      if (stackMatch) {
        errorFile = stackMatch[1];
        errorLine = Number.parseInt(stackMatch[2], 10);
        errorColumn = Number.parseInt(stackMatch[3], 10);
      } else {
        // No stack trace found - track as an issue
        issues.push(`No stack trace found for failure: ${testName}`);
      }

      // Normalize file path (remove absolute path prefix if present, keep relative paths)
      // If it's an absolute path, extract just the tests/... part or the filename
      if (errorFile.includes('/') && !errorFile.startsWith('tests')) {
        // Absolute path - extract relative part
        const testsMatch = /(tests?\/.+\.spec\.ts)/i.exec(errorFile);
        if (testsMatch) {
          errorFile = testsMatch[1];
        } else {
          // Just keep filename if no tests/ path found
          errorFile = errorFile.replace(/^.*\/([^/]+\.spec\.ts)$/i, '$1');
        }
      }
      // If it already starts with tests/ or is just a filename, keep it as-is

      // Detect error type
      const type = detectErrorType(errorMessage, errorBlock);

      // Generate guidance
      const guidance = generateGuidance(type, errorMessage);

      // Build complete error message
      const completeMessage = `${testName}\n${errorMessage}`;

      errors.push({
        file: errorFile,
        line: errorLine,
        column: errorColumn,
        message: completeMessage,
        context: testName,
        guidance,
      });
    } else {
      i++;
    }
  }

  // Calculate quality metadata
  const metadata = calculateQualityMetadata(errors, issues);

  // Generate summary
  const summary = errors.length > 0
    ? `${errors.length} test(s) failed`
    : '0 test(s) failed';

  // Generate guidance
  const guidance = errors.length > 0
    ? 'Review test failures and fix the underlying issues. Check assertions, selectors, and test logic.'
    : '';

  // Generate clean output
  const formattedOutput = errors
    .map(e => {
      const location = e.file && e.line ? `${e.file}:${e.line}` : e.file ?? 'unknown';
      return `${location}: ${e.message}`;
    })
    .join('\n');

  return {
    errors,
    summary,
    totalCount: errors.length,
    guidance,
    errorSummary: formattedOutput,
    metadata,
  };
}

/**
 * Detect error type from error message and block
 */
function detectErrorType(message: string, block: string): string {
  // Element not found (waiting for locator with timeout)
  // Check this BEFORE generic timeout to avoid false positives
  if (block.includes('waiting for locator') && (message.includes('timeout') || message.includes('exceeded'))) {
    return 'element-not-found';
  }

  // Navigation errors
  if (message.includes('net::ERR') || message.includes('page.goto:')) {
    return 'navigation-error';
  }

  // Timeout errors (generic)
  if (message.includes('timeout') || message.includes('exceeded')) {
    return 'timeout';
  }

  // Assertion errors (expect())
  if (message.includes('expect(') ||
      message.includes('toBe') ||
      message.includes('toContain') ||
      message.includes('toBeVisible') ||
      message.includes('toHaveValue') ||
      message.includes('toHaveCount')) {
    return 'assertion-error';
  }

  // Generic error
  return 'error';
}

/**
 * Generate guidance for common error types
 */
function generateGuidance(type: string, _message: string): string | undefined {
  switch (type) {
    case 'assertion-error':
      return 'Check the assertion expectation and ensure the actual value matches. Review the test logic and the application state.';

    case 'timeout':
      return 'The operation exceeded the timeout limit. Consider increasing the timeout, checking for slow operations, or verifying the application is responding correctly.';

    case 'element-not-found':
      return 'The element was not found on the page. Verify the selector is correct, the element exists, and it is rendered when expected.';

    case 'navigation-error':
      return 'Failed to navigate to the page. Check the URL is correct, the server is running, and the page exists.';

    default:
      return undefined;
  }
}

/**
 * Calculate quality metadata
 */
function calculateQualityMetadata(errors: FormattedError[], issues: string[]): ExtractionMetadata {
  if (errors.length === 0 && issues.length === 0) {
    // No errors and no issues = perfect extraction (or no failures)
    return {
      confidence: 100,
      completeness: 100,
      issues: [],
    };
  }

  // Calculate completeness: % of errors with file + line + message
  const completeErrors = errors.filter(e =>
    e.file &&
    e.line !== undefined &&
    e.line > 0 &&
    e.message
  ).length;

  const completeness = errors.length > 0
    ? Math.round((completeErrors / errors.length) * 100)
    : 100;

  // Calculate confidence based on pattern matching quality
  let confidence = 90; // Base confidence for Playwright (distinctive format)

  // Reduce confidence if we have issues
  if (issues.length > 0) {
    confidence -= Math.min(issues.length * 10, 40);
  }

  // Reduce confidence if completeness is low
  if (completeness < 80) {
    confidence -= (100 - completeness) / 2;
  }

  confidence = Math.max(0, Math.min(100, confidence));

  return {
    confidence: Math.round(confidence),
    completeness,
    issues,
  };
}

/**
 * Check if output is from Playwright
 */
export function isPlaywrightOutput(output: string): boolean {
  // Look for distinctive Playwright markers
  const errorSummary = stripAnsiCodes(output);

  // Playwright uses ✘ symbol and .spec.ts files
  const hasPlaywrightMarker = errorSummary.includes('✘') && errorSummary.includes('.spec.ts');

  // Or has numbered failures with › separator
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only tests Playwright output format (controlled test framework output), not user input
  const hasNumberedFailures = /^\s+\d+\)\s+.+\.spec\.ts:\d+:\d+\s+›/.test(errorSummary);

  return hasPlaywrightMarker || hasNumberedFailures;
}
