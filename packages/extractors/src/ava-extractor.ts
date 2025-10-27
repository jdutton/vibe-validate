/**
 * Ava Error Extractor
 *
 * Parses Ava test output and formats failures for LLM consumption.
 * Supports Ava v6+ output format with Unicode symbols and clean error formatting.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, FormattedError, ExtractionMetadata } from './types.js';

/**
 * Extract errors from Ava test output
 *
 * @param output - Ava text output
 * @returns Structured error information
 *
 * @example
 * ```typescript
 * const avaOutput = execSync('ava tests/**\/*.test.js', { encoding: 'utf-8' });
 * const result = extractAvaErrors(avaOutput);
 * console.log(result.summary); // "5 test(s) failed"
 * ```
 */
export function extractAvaErrors(output: string): ErrorExtractorResult {
  // Note: ANSI codes are stripped centrally in smart-extractor.ts

  // Extract all failures using two-pass approach:
  // 1. Parse summary lines to get test names
  // 2. Parse detailed blocks to get file locations and messages
  const failures = extractFailures(output);

  if (failures.length === 0) {
    return {
      summary: '0 test(s) failed',
      errors: [],
      totalCount: 0,
      cleanOutput: '',
      guidance: '',
      metadata: {
        confidence: 100,
        completeness: 100,
        issues: []
      }
    };
  }

  const errors: FormattedError[] = [];
  let completeCount = 0;

  for (const failure of failures) {
    const file = failure.file || 'unknown';
    // Use test name as fallback message if no explicit message extracted
    const message = failure.message || failure.testName || 'Test failed';
    const context = failure.testName || '';

    const isComplete = file !== 'unknown' && failure.line && message && message !== 'Test failed';
    if (isComplete) {
      completeCount++;
    }

    errors.push({
      file,
      line: failure.line,
      message,
      context,
      guidance: failure.guidance
    });
  }

  // Generate summary
  const summary = `${failures.length} test(s) failed`;

  // Generate guidance
  const guidance = generateGuidance(failures);

  // Calculate quality metadata
  const completeness = failures.length > 0 ? (completeCount / failures.length) * 100 : 100;
  const confidence = failures.length > 0 ? 90 : 100; // High confidence for Ava's structured output

  const metadata: ExtractionMetadata = {
    confidence,
    completeness,
    issues: []
  };

  return {
    summary,
    errors,
    totalCount: failures.length,
    cleanOutput: formatCleanOutput(errors),
    guidance,
    metadata
  };
}

/**
 * Failure information from Ava output
 */
interface FailureInfo {
  file?: string;
  line?: number;
  message?: string;
  testName?: string;
  errorType?: string;
  guidance?: string;
}

/**
 * Extract all failures from Ava output
 * Strategy: Find detailed headers (test names with ›), then parse each block
 */
function extractFailures(output: string): FailureInfo[] {
  const lines = output.split('\n');
  const failures: FailureInfo[] = [];

  // Find all detailed block headers (clean test names with ›)
  // These are the authoritative source - each one represents a failure
  const headerIndices: Array<{ index: number; testName: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Detailed header: has ›, not a summary, not a file:// line, not code, reasonable length
    if (trimmed.includes('›') &&
        !trimmed.includes('[fail]:') &&
        !trimmed.startsWith('›') &&
        !trimmed.includes('file://') &&
        !trimmed.match(/^\d+:/) &&
        !trimmed.match(/^Error/) &&
        !trimmed.includes('{') &&
        !trimmed.includes('}') &&
        trimmed.length > 10) {
      headerIndices.push({ index: i, testName: trimmed });
    }
  }

  // If we found detailed headers, parse each one
  if (headerIndices.length > 0) {
    for (const header of headerIndices) {
      const failure: FailureInfo = {
        testName: header.testName
      };

      // Parse block starting from line after header
      parseDetailedBlock(lines, header.index + 1, failure);

      // Add error type detection and guidance
      if (!failure.errorType && failure.message) {
        failure.errorType = detectErrorType(failure.message);
      }
      if (failure.errorType) {
        failure.guidance = getErrorGuidance(failure.errorType);
      }

      failures.push(failure);
    }
  } else {
    // Fallback: No detailed headers found (minimal format)
    // Look for summary lines and parse content after them
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.includes('✘') && trimmed.includes('[fail]:')) {
        const failure: FailureInfo = {};
        const summaryMatch = trimmed.match(/✘\s+\[fail\]:\s+(.+)/);
        if (summaryMatch) {
          failure.testName = summaryMatch[1];
        }

        // Parse block starting from next line
        parseDetailedBlock(lines, i + 1, failure);

        // Add error type detection and guidance
        if (!failure.errorType && failure.message) {
          failure.errorType = detectErrorType(failure.message);
        }
        if (failure.errorType) {
          failure.guidance = getErrorGuidance(failure.errorType);
        }

        failures.push(failure);
      }
    }
  }

  return failures;
}

