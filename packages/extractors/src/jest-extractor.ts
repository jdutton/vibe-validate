/**
 * Jest Error Extractor
 *
 * Parses and formats Jest test failure output for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult } from './types.js';

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
  // Note: ANSI codes are stripped centrally in smart-extractor.ts
  const lines = output.split('\n');
  const failures: JestFailure[] = [];

  let currentFile = '';
  const hierarchyStack: string[] = []; // Track test suite hierarchy by indentation

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: FAIL test/integration/extraction-with-mocks.test.ts
    // OR: FAIL project-name tests/jest/comprehensive-failures.test.ts
    // OR:   FAIL extraction-test-bed tests/jest/comprehensive-failures.test.ts (with leading spaces)
    const failMatch = /^\s*FAIL\s+(?:[\w-]+\s+)?([\w/-]+\.test\.\w+)/.exec(line);
    if (failMatch) {
      currentFile = failMatch[1];
      hierarchyStack.length = 0; // Reset hierarchy for new file
      continue;
    }

    if (!currentFile) continue; // Skip lines before FAIL

    // Calculate indentation level (number of leading spaces)
    const indentMatch = /^(\s*)/.exec(line);
    const indent = indentMatch ? indentMatch[1].length : 0;

    // Match: ✕ test name (6 ms) - inline failure
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Jest test framework output (controlled output), not user input
    const failureMatch = /^\s+✕\s+(.+?)(?:\s+\(\d+\s*ms\))?$/.exec(line);
    if (failureMatch) {
      const testName = failureMatch[1].trim();

      // Build full hierarchy: parent suites + test name
      const fullHierarchy = hierarchyStack.length > 0
        ? [...hierarchyStack, testName].join(' › ')
        : testName;

      failures.push({
        file: currentFile,
        location: currentFile,
        testHierarchy: fullHierarchy,
        errorMessage: 'Test failed'
      });
      continue;
    }

    // Match: ● TestSuite › Sub Suite › test name (detailed error format)
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Jest test framework output (controlled output), not user input
    const detailedTestMatch = /^\s*●\s+(.+)$/.exec(line);
    if (detailedTestMatch) {
      const fullHierarchy = detailedTestMatch[1].trim();
      failures.push({
        file: currentFile,
        location: currentFile,
        testHierarchy: fullHierarchy,
        errorMessage: 'Test failed'
      });
      continue;
    }

    // Track test suite hierarchy (lines that are just text, no symbols)
    // These are describe blocks like "Vibe-Validate Integration Failures"
    const suiteMatch = /^\s+([A-Z][\w\s›-]+)$/.exec(line);
    if (suiteMatch && !line.includes('✕') && !line.includes('✓') && !line.includes('ms)')) {
      const suiteName = suiteMatch[1].trim();

      // Adjust hierarchy stack based on indentation
      // If indent decreased, pop suites until we're at the right level
      while (hierarchyStack.length > 0 && indent <= hierarchyStack.length * 2) {
        hierarchyStack.pop();
      }

      // Add this suite to the stack
      hierarchyStack.push(suiteName);
    }
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
