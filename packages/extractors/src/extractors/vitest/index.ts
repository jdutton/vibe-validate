/**
 * Vitest/Jest Error Extractor Plugin
 *
 * Parses and formats Vitest (and Jest) test failure output for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import { MAX_ERRORS_IN_ARRAY } from '../../result-schema.js';
import type {
  ExtractorPlugin,
  ErrorExtractorResult,
  DetectionResult,
  ExtractorSample,
} from '../../types.js';

interface TestFailure {
  file: string;
  location: string;
  testHierarchy: string;
  errorMessage: string;
  sourceLine: string;
}

/**
 * Parse failure line to determine format and extract initial data
 *
 * @param line - Current line being parsed
 * @param currentFile - File path from Format 2 header
 * @param hasFormat2 - Whether Format 2 has been detected
 * @returns Partial failure object or null if no match
 *
 * @internal
 */
function parseFailureLine(
  line: string,
  currentFile: string,
  hasFormat2: boolean,
  inDetailSection: boolean
): Partial<TestFailure> | null {
  // Match Format 1: FAIL/❌/× file.test.ts > test hierarchy
  // When marker has explicit file path (Format 1), always parse - not a summary line
  const format1Match = /(?:FAIL|❌|×)\s+([^\s]+\.test\.ts)\s*>\s*(.+)/.exec(line);
  if (format1Match) {
    return {
      file: format1Match[1],
      testHierarchy: format1Match[2].trim(),
      errorMessage: '',
      sourceLine: '',
      location: ''
    };
  }

  // Match Format 2: × test hierarchy (without file path)
  // Skip × lines in summary section (before "Failed Tests" separator) - they lack location markers
  // Only process × lines if we're in detail section OR no FAIL lines exist
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Vitest test framework output (controlled output), limited line length
  const format2Match = /(?:×)\s+(.+?)(?:\s+\d+ms)?$/.exec(line);
  if (format2Match && currentFile && inDetailSection) {
    return {
      file: currentFile,
      testHierarchy: format2Match[1].trim(),
      errorMessage: '',
      sourceLine: '',
      location: ''
    };
  }

  return null;
}

/**
 * Extract initial error message from line
 *
 * @param line - Line to extract error from
 * @returns Extracted error message
 *
 * @internal
 */
function extractErrorMessage(line: string): string {
  const errorMatch = /((?:AssertionError|Error):\s*.+)/.exec(line);
  if (errorMatch) {
    return errorMatch[1].trim();
  }

  const format2ErrorMatch = /→\s+(.+)/.exec(line);
  if (format2ErrorMatch) {
    return format2ErrorMatch[1].trim();
  }

  return line.trim();
}

/**
 * Check if line is a stop marker for error continuation
 *
 * @param line - Trimmed line to check
 * @returns True if this line marks end of error message
 *
 * @internal
 */
function isStopMarker(line: string): boolean {
  return (
    line.startsWith('❯') ||
    /^\d+\|/.test(line) ||
    line.startsWith('FAIL') ||
    line.startsWith('✓') ||
    line.startsWith('❌') ||
    line.startsWith('×') ||
    line.startsWith('⎯') ||
    line.startsWith('at ')
  );
}

/**
 * Append continuation line to error message
 *
 * @param errorMessage - Current error message
 * @param line - Raw line (with indentation)
 * @param trimmedLine - Trimmed version of line
 * @param isSnapshotError - Whether handling snapshot error
 * @returns Updated error message
 *
 * @internal
 */
function appendContinuationLine(
  errorMessage: string,
  line: string,
  trimmedLine: string,
  isSnapshotError: boolean
): string {
  if (isSnapshotError) {
    return errorMessage + '\n' + line; // Preserve indentation for diffs
  }
  return errorMessage + ' ' + trimmedLine; // Compact for normal errors
}

