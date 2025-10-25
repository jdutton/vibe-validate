/**
 * Jest Error Extractor
 *
 * Parses and formats Jest test failure output for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult } from './types.js';
import { stripAnsiCodes } from './utils.js';

interface JestFailure {
  file: string;
  location: string;
  testHierarchy: string;
  errorMessage: string;
}

/**
 * Extract Jest test failures
 *
 * Parses Jest output format:
 * - FAIL test/file.test.ts
 * - ● Test Suite › test name
 * -     Error message
 * -     at file:line:col
 *
 * @param output - Raw Jest command output
 * @returns Structured error information with test-specific guidance
 *
 * @example
 * ```typescript
 * const result = extractJestErrors(jestOutput);
 * console.log(result.summary); // "3 test failure(s)"
 * console.log(result.guidance); // "Fix each failing test individually..."
 * ```
 */
export function extractJestErrors(output: string): ErrorExtractorResult {
  const cleanOutput = stripAnsiCodes(output);
  const lines = cleanOutput.split('\n');
  const failures: JestFailure[] = [];

  let currentFile = '';
  let currentTest: string | null = null;
  let currentError: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: FAIL test/integration/extraction-with-mocks.test.ts
    // OR: FAIL project-name tests/jest/calculator.test.ts
    const failMatch = line.match(/^FAIL\s+(?:[\w-]+\s+)?([\w/-]+\.test\.\w+)/);
    if (failMatch) {
      currentFile = failMatch[1];
      continue;
    }

    // Match: ● TestSuite › Sub Suite › test name
    const testMatch = line.match(/^\s*●\s+(.+)$/);
    if (testMatch && currentFile) {
      // Save previous test if we have one
      if (currentTest && currentError) {
        failures.push({
          file: currentFile,
          location: currentFile, // Jest doesn't always show line numbers in error section
          testHierarchy: currentTest,
          errorMessage: currentError.trim()
        });
      }

      currentTest = testMatch[1].trim();
      currentError = null;
      continue;
    }

    // Extract error message (first non-empty line after test name, before source code)
    if (currentTest && !currentError && line.trim() && !line.includes('|')) {
      // Skip empty lines and source code lines (contain |)
      // Look for plain error message
      if (!line.match(/^\s*at\s/) && !line.match(/^\s*\d+\s*\|/)) {
        currentError = line.trim();
      }
    }

    // Extract location from stack trace: at ... (file:line:col)
    const locationMatch = line.match(/at\s+.+?\((.+?):(\d+):(\d+)\)/);
    if (locationMatch && currentTest && failures.length > 0) {
      const lastFailure = failures[failures.length - 1];
      if (lastFailure.testHierarchy === currentTest) {
        lastFailure.location = `${locationMatch[1]}:${locationMatch[2]}:${locationMatch[3]}`;
      }
    }
  }

  // Save last test
  if (currentTest && currentError) {
    failures.push({
      file: currentFile || 'unknown',
      location: currentFile || 'unknown',
      testHierarchy: currentTest,
      errorMessage: currentError.trim()
    });
  }

  // Build formatted errors
  const errors = failures.map(f => ({
    file: f.file,
    line: parseInt(f.location.split(':')[1] || '0'),
    column: parseInt(f.location.split(':')[2] || '0'),
    message: `${f.testHierarchy}: ${f.errorMessage}`,
    severity: 'error' as const
  }));

  const summary = failures.length > 0
    ? `${failures.length} test failure(s)`
    : 'No test failures detected';

  const guidance = failures.length > 0
    ? 'Fix each failing test individually. Check test setup, mocks, and assertions.'
    : '';

  const cleanOutputLines: string[] = [];
  for (const failure of failures) {
    cleanOutputLines.push(`● ${failure.testHierarchy}`);
    cleanOutputLines.push(`  ${failure.errorMessage}`);
    cleanOutputLines.push(`  Location: ${failure.location}`);
    cleanOutputLines.push('');
  }

  return {
    errors,
    summary,
    totalCount: failures.length,
    guidance,
    cleanOutput: cleanOutputLines.join('\n')
  };
}