/**
 * Parse a detailed error block to extract file, line, and message
 */
function parseDetailedBlock(lines: string[], startIndex: number, failure: FailureInfo): void { // NOSONAR - High complexity is inherent to parsing diverse AVA output formats (state machine with multiple patterns)
  let i = startIndex;
  let foundCodeSnippet = false;
  let inErrorObject = false;

  while (i < lines.length && i < startIndex + 60) {
    const line = lines[i];
    const trimmed = line.trim();

    // Stop at next test header (clean test name with ›)
    if (i > startIndex + 3 && trimmed.includes('›') && !trimmed.startsWith('›') &&
        trimmed.length > 15 && !trimmed.includes('file://') &&
        !trimmed.match(/^\d+:/) && !trimmed.match(/^Error/) &&
        !trimmed.includes('{') && !trimmed.includes('}')) {
      break;
    }

    // Stop at separator
    if (trimmed === '─') {
      break;
    }

    // Extract file path: "tests/ava/test.js:28" (appears right after test name header)
    const fileMatch = trimmed.match(/^([^:]+\.(?:js|ts|mjs|cjs)):(\d+)$/);
    if (fileMatch && !failure.file) {
      failure.file = fileMatch[1];
      failure.line = parseInt(fileMatch[2], 10);
      i++;
      continue;
    }

    // Extract from file:// URL: "› file://tests/ava/test.js:28:5"
    const urlMatch = trimmed.match(/^›\s+file:\/\/(.+?):(\d+):\d+$/);
    if (urlMatch && !failure.file) {
      failure.file = urlMatch[1];
      failure.line = parseInt(urlMatch[2], 10);
      i++;
      continue;
    }

    // Code snippet marker (line numbers like "  28:   code here")
    if (trimmed.match(/^\d+:/)) {
      foundCodeSnippet = true;
      i++;
      continue;
    }

    // Error object start
    if (trimmed.match(/^(?:TypeError|Error|.*Error)\s*\{$/)) {
      inErrorObject = true;
      i++;
      continue;
    }

    // Error object end
    if (inErrorObject && trimmed === '}') {
      inErrorObject = false;
      i++;
      continue;
    }

    // Extract from error object properties
    if (inErrorObject) {
      // message property
      const msgMatch = trimmed.match(/message:\s*'([^']+)'/);
      if (msgMatch && !failure.message) {
        failure.message = msgMatch[1];
      }

      // code property for error type detection
      const codeMatch = trimmed.match(/code:\s*'([^']+)'/);
      if (codeMatch) {
        if (codeMatch[1] === 'ENOENT') {
          failure.errorType = 'file-not-found';
        } else if (codeMatch[1] === 'ERR_MODULE_NOT_FOUND') {
          failure.errorType = 'import-error';
        }
      }
      i++;
      continue;
    }

    // Extract error from Error: line (after error object)
    const errorLineMatch = trimmed.match(/^(?:TypeError|Error|.*Error):\s+(.+)$/);
    if (errorLineMatch && !inErrorObject) {
      if (!failure.message) {
        failure.message = errorLineMatch[1];
      }

      // Look for file in stack trace (next few lines)
      if (!failure.file && i + 1 < lines.length) {
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          const stackLine = lines[j].trim();
          // Match: at file:///path/to/file.js:110:24
          // But skip node_modules and ava lib files
          const stackMatch = stackLine.match(/at\s+(?:.*?\s+)?\(?file:\/\/([^:)]+):(\d+):\d+/);
          if (stackMatch) {
            const stackFile = stackMatch[1];
            // Skip node_modules and ava library files
            if (!stackFile.includes('node_modules') && !stackFile.includes('/ava/lib/')) {
              failure.file = stackFile;
              failure.line = parseInt(stackMatch[2], 10);
              break;
            }
          }
        }
      }
      i++;
      continue;
    }

    // Timeout marker
    if (trimmed.includes('Test timeout exceeded')) {
      if (!failure.message) {
        failure.message = 'Test timeout exceeded';
      }
      failure.errorType = 'timeout';
      i++;
      continue;
    }

    // Error markers
    if (trimmed === 'Error thrown in test:' || trimmed === 'Rejected promise returned by test. Reason:') {
      i++;
      continue;
    }

    // Detect assertion from Difference section
    if (trimmed.startsWith('Difference') && trimmed.includes('actual') && trimmed.includes('expected')) {
      if (!failure.message) {
        failure.message = 'Assertion failed';
      }
      if (!failure.errorType) {
        failure.errorType = 'assertion';
      }
      i++;
      continue;
    }

    // Skip diff headers and diff lines
    if (trimmed.startsWith('Difference') || trimmed.startsWith('Expected:') ||
        trimmed.startsWith('Received:') || trimmed.match(/^[+-]\s/)) {
      i++;
      continue;
    }

    // Assertion message (single line after code snippet, before Difference section)
    if (foundCodeSnippet && !failure.message && trimmed.length > 0 && trimmed.length < 150 &&
        !trimmed.match(/^\d+:/) && !trimmed.includes('Difference') &&
        !trimmed.includes('{') && !trimmed.includes('}') &&
        !trimmed.match(/^at\s+/) && !trimmed.includes('file://') &&
        !trimmed.includes('.js:') && !trimmed.includes('.ts:')) {
      failure.message = trimmed;
      i++;
      continue;
    }

    i++;
  }
}

