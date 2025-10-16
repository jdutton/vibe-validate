/**
 * Vitest/Jest Error Formatter
 *
 * Parses and formats Vitest (and Jest) test failure output for LLM consumption.
 *
 * @package @vibe-validate/formatters
 */

import type { ErrorFormatterResult, FormattedError } from './types.js';

interface TestFailure {
  file: string;
  location: string;
  testHierarchy: string;
  errorMessage: string;
  sourceLine: string;
}

/**
 * Format Vitest test failures
 *
 * Extracts:
 * - Test file and location (file:line:column)
 * - Test hierarchy (describe blocks > test name)
 * - Assertion error message
 * - Source code line that failed
 * - Expected vs actual values (when available)
 *
 * @param output - Raw Vitest/Jest command output
 * @returns Structured error information with test-specific guidance
 *
 * @example
 * ```typescript
 * const result = formatVitestErrors(vitestOutput);
 * console.log(result.summary); // "3 test failure(s)"
 * console.log(result.guidance); // "Fix each failing test individually..."
 * ```
 */
export function formatVitestErrors(output: string): ErrorFormatterResult {
  const lines = output.split('\n');
  const failures: TestFailure[] = [];
  let currentFailure: Partial<TestFailure> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: FAIL test/unit/config/environment.test.ts > EnvironmentConfig > test name
    const failLineMatch = line.match(/FAIL\s+(test\/[^\s]+\.test\.ts)\s*>\s*(.+)/);
    if (failLineMatch) {
      if (currentFailure && currentFailure.file) {
        failures.push(currentFailure as TestFailure);
      }
      currentFailure = {
        file: failLineMatch[1],
        testHierarchy: failLineMatch[2].trim(),
        errorMessage: '',
        sourceLine: '',
        location: ''
      };
      continue;
    }

    // Match: AssertionError: expected 3000 to be 9999 // Object.is equality
    if (currentFailure && (line.includes('AssertionError:') || line.includes('Error:'))) {
      const errorMatch = line.match(/(?:AssertionError|Error):\s*(.+)/);
      if (errorMatch) {
        currentFailure.errorMessage = errorMatch[1].trim();
      }
      continue;
    }

    // Match: ❯ test/unit/config/environment.test.ts:57:30
    if (currentFailure && line.includes('❯') && line.includes('.test.ts:')) {
      const locationMatch = line.match(/❯\s*(.+\.test\.ts):(\d+):(\d+)/);
      if (locationMatch) {
        currentFailure.location = `${locationMatch[1]}:${locationMatch[2]}:${locationMatch[3]}`;
      }
      continue;
    }

    // Match source line: 57|     expect(config.HTTP_PORT).toBe(9999);
    if (currentFailure && line.match(/^\s*\d+\|\s+/)) {
      const sourceMatch = line.match(/^\s*(\d+)\|\s*(.+)/);
      if (sourceMatch) {
        currentFailure.sourceLine = `${sourceMatch[1]}| ${sourceMatch[2].trim()}`;
      }
      continue;
    }
  }

  // Add last failure
  if (currentFailure && currentFailure.file) {
    failures.push(currentFailure as TestFailure);
  }

  // Extract expected/actual values if present in output
  const { expected, actual } = extractExpectedActual(output);

  // Format output with all extracted information + LLM guidance
  const cleanOutput = failures
    .slice(0, 10)
    .map((f, idx) => {
      const parts = [
        `[Test ${idx + 1}/${failures.length}] ${f.location || f.file}`,
        '',
        `Test: ${f.testHierarchy}`,
        `Error: ${f.errorMessage}`,
      ];

      if (expected && actual) {
        parts.push(`Expected: ${expected}`, `Actual: ${actual}`);
      }

      if (f.sourceLine) {
        parts.push('', f.sourceLine);
      }

      return parts.filter(p => p).join('\n');
    })
    .join('\n\n');

  // Enhanced LLM-friendly guidance
  let guidance = `${failures.length} test(s) failed. `;
  if (failures.length === 1) {
    guidance += 'Fix the assertion in the test file at the location shown. ';
    if (expected && actual) {
      guidance += `The test expected "${expected}" but got "${actual}". `;
    }
    guidance += 'Run: npm test -- <test-file> to verify the fix.';
  } else {
    guidance += 'Fix each failing test individually. Run: npm test -- <test-file> to test each file.';
  }

  return {
    errors: failures.slice(0, 10).map(f => ({
      file: f.file,
      line: f.location ? parseInt(f.location.split(':')[1]) : undefined,
      column: f.location ? parseInt(f.location.split(':')[2]) : undefined,
      message: `${f.testHierarchy}: ${f.errorMessage}`
    })),
    summary: `${failures.length} test failure(s)`,
    totalCount: failures.length,
    guidance,
    cleanOutput
  };
}

/**
 * Extract expected/actual values from test output
 *
 * @param output - Full test output
 * @returns Expected and actual values (if found)
 */
function extractExpectedActual(fullOutput: string): { expected?: string; actual?: string } {
  const expectedMatch = fullOutput.match(/- Expected[^\n]*\n[^\n]*\n- (.+)/);
  const actualMatch = fullOutput.match(/\+ Received[^\n]*\n[^\n]*\n\+ (.+)/);
  return {
    expected: expectedMatch ? expectedMatch[1].trim() : undefined,
    actual: actualMatch ? actualMatch[1].trim() : undefined
  };
}