/**
 * Handle truncation logic for non-snapshot errors
 *
 * @param errorMessage - Current error message
 * @param nextLine - Next trimmed line
 * @param isSnapshotError - Whether handling snapshot error
 * @param linesConsumed - Number of lines consumed so far
 * @param maxLines - Maximum continuation lines allowed
 * @returns Object with updated message and whether to stop
 *
 * @internal
 */
function handleTruncation(
  errorMessage: string,
  nextLine: string,
  isSnapshotError: boolean,
  linesConsumed: number,
  maxLines: number
): { errorMessage: string; shouldStop: boolean } {
  if (isSnapshotError || linesConsumed < maxLines) {
    return { errorMessage, shouldStop: false };
  }

  const updatedMessage = nextLine ? errorMessage + ' ...(truncated)' : errorMessage;
  return { errorMessage: updatedMessage, shouldStop: true };
}

/**
 * Parse error message with continuation line handling
 *
 * @param lines - All output lines
 * @param startIndex - Index where error message starts
 * @param isSnapshotError - Whether this is a snapshot error (different continuation rules)
 * @returns Error message and index of last consumed line
 *
 * @internal
 */
function parseErrorMessage(
  lines: string[],
  startIndex: number,
  isSnapshotError: boolean
): { errorMessage: string; lastIndex: number } {
  let errorMessage = extractErrorMessage(lines[startIndex]);

  const MAX_CONTINUATION_LINES = 5;
  let j = startIndex + 1;
  let linesConsumed = 0;

  while (j < lines.length) {
    const nextLine = lines[j].trim();

    if (isStopMarker(nextLine)) {
      break;
    }

    // Check truncation limit for non-snapshot errors
    const truncation = handleTruncation(errorMessage, nextLine, isSnapshotError, linesConsumed, MAX_CONTINUATION_LINES);
    if (truncation.shouldStop) {
      errorMessage = truncation.errorMessage;
      break;
    }

    // For non-snapshot errors, stop at blank lines
    if (!nextLine && !isSnapshotError) {
      break;
    }

    // Add line to error message
    if (nextLine || isSnapshotError) {
      errorMessage = appendContinuationLine(errorMessage, lines[j], nextLine, isSnapshotError);
      if (!isSnapshotError) {
        linesConsumed++;
      }
    }
    j++;
  }

  return { errorMessage, lastIndex: j - 1 };
}

/**
 * Parse location from vitest marker or stack trace
 *
 * @param line - Line to parse
 * @returns Location string (file:line:column) or null
 *
 * @internal
 */
function parseLocation(line: string): string | null {
  // Try vitest location marker first
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Vitest test framework location markers (controlled output), not user input
  const vitestLocation = /❯\s*(.+\.test\.ts):(\d+):(\d+)/.exec(line);
  if (vitestLocation) {
    return `${vitestLocation[1]}:${vitestLocation[2]}:${vitestLocation[3]}`;
  }

  // Try stack trace pattern
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Vitest test framework stack traces (controlled output), not user input
  const stackLocation = /at\s+.+\(([^\s]+\.test\.ts):(\d+):(\d+)\)/.exec(line);
  if (stackLocation) {
    return `${stackLocation[1]}:${stackLocation[2]}:${stackLocation[3]}`;
  }

  return null;
}

/**
 * Format failures into clean output
 *
 * @param failures - Extracted test failures
 * @param expected - Expected value (if present)
 * @param actual - Actual value (if present)
 * @returns Formatted output string
 *
 * @internal
 */
