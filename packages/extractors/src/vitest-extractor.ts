/**
 * Vitest/Jest Error Extractor
 *
 * Parses and formats Vitest (and Jest) test failure output for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult } from './types.js';

interface TestFailure {
  file: string;
  location: string;
  testHierarchy: string;
  errorMessage: string;
  sourceLine: string;
}

/**
 * Extract runtime errors (Unhandled Rejection, ENOENT, etc.)
 *
 * @param output - Full test output
 * @returns Test failure object if runtime error found
 */
function extractRuntimeError(output: string): TestFailure | null {
  // Look for "Unhandled Rejection" section
  const unhandledMatch = output.match(/⎯+\s*Unhandled Rejection\s*⎯+\s*\n\s*(Error:[^\n]+(?:\n\s*[^\n❯⎯]+)?)/);
  if (!unhandledMatch) {
    return null;
  }

  // Error message may span multiple lines (e.g., path on next line)
  const errorMessage = unhandledMatch[1].trim().replace(/\n\s+/g, ' ');

  // Extract location from stack trace (❯ function file:line:col)
  // File path may contain colons (e.g., node:internal/fs/promises), so match ❯ function filepath:number:number
  const locationMatch = output.match(/❯\s+\S+\s+([\w:/.]+):(\d+):(\d+)/);
  let file = 'unknown';
  let location = '';

  if (locationMatch) {
    file = locationMatch[1];
    location = `${locationMatch[1]}:${locationMatch[2]}:${locationMatch[3]}`;
  }

  return {
    file,
    location,
    testHierarchy: 'Runtime Error',
    errorMessage,
    sourceLine: ''
  };
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
 * const result = extractVitestErrors(vitestOutput);
 * console.log(result.summary); // "3 test failure(s)"
 * console.log(result.guidance); // "Fix each failing test individually..."
 * ```
 */
export function extractVitestErrors(output: string): ErrorExtractorResult {
  const lines = output.split('\n');
  const failures: TestFailure[] = [];
  let currentFailure: Partial<TestFailure> | null = null;

  // First, check for runtime errors (Unhandled Rejection, ENOENT, etc.)
  const runtimeError = extractRuntimeError(output);
  if (runtimeError) {
    failures.push(runtimeError);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: FAIL test/unit/config/environment.test.ts > EnvironmentConfig > test name
    // OR: ❌ packages/core/test/runner.test.ts > ValidationRunner > test name
    const failLineMatch = line.match(/(?:FAIL|❌)\s+([^\s]+\.test\.ts)\s*>\s*(.+)/);
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
    // OR: Error: Test timed out in 5000ms.
    // OR: Snapshot `name` mismatched
    if (currentFailure && !currentFailure.errorMessage) {
      // Check for standard error patterns
      const errorMatch = line.match(/((?:AssertionError|Error):\s*.+)/);
      // Check for snapshot failures (doesn't have "Error:" prefix)
      const snapshotMatch = line.match(/Snapshot\s+`([^`]+)`\s+mismatched/);

      if (errorMatch || snapshotMatch) {
        // Keep the full error including the type (AssertionError: ...)
        let errorMessage = errorMatch ? errorMatch[1].trim() : line.trim();
        const isSnapshotError = !!snapshotMatch;

        // Capture additional lines (e.g., timeout guidance, long error messages, snapshot diffs)
        // For snapshot errors: continue through blank lines until stack trace
        // For other errors: stop at blank lines
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j].trim();

          // Always stop at these markers
          if (nextLine.startsWith('❯') || nextLine.match(/^\d+\|/) || nextLine.startsWith('FAIL') || nextLine.startsWith('✓') || nextLine.startsWith('❌') || nextLine.startsWith('⎯')) {
            break;
          }

          // Stop at stack trace (starts with "at ")
          if (nextLine.startsWith('at ')) {
            break;
          }

          // For non-snapshot errors, stop at blank lines
          // For snapshot errors, continue through blank lines to capture diff
          if (!nextLine && !isSnapshotError) {
            break;
          }

          // Add line to error message
          // For snapshots: preserve formatting with newlines and indentation
          // For other errors: join with spaces for compact output
          if (nextLine || isSnapshotError) {
            if (isSnapshotError) {
              errorMessage += '\n' + lines[j]; // Preserve indentation for diffs
            } else {
              errorMessage += ' ' + nextLine; // Compact for normal errors
            }
          }
          j++;
        }

        currentFailure.errorMessage = errorMessage;
        i = j - 1; // Skip the lines we just consumed
      }
      continue;
    }

    // Match: ❯ test/unit/config/environment.test.ts:57:30
    // OR stack trace: at Object.<anonymous> (packages/core/test/runner.test.ts:45:12)
    if (currentFailure && !currentFailure.location) {
      // Try vitest location marker first
      const vitestLocation = line.match(/❯\s*(.+\.test\.ts):(\d+):(\d+)/);
      if (vitestLocation) {
        currentFailure.location = `${vitestLocation[1]}:${vitestLocation[2]}:${vitestLocation[3]}`;
        continue;
      }

      // Try stack trace pattern
      const stackLocation = line.match(/at\s+.+\(([^\s]+\.test\.ts):(\d+):(\d+)\)/);
      if (stackLocation) {
        currentFailure.location = `${stackLocation[1]}:${stackLocation[2]}:${stackLocation[3]}`;
        continue;
      }
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
    errors: failures.slice(0, 10).map(f => {
      // Parse line:column from end of location string (file paths may contain colons)
      let line: number | undefined;
      let column: number | undefined;
      if (f.location) {
        const parts = f.location.split(':');
        column = parseInt(parts.pop() || '');
        line = parseInt(parts.pop() || '');
      }

      return {
        file: f.file,
        line: line !== undefined && !isNaN(line) ? line : undefined,
        column: column !== undefined && !isNaN(column) ? column : undefined,
        message: f.errorMessage || `Test failure: ${f.testHierarchy}`
      };
    }),
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
