/**
 * Vitest/Jest Error Extractor
 *
 * Parses and formats Vitest (and Jest) test failure output for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, ExtractionMetadata } from './types.js';
import { MAX_ERRORS_IN_ARRAY } from './result-schema.js';

/**
 * Options for error extraction
 */
export interface ExtractorOptions {
  /** Include quality metadata and suggestions for improving extraction */
  developerFeedback?: boolean;
}

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
  hasFormat2: boolean
): Partial<TestFailure> | null {
  // Match Format 1: FAIL file.test.ts > test hierarchy
  // BUT: Skip if we've seen Format 2 headers (to avoid processing duplicate FAIL lines)
  const format1Match = !hasFormat2 && /(?:FAIL|❌|×)\s+([^\s]+\.test\.ts)\s*>\s*(.+)/.exec(line);
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
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Vitest test framework output (controlled output), limited line length
  const format2Match = /(?:×)\s+(.+?)(?:\s+\d+ms)?$/.exec(line);
  if (format2Match && currentFile) {
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

      return parts.filter(p => p).join('\n');
    })
    .join('\n\n');
}

/**
 * Generate LLM-friendly guidance based on failures
 *
 * @param failureCount - Number of failures
 * @param expected - Expected value (if present)
 * @param actual - Actual value (if present)
 * @returns Guidance text
 *
 * @internal
 */
function generateGuidanceText(
  failureCount: number,
  expected?: string,
  actual?: string
): string {
  let guidance = `${failureCount} test(s) failed. `;
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
 * Extract runtime errors (Unhandled Rejection, ENOENT, etc.)
 *
 * @param output - Full test output
 * @returns Test failure object if runtime error found
 */
function extractRuntimeError(output: string): TestFailure | null {
  // Look for "Unhandled Rejection" section
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Vitest test framework runtime errors (controlled output), not user input
  const unhandledMatch = /⎯+\s*Unhandled Rejection\s*⎯+\s*\n\s*(Error:[^\n]+(?:\n\s*[^\n❯⎯]+)?)/.exec(output);
  if (!unhandledMatch) {
    return null;
  }

  // Error message may span multiple lines (e.g., path on next line)
  const errorMessage = unhandledMatch[1].trim().replace(/\n\s+/g, ' ');

  // Extract location from stack trace (❯ function file:line:col)
  // File path may contain colons (e.g., node:internal/fs/promises), so match ❯ function filepath:number:number
  const locationMatch = /❯\s+\S+\s+([\w:/.]+):(\d+):(\d+)/.exec(output);
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
 * @param options - Extraction options (e.g., developerFeedback for quality metadata)
 * @returns Structured error information with test-specific guidance
 *
 * @example
 * ```typescript
 * const result = extractVitestErrors(vitestOutput);
 * console.log(result.summary); // "3 test failure(s)"
 * console.log(result.guidance); // "Fix each failing test individually..."
 * ```
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 29 acceptable for Vitest output parsing (down from 97) - main parsing loop coordinates multiple format detection and state tracking
export function extractVitestErrors(
  output: string,
  options?: ExtractorOptions
): ErrorExtractorResult {
  const lines = output.split('\n');
  const failures: TestFailure[] = [];
  let currentFailure: Partial<TestFailure> | null = null;
  let currentFile = ''; // Track file from ❯ lines for Format 2
  let hasFormat2 = false; // Track if we found Format 2 file headers

  // First, check for runtime errors (Unhandled Rejection, ENOENT, etc.)
  const runtimeError = extractRuntimeError(output);
  if (runtimeError) {
    failures.push(runtimeError);
  }

  // Check for coverage threshold failures
  const coverageError = extractCoverageThresholdError(output);
  if (coverageError) {
    failures.push(coverageError);
  }

  let i = -1;
  while (i < lines.length - 1) {
    i++; // Increment at start so 'continue' statements don't bypass it
    const line = lines[i];

    // Check for Format 2 file header
    const fileHeaderMatch = /❯\s+([^\s]+\.test\.ts)\s+\(/.exec(line);
    if (fileHeaderMatch) {
      currentFile = fileHeaderMatch[1];
      hasFormat2 = true;
      continue;
    }

    // Try to parse as failure line (Format 1 or Format 2)
    const parsedFailure = parseFailureLine(line, currentFile, hasFormat2);
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

  // Extract expected/actual values and format output
  const { expected, actual } = extractExpectedActual(output);
  const errorSummary = formatFailuresOutput(failures, expected, actual);
  const guidance = generateGuidanceText(failures.length, expected, actual);

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

  // Add quality metadata if developer feedback enabled
  if (options?.developerFeedback) {
    result.metadata = calculateExtractionQuality(failures, options);
  }

  return result;
}

/**
 * Calculate extraction quality metadata
 *
 * Reports what the extractor knows about its own extraction quality.
 * Does NOT know expected count - test infrastructure does the comparison.
 *
 * @param failures - Extracted test failures
 * @param options - Extractor options
 * @returns Quality metadata
 */
function calculateExtractionQuality(
  failures: TestFailure[],
  options: ExtractorOptions
): ExtractionMetadata {
  const withFile = failures.filter(f => f.file && f.file !== 'unknown').length;
  const withLocation = failures.filter(f => f.location).length;
  const withMessage = failures.filter(f => f.errorMessage).length;

  // Completeness: percentage with file + location + message
  const complete = failures.filter(
    f => f.file && f.file !== 'unknown' && f.location && f.errorMessage
  ).length;
  const completeness = failures.length > 0
    ? Math.round((complete / failures.length) * 100)
    : 100;

  // Confidence: based on how well patterns matched
  // High confidence if most failures have complete data
  let confidence: number;
  if (completeness >= 80) {
    confidence = 90;
  } else if (completeness >= 50) {
    confidence = 70;
  } else {
    confidence = 50;
  }

  // Issues encountered
  const issues: string[] = [];
  if (withFile < failures.length) {
    issues.push(`${failures.length - withFile} failure(s) missing file path`);
  }
  if (withLocation < failures.length) {
    issues.push(`${failures.length - withLocation} failure(s) missing line numbers`);
  }
  if (withMessage < failures.length) {
    issues.push(`${failures.length - withMessage} failure(s) missing error messages`);
  }

  // Suggestions (only if developer feedback enabled)
  const suggestions: string[] = [];
  if (options.developerFeedback) {
    if (completeness < 80) {
      suggestions.push('Try running Vitest with --reporter=verbose for more complete output');
    }
    if (failures.length > 20) {
      suggestions.push(`Extracted ${failures.length} failures - verify this matches actual test output`);
    }
  }

  return {
    confidence,
    completeness,
    issues,
    ...(suggestions.length > 0 && { suggestions })
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