/**
 * Detect error type from message
 */
function detectErrorType(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'timeout';
  }
  if (lower.includes('enoent') || lower.includes('no such file')) {
    return 'file-not-found';
  }
  if (lower.includes('cannot read properties') || lower.includes('typeerror')) {
    return 'type-error';
  }
  if (lower.includes('expected') || lower.includes('should') || lower.includes('difference')) {
    return 'assertion';
  }
  if (lower.includes('cannot find module') || lower.includes('module not found')) {
    return 'import-error';
  }

  return 'unknown';
}

/**
 * Get guidance for a specific error type
 */
function getErrorGuidance(errorType: string): string | undefined {
  const guidanceMap: Record<string, string> = {
    assertion: 'Review the assertion logic and expected vs actual values',
    timeout: 'Increase timeout limit with t.timeout() or optimize async operations',
    'file-not-found': 'Verify file path exists and permissions are correct',
    'type-error': 'Check for null/undefined values before accessing properties',
    'import-error': 'Verify module path and ensure dependencies are installed'
  };

  return guidanceMap[errorType];
}

/**
 * Generate overall guidance from all failures
 */
function generateGuidance(failures: FailureInfo[]): string {
  if (failures.length === 0) {
    return '';
  }

  const errorTypes = new Set(failures.map(f => f.errorType).filter(Boolean));

  if (errorTypes.has('assertion')) {
    return 'Review failing assertions - check expected vs actual values';
  }
  if (errorTypes.has('timeout')) {
    return 'Tests are timing out - use t.timeout() to increase limit or optimize async operations';
  }
  if (errorTypes.has('type-error')) {
    return 'Type errors detected - check for null/undefined values';
  }

  return 'Review test failures and fix the underlying issues';
}

/**
 * Format clean output for display
 */
function formatCleanOutput(errors: FormattedError[]): string {
  if (errors.length === 0) {
    return '';
  }

  return errors
    .map(e => {
      const location = e.file && e.line ? `${e.file}:${e.line}` : e.file || 'unknown';
      const context = e.context ? ` (${e.context})` : '';
      return `${location}${context}: ${e.message}`;
    })
    .join('\n');
}
