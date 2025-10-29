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
 * Result of processing a single output line
 */
interface ProcessLineResult {
  failure?: JestFailure;
  newFile?: string;
  newSuite?: { name: string; indent: number };
}

/**
 * Match FAIL line and extract file path
 */
function matchFailLine(line: string): string | null {
  const failMatch = /^\s*FAIL\s+(?:[\w-]+\s+)?([\w/-]+\.test\.\w+)/.exec(line);
  return failMatch ? failMatch[1] : null;
}

/**
 * Match inline failure (✕) and extract test name
 */
function matchInlineFailure(line: string): string | null {
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Jest test framework output (controlled output), not user input
  const failureMatch = /^\s+✕\s+(.+?)(?:\s+\(\d+\s*ms\))?$/.exec(line);
  return failureMatch ? failureMatch[1].trim() : null;
}

/**
 * Match detailed test format (●) and extract hierarchy
 */
function matchDetailedTest(line: string): string | null {
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Jest test framework output (controlled output), not user input
  const detailedTestMatch = /^\s*●\s+(.+)$/.exec(line);
  return detailedTestMatch ? detailedTestMatch[1].trim() : null;
}

/**
 * Match test suite line and extract suite info
 */
function matchSuiteLine(line: string): { name: string; indent: number } | null {
  const suiteMatch = /^\s+([A-Z][\w\s›-]+)$/.exec(line);
  if (!suiteMatch || line.includes('✕') || line.includes('✓') || line.includes('ms)')) {
    return null;
  }
  const indentMatch = /^(\s*)/.exec(line);
  const indent = indentMatch ? indentMatch[1].length : 0;
  return { name: suiteMatch[1].trim(), indent };
}

/**
 * Adjust hierarchy stack based on indentation level
 */
function adjustHierarchyForIndent(hierarchyStack: string[], indent: number): void {
  while (hierarchyStack.length > 0 && indent <= hierarchyStack.length * 2) {
    hierarchyStack.pop();
  }
}

/**
 * Process a single line of Jest output
 */
function processLine(
  line: string,
  currentFile: string,
  hierarchyStack: string[]
): ProcessLineResult {
  const result: ProcessLineResult = {};

  // Check for FAIL line
  const newFile = matchFailLine(line);
  if (newFile) {
    result.newFile = newFile;
    return result;
  }

  // Skip lines before we have a file
  if (!currentFile) {
    return result;
  }

  // Check for inline failure (✕)
  const inlineTest = matchInlineFailure(line);
  if (inlineTest) {
    const fullHierarchy = hierarchyStack.length > 0
      ? [...hierarchyStack, inlineTest].join(' › ')
      : inlineTest;
    result.failure = {
      file: currentFile,
      location: currentFile,
      testHierarchy: fullHierarchy,
      errorMessage: 'Test failed'
    };
    return result;
  }

  // Check for detailed test format (●)
  const detailedHierarchy = matchDetailedTest(line);
  if (detailedHierarchy) {
    result.failure = {
      file: currentFile,
      location: currentFile,
      testHierarchy: detailedHierarchy,
      errorMessage: 'Test failed'
    };
    return result;
  }

  // Check for suite line
  const suiteInfo = matchSuiteLine(line);
  if (suiteInfo) {
    result.newSuite = suiteInfo;
  }

  return result;
}

/**
 * Format failures into clean output string
 */
function formatJestFailures(failures: JestFailure[]): string {
  const cleanOutputLines: string[] = [];
  for (const failure of failures) {
    cleanOutputLines.push(`● ${failure.testHierarchy}`);
    cleanOutputLines.push(`  ${failure.errorMessage}`);
    cleanOutputLines.push(`  Location: ${failure.location}`);
    cleanOutputLines.push('');
  }
  return cleanOutputLines.join('\n');
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
  const hierarchyStack: string[] = [];

  for (const line of lines) {
    const result = processLine(line, currentFile, hierarchyStack);

    if (result.newFile) {
      currentFile = result.newFile;
      hierarchyStack.length = 0;
      continue;
    }

    if (result.failure) {
      failures.push(result.failure);
      continue;
    }

    if (result.newSuite) {
      adjustHierarchyForIndent(hierarchyStack, result.newSuite.indent);
      hierarchyStack.push(result.newSuite.name);
    }
  }

  // Build formatted errors
  const errors = failures.map(f => ({
    file: f.file,
    line: Number.parseInt(f.location.split(':')[1] || '0'),
    column: Number.parseInt(f.location.split(':')[2] || '0'),
    message: `${f.testHierarchy}: ${f.errorMessage}`,
    severity: 'error' as const
  }));

  const summary = failures.length > 0
    ? `${failures.length} test failure(s)`
    : 'No test failures detected';

  const guidance = failures.length > 0
    ? 'Fix each failing test individually. Check test setup, mocks, and assertions.'
    : '';

  return {
    errors,
    summary,
    totalCount: failures.length,
    guidance,
    cleanOutput: formatJestFailures(failures)
  };
}