function formatFailuresOutput(
  failures: TestFailure[],
  expected?: string,
  actual?: string
): string {
  return failures
    .slice(0, MAX_ERRORS_IN_ARRAY)
    .map((f, idx) => {
      const parts = [
        `[Test ${idx + 1}/${failures.length}] ${f.location ?? f.file}`,
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

      return parts.filter(Boolean).join('\n');
    })
    .join('\n\n');
}

/**
 * Generate LLM-friendly guidance based on failures
 *
 * @param failureCount - Number of failures
 * @param expected - Expected value (if present)
 * @param actual - Actual value (if present)
 * @param hasTimeout - Whether any failures are due to timeout
 * @returns Guidance text
 *
 * @internal
 */
function generateGuidanceText(
  failureCount: number,
  expected?: string,
  actual?: string,
  hasTimeout?: boolean
): string {
  let guidance = `${failureCount} test(s) failed. `;

  // Timeout-specific guidance
  if (hasTimeout) {
    guidance += 'Test(s) timed out. ';
    if (failureCount === 1) {
      guidance += 'Options: 1) Increase timeout with test.timeout() or testTimeout config, ';
      guidance += '2) Optimize test to run faster, ';
      guidance += '3) Mock slow operations (API calls, file I/O, child processes). ';
    } else {
      guidance += 'Multiple tests timing out suggests resource constraints. ';
      guidance += 'Try: 1) Run tests individually to identify slow tests, ';
      guidance += '2) Increase testTimeout config, ';
      guidance += '3) Reduce parallel test workers (--pool-workers=2). ';
    }
    guidance += 'Run: npm test -- <test-file> to verify the fix.';
    return guidance;
  }

  // Standard assertion failure guidance
  if (failureCount === 1) {
    guidance += 'Fix the assertion in the test file at the location shown. ';
    if (expected && actual) {
      guidance += `The test expected "${expected}" but got "${actual}". `;
    }
    guidance += 'Run: npm test -- <test-file> to verify the fix.';
  } else {
    guidance += 'Fix each failing test individually. Run: npm test -- <test-file> to test each file.';
  }
  return guidance;
}

/**
 * Extract location from unhandled rejection stack trace
 * Prefers user code locations over node:internal
 *
 * @param section - Unhandled rejection section text
 * @returns File path and location string
 *
 * @internal
 */
function extractRejectionLocation(section: string): { file: string; location: string } {
  const lines = section.split('\n');
  let file = 'unknown';
  let location = '';
  let fallbackFile = '';
  let fallbackLocation = '';

  for (const line of lines) {
    // Match ❯ marker with location (file path may contain colons, dashes, dots, slashes)
    const locationMatch = /❯\s+\S+\s+([\w:/.@-]+):(\d+):(\d+)/.exec(line);
    if (locationMatch) {
      const filepath = locationMatch[1];
      const loc = `${filepath}:${locationMatch[2]}:${locationMatch[3]}`;

      // Prefer user code locations over node:internal
      if (!filepath.startsWith('node:internal')) {
        file = filepath;
        location = loc;
        break;
      } else if (!fallbackFile) {
        // Save first node:internal location as fallback
        fallbackFile = filepath;
        fallbackLocation = loc;
      }
    }
  }

  // Use fallback if no user code location found
  if (file === 'unknown' && fallbackFile) {
    file = fallbackFile;
    location = fallbackLocation;
  }

  return { file, location };
}

/**
 * Extract runtime errors (Unhandled Rejection, ENOENT, etc.)
 *
 * @param output - Full test output
 * @returns Array of test failure objects for all runtime errors found
 */
function extractRuntimeErrors(output: string): TestFailure[] {
  const failures: TestFailure[] = [];

  // Split output by unhandled rejection markers to find all occurrences
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Vitest test framework section headers (controlled output), limited line length
  const rejectionSections = output.split(/⎯+\s*Unhandled Rejection\s*⎯+/);

  // Skip first section (before any rejection markers)
  for (let i = 1; i < rejectionSections.length; i++) {
    const section = rejectionSections[i];

    // Extract error type and message (first non-empty line)
    // Match patterns like: "TypeError: message", "Error: message", "ReferenceError: message"
    const errorMatch = /^\s*((?:Type|Reference|Range|Syntax)?Error:[^\n]+(?:\n\s*[^\n❯⎯]+)?)/.exec(section);
    if (!errorMatch) {
      continue;
    }

    // Error message may span multiple lines (e.g., path on next line)
    const errorMessage = errorMatch[1].trim().replaceAll(/\n\s+/g, ' ');

    // Extract location from stack trace
    const { file, location } = extractRejectionLocation(section);

    failures.push({
      file,
      location,
      testHierarchy: 'Runtime Error',
      errorMessage,
      sourceLine: ''
    });
  }

  return failures;
}

/**
 * Extract coverage threshold failures
 *
 * @param output - Full test output
 * @returns Test failure object if coverage threshold error found
 */
function extractCoverageThresholdError(output: string): TestFailure | null {
  // Look for: "ERROR: Coverage for functions (86.47%) does not meet global threshold (87%)"
  const coverageMatch = /ERROR:\s+Coverage for (\w+) \(([\d.]+)%\) does not meet (?:global )?threshold \(([\d.]+)%\)/.exec(output);
  if (!coverageMatch) {
    return null;
  }

  const [, metric, actual, expected] = coverageMatch;

  return {
    file: 'vitest.config.ts',
    location: '',
    testHierarchy: 'Coverage Threshold',
    errorMessage: `Coverage for ${metric} (${actual}%) does not meet threshold (${expected}%)`,
    sourceLine: ''
  };
}

/**
 * Extract Vitest worker timeout errors
 *
 * These occur when Vitest worker threads timeout during test execution,
 * often due to system resource constraints or competing processes.
 *
 * @param output - Full test output
 * @returns Test failure object if worker timeout error found
 */
function extractVitestWorkerTimeoutError(output: string): TestFailure | null {
  // Look for: "⎯⎯⎯⎯⎯⎯ Unhandled Error(s) ⎯⎯⎯⎯⎯⎯⎯\nError: [vitest-worker]: Timeout calling..."
  // Handles both singular "Unhandled Error" and plural "Unhandled Errors"
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Vitest test framework error output (controlled output), not user input
  const timeoutMatch = /⎯+\s*Unhandled Errors?\s*⎯+\s*\n\s*Error:\s*\[vitest-worker\]:\s*(Timeout[^\n]+)/.exec(output);
  if (!timeoutMatch) {
    return null;
  }

  const errorMessage = timeoutMatch[1].trim();

  return {
    file: 'vitest.config.ts',
    location: '',
    testHierarchy: 'Vitest Worker Timeout',
    errorMessage: `${errorMessage}. This is usually caused by system resource constraints or competing processes. Try: 1) Kill background processes, 2) Reduce --pool-workers, 3) Increase --test-timeout`,
    sourceLine: ''
  };
}

/**
 * Extract expected/actual values from test output
 *
 * @param output - Full test output
 * @returns Expected and actual values (if found)
 */
function extractExpectedActual(fullOutput: string): { expected?: string; actual?: string } {
  const expectedMatch = /- Expected[^\n]*\n[^\n]*\n- (.+)/.exec(fullOutput);
  const actualMatch = /\+ Received[^\n]*\n[^\n]*\n\+ (.+)/.exec(fullOutput);
  return {
    expected: expectedMatch ? expectedMatch[1].trim() : undefined,
    actual: actualMatch ? actualMatch[1].trim() : undefined
  };
}

/**
 * Extract Vitest test failures from output
 *
 * @param output - Raw Vitest/Jest command output
 * @returns Structured error information with test-specific guidance
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 29 acceptable for Vitest output parsing (down from 97) - main parsing loop coordinates multiple format detection and state tracking
function extract(output: string): ErrorExtractorResult {
  const lines = output.split('\n');
  const failures: TestFailure[] = [];
  let currentFailure: Partial<TestFailure> | null = null;
  let currentFile = ''; // Track file from ❯ lines for Format 2
  let hasFormat2 = false; // Track if we found Format 2 file headers
  let inDetailSection = false; // Track if we're past summary section (after "Failed Tests" separator)

  // First, check for runtime errors (Unhandled Rejection, ENOENT, etc.)
  const runtimeErrors = extractRuntimeErrors(output);
  failures.push(...runtimeErrors);

  // Check for coverage threshold failures
  const coverageError = extractCoverageThresholdError(output);
  if (coverageError) {
    failures.push(coverageError);
  }

  // Check for Vitest worker timeout errors
  const timeoutError = extractVitestWorkerTimeoutError(output);
  if (timeoutError) {
    failures.push(timeoutError);
  }

  let i = -1;
  while (i < lines.length - 1) {
    i++; // Increment at start so 'continue' statements don't bypass it
    const line = lines[i];

    // Detect entry into detail section (after summary)
    // "Failed Tests" separator or first "FAIL" line marks start of detailed output
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Vitest test framework section headers (controlled output), limited line length
    if (!inDetailSection && (/⎯+\s*Failed Tests/.test(line) || /^\s*FAIL\s+/.test(line))) {
      inDetailSection = true;
    }

    // Check for Format 2 file header
    const fileHeaderMatch = /❯\s+([^\s]+\.test\.ts)\s+\(/.exec(line);
    if (fileHeaderMatch) {
      currentFile = fileHeaderMatch[1];
      hasFormat2 = true;
      continue;
    }

    // Try to parse as failure line (Format 1 or Format 2)
    const parsedFailure = parseFailureLine(line, currentFile, hasFormat2, inDetailSection);
    if (parsedFailure) {
      if (currentFailure?.file) {
        failures.push(currentFailure as TestFailure);
      }
      currentFailure = parsedFailure;
      continue;
    }

    // Parse error message if we have a current failure
    if (currentFailure && !currentFailure.errorMessage) {
      const snapshotMatch = /Snapshot\s+`([^`]+)`\s+mismatched/.exec(line);
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Need to check truthy regex matches, not just null/undefined
      const hasError = /((?:AssertionError|Error):\s*.+)/.exec(line) || /→\s+(.+)/.exec(line) || snapshotMatch;

      if (hasError) {
        const isSnapshotError = !!snapshotMatch;
        const { errorMessage, lastIndex } = parseErrorMessage(lines, i, isSnapshotError);
        currentFailure.errorMessage = errorMessage;
        i = lastIndex;
      }
      continue;
    }

    // Parse location if we have a current failure
    if (currentFailure && !currentFailure.location) {
      const location = parseLocation(line);
      if (location) {
        currentFailure.location = location;
        continue;
      }
    }

    // Parse source line
    if (currentFailure && /^\s*\d+\|\s+/.exec(line)) {
      const sourceMatch = /^\s*(\d+)\|\s*(.+)/.exec(line);
      if (sourceMatch) {
        currentFailure.sourceLine = `${sourceMatch[1]}| ${sourceMatch[2].trim()}`;
      }
    }
  }

  // Add last failure
  if (currentFailure?.file) {
    failures.push(currentFailure as TestFailure);
  }

  // Detect timeout failures
  const hasTimeout = failures.some(f => f.errorMessage.includes('Test timed out'));

  // Extract expected/actual values and format output
  const { expected, actual } = extractExpectedActual(output);
  const errorSummary = formatFailuresOutput(failures, expected, actual);
  const guidance = generateGuidanceText(failures.length, expected, actual, hasTimeout);

  const result: ErrorExtractorResult = {
    errors: failures.slice(0, MAX_ERRORS_IN_ARRAY).map(f => {
      // Parse line:column from end of location string (file paths may contain colons)
      let line: number | undefined;
      let column: number | undefined;
      if (f.location) {
        const parts = f.location.split(':');
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Need to filter empty strings for parseInt, not just null/undefined
        column = Number.parseInt(parts.pop() || '');
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Need to filter empty strings for parseInt, not just null/undefined
        line = Number.parseInt(parts.pop() || '');
      }

      return {
        file: f.file,
        line: line !== undefined && !Number.isNaN(line) ? line : undefined,
        column: column !== undefined && !Number.isNaN(column) ? column : undefined,
        message: f.errorMessage
      };
    }),
    summary: `${failures.length} test failure(s)`,
    totalErrors: failures.length,
    guidance,
    errorSummary
  };

  return result;
}

/**
 * Detect if output is from Vitest or Jest
 *
 * @param output - Command output to analyze
 * @returns Detection result with confidence and patterns
 */
function detect(output: string): DetectionResult {
  // Look for Vitest-specific markers
  const vitestMarkers = [
    /FAIL\s+\S+\.test\.(ts|js)/, // FAIL test-file.test.ts
    /❯\s+\S+\.test\.(ts|js)/, // ❯ test-file.test.ts
    /×\s+[^❯]+/, // × test name (without file marker)
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Vitest test framework output (controlled output), limited input size
    /⎯+\s*Unhandled/, // Unhandled errors section
  ];

  const patterns: string[] = [];
  let matchCount = 0;

  for (const marker of vitestMarkers) {
    if (marker.test(output)) {
      matchCount++;
      patterns.push(marker.source);
    }
  }

  if (matchCount >= 2) {
    return {
      confidence: 90,
      patterns,
      reason: 'Multiple Vitest/Jest test failure patterns detected',
    };
  }

  if (matchCount === 1) {
    return {
      confidence: 70,
      patterns,
      reason: 'Single Vitest/Jest test failure pattern detected',
    };
  }

  return { confidence: 0, patterns: [], reason: '' };
}

/**
 * Sample test cases for Vitest extractor
 */
const samples: ExtractorSample[] = [
  {
    name: 'single-test-failure',
    description: 'Single Vitest test failure with assertion error',
    input: `FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > should parse HTTP_PORT
AssertionError: expected 3000 to be 9999 // Object.is equality
 ❯ test/unit/config/environment.test.ts:57:30
   57|     expect(config.HTTP_PORT).toBe(9999);`,
    expectedErrors: 1,
    expectedPatterns: ['FAIL', 'AssertionError', '❯'],
  },
  {
    name: 'multiple-test-failures',
    description: 'Multiple Vitest test failures across different files',
    input: `FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test 1
AssertionError: expected 3000 to be 9999
 ❯ test/unit/config/environment.test.ts:57:30

FAIL  test/unit/auth/factory.test.ts > AuthFactory > test 2
Error: Cannot create auth provider
 ❯ test/unit/auth/factory.test.ts:100:15`,
    expectedErrors: 2,
    expectedPatterns: ['FAIL', 'AssertionError', 'Error'],
  },
  {
    name: 'coverage-threshold-failure',
    description: 'Coverage threshold not met',
    input: `Test Files  1139 passed (1139)
     Tests  1139 passed (1139)

ERROR: Coverage for functions (86.47%) does not meet global threshold (87%)`,
    expectedErrors: 1,
    expectedPatterns: ['Coverage', 'threshold'],
  },
];

/**
 * Vitest/Jest Error Extractor Plugin
 *
 * Extracts Vitest and Jest test failures with high confidence (90%).
 * Supports multiple output formats and special error types (runtime, coverage, worker timeouts).
 */
const vitestPlugin: ExtractorPlugin = {
  metadata: {
    name: 'vitest',
    version: '1.0.0',
    author: 'vibe-validate',
    description: 'Extracts Vitest and Jest test failures',
    repository: 'https://github.com/jdutton/vibe-validate',
    tags: ['vitest', 'jest', 'testing', 'test-failures'],
  },
  hints: {
    required: [],
    anyOf: ['FAIL', 'test.ts', 'test.js', '❯', '×'],
  },
  priority: 85,
  detect,
  extract,
  samples,
};

export default vitestPlugin;
