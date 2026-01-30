/**
 * Jest Error Extractor Plugin
 *
 * Parses and formats Jest test failure output for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import { MAX_ERRORS_IN_ARRAY } from '../../result-schema.js';
import type {
  ExtractorPlugin,
  ErrorExtractorResult,
  FormattedError,
  DetectionResult,
  ExtractorSample,
} from '../../types.js';

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
  // eslint-disable-next-line security/detect-unsafe-regex -- Safe: only parses Jest test framework output (controlled output), not user input
  const failMatch = /^\s*FAIL\s+(?:[\w-]+\s+)?([\w/-]+\.test\.\w+)/.exec(line);
  return failMatch ? failMatch[1] : null;
}

/**
 * Match inline failure (✕) and extract test name
 */
function matchInlineFailure(line: string): string | null {
  // eslint-disable-next-line sonarjs/slow-regex, security/detect-unsafe-regex -- Safe: only parses Jest test framework output (controlled output), not user input
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
 * Pops from stack when indent indicates we're at same or higher level
 */
function adjustHierarchyForIndent(hierarchyStack: string[], indent: number): void {
  // Calculate expected indent for next level: 2 spaces per level (starting at 2)
  // Level 0 (empty stack) → expect indent 2
  // Level 1 (1 item) → expect indent 4
  // Level 2 (2 items) → expect indent 6
  const expectedIndent = (hierarchyStack.length + 1) * 2;

  // Pop while we're not at the right level
  // If indent < expectedIndent, we've moved to a higher level (less indented)
  while (hierarchyStack.length > 0 && indent < expectedIndent) {
    hierarchyStack.pop();
    // Recalculate for next iteration
    const newExpectedIndent = (hierarchyStack.length + 1) * 2;
    if (indent === newExpectedIndent) {
      break;
    }
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
    // Adjust hierarchy based on test indentation
    const indentMatch = /^(\s*)/.exec(line);
    const indent = indentMatch ? indentMatch[1].length : 0;
    adjustHierarchyForIndent(hierarchyStack, indent);

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
  const errorSummaryLines: string[] = [];
  for (const failure of failures) {
    errorSummaryLines.push(
      `● ${failure.testHierarchy}`,
      `  ${failure.errorMessage}`,
      `  Location: ${failure.location}`,
      ''
    );
  }
  return errorSummaryLines.join('\n');
}

/**
 * Extract Jest test failures from output
 *
 * @param output - Raw Jest command output
 * @returns Structured error information with test-specific guidance
 */
function extract(output: string): ErrorExtractorResult {
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

  // Build formatted errors (limit to MAX_ERRORS_IN_ARRAY)
  const errors: FormattedError[] = failures.slice(0, MAX_ERRORS_IN_ARRAY).map(f => {
    const locationParts = f.location.split(':');
    const lineNum = Number.parseInt(locationParts[1] || '');
    const colNum = Number.parseInt(locationParts[2] || '');

    return {
      file: f.file,
      line: lineNum > 0 ? lineNum : undefined,
      column: colNum > 0 ? colNum : undefined,
      message: `${f.testHierarchy}: ${f.errorMessage}`,
      severity: 'error' as const
    };
  });

  const summary = failures.length > 0
    ? `${failures.length} test failure(s)`
    : 'No test failures detected';

  const guidance = failures.length > 0
    ? 'Fix each failing test individually. Check test setup, mocks, and assertions.'
    : '';

  return {
    errors,
    summary,
    totalErrors: failures.length,
    guidance,
    errorSummary: formatJestFailures(failures.slice(0, MAX_ERRORS_IN_ARRAY))
  };
}

/**
 * Detect if output is from Jest test runner
 *
 * @param output - Command output to analyze
 * @returns Detection result with confidence and patterns
 */
function detect(output: string): DetectionResult {
  // Check for Jest-specific patterns (multiline mode)
  // Optimized: Use [ \t]* instead of \s* to avoid backtracking on newlines
  const hasFailMarker = /^[ \t]*FAIL[ \t]+/m.test(output);
  const hasTestMarkers = /[✕✓]/.test(output);
  // Optimized: Use [ \t]* instead of \s* to avoid backtracking on newlines
  const hasDetailedMarker = /^[ \t]*●[ \t]+/m.test(output);

  if (hasFailMarker || (hasTestMarkers && hasDetailedMarker)) {
    return {
      confidence: 90,
      patterns: ['FAIL marker', 'test markers (✕/✓)', '● detailed format'],
      reason: 'Jest test framework output detected',
    };
  }

  // Lower confidence if only partial markers
  if (hasTestMarkers) {
    return {
      confidence: 50,
      patterns: ['test markers (✕/✓)'],
      reason: 'Possible Jest output (partial markers)',
    };
  }

  return { confidence: 0, patterns: [], reason: '' };
}

/**
 * Sample test cases for Jest extractor
 */
const samples: ExtractorSample[] = [
  {
    name: 'single-test-failure',
    description: 'Single Jest test failure with inline marker',
    input: `
 FAIL test/example.test.ts
  Example Suite
    ✕ should pass (15 ms)
    `.trim(),
    expectedErrors: 1,
    expectedPatterns: ['FAIL', 'Example Suite › should pass'],
  },
  {
    name: 'multiple-failures-with-hierarchy',
    description: 'Multiple test failures with nested describe blocks',
    input: `
 FAIL test/example.test.ts
  Example Suite
    Nested Suite
      ✕ test one (10 ms)
      ✕ test two (12 ms)
    `.trim(),
    expectedErrors: 2,
    expectedPatterns: ['Example Suite › Nested Suite › test one', 'Example Suite › Nested Suite › test two'],
  },
  {
    name: 'detailed-format',
    description: 'Jest output with detailed error format (●)',
    input: `
 FAIL test/example.test.ts
  ● Example Suite › should handle errors
    `.trim(),
    expectedErrors: 1,
    expectedPatterns: ['Example Suite › should handle errors'],
  },
];

/**
 * Jest Error Extractor Plugin
 *
 * Extracts Jest test failures with high confidence (90%).
 * Supports inline (✕) and detailed (●) failure formats.
 */
const jestPlugin: ExtractorPlugin = {
  metadata: {
    name: 'jest',
    version: '1.0.0',
    author: 'vibe-validate',
    description: 'Extracts Jest test framework errors',
    repository: 'https://github.com/jdutton/vibe-validate',
    tags: ['jest', 'testing', 'test-runner'],
  },
  hints: {
    required: [],
    anyOf: ['FAIL', '✕', '●'],
  },
  priority: 90,
  detect,
  extract,
  samples,
};

export default jestPlugin;
