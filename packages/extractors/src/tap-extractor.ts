/**
 * TAP Error Extractor
 *
 * Parses TAP (Test Anything Protocol) test output and formats failures for LLM consumption.
 * Supports TAP version 13 and compatible test frameworks (tape, node-tap, etc.)
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, FormattedError, ExtractionMetadata } from './types.js';
import { stripAnsiCodes } from './utils.js';

/**
 * Extract errors from TAP test output
 *
 * @param output - TAP text output
 * @returns Structured error information
 *
 * @example
 * ```typescript
 * const tapOutput = execSync('tape tests/**\/*.test.js', { encoding: 'utf-8' });
 * const result = extractTAPErrors(tapOutput);
 * console.log(result.summary); // "5 test(s) failed"
 * ```
 */
export function extractTAPErrors(output: string): ErrorExtractorResult {
  const cleanOutput = stripAnsiCodes(output);

  // Extract all failures
  const failures = extractFailures(cleanOutput);

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
    const file = failure.file || undefined;
    const message = failure.message || 'Test failed';
    const context = failure.testName || '';

    const isComplete = file && failure.line && message;
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
  const confidence = failures.length > 0 ? 95 : 100; // High confidence for TAP

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
 * Failure information from TAP output
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
 * Extract all failures from TAP output
 */
function extractFailures(output: string): FailureInfo[] {
  const failures: FailureInfo[] = [];
  const lines = output.split('\n');

  let currentTestName = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Track test names from comments
    if (line.trim().startsWith('#')) {
      currentTestName = line.trim().substring(1).trim();
      i++;
      continue;
    }

    // Look for failures: "not ok N message"
    const failureMatch = line.match(/^not ok\s+\d+\s+(.+)$/);
    if (failureMatch) {
      const message = failureMatch[1].trim();
      const failure: FailureInfo = {
        message,
        testName: currentTestName
      };

      // Look for YAML diagnostic block (starts with "  ---")
      if (i + 1 < lines.length && lines[i + 1].trim() === '---') {
        i += 2; // Skip "not ok" line and "---" line

        // Parse YAML block until we hit "..."
        while (i < lines.length && !lines[i].trim().startsWith('...')) {
          const yamlLine = lines[i];

          // Extract location from "at:" field
          // Format: "at: Test.<anonymous> (file:///path/to/file.js:line:col)"
          // or: "at: file.js:line:col"
          const atMatch = yamlLine.match(/^\s+at:\s+(.+)$/);
          if (atMatch) {
            const location = atMatch[1];
            const { file, line } = parseLocation(location);
            if (file) failure.file = file;
            if (line) failure.line = line;
          }

          i++;
        }
      }

      // Detect error type and add guidance
      const errorType = detectErrorType(message);
      failure.errorType = errorType;
      failure.guidance = getErrorGuidance(errorType);

      failures.push(failure);
    }

    i++;
  }

  return failures;
}

/**
 * Parse location string to extract file and line number
 *
 * Handles formats:
 * - Test.<anonymous> (file:///path/to/file.js:28:5)
 * - Test.<anonymous> (./path/to/file.js:28:5)
 * - file.js:28:5
 */
function parseLocation(location: string): { file?: string; line?: number } {
  // Try to extract from parentheses first: (file:///path:line:col) or (path:line:col)
  const parenMatch = location.match(/\(([^)]+)\)/);
  const pathString = parenMatch ? parenMatch[1] : location;

  // Remove file:// protocol if present
  const cleanPath = pathString.replace(/^file:\/\//, '');

  // Extract file path and line number
  // Format: /path/to/file.js:line:col or path/to/file.js:line:col
  const match = cleanPath.match(/^(.+):(\d+):\d+$/);
  if (match) {
    return {
      file: match[1],
      line: parseInt(match[2], 10)
    };
  }

  return {};
}

/**
 * Detect error type from message
 */
function detectErrorType(message: string): string {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return 'timeout';
  }
  if (lowerMessage.includes('enoent') || lowerMessage.includes('no such file')) {
    return 'file-not-found';
  }
  if (lowerMessage.includes('cannot read properties') || lowerMessage.includes('typeerror')) {
    return 'type-error';
  }
  if (lowerMessage.includes('expected') || lowerMessage.includes('should')) {
    return 'assertion';
  }

  return 'unknown';
}

/**
 * Get guidance for a specific error type
 */
function getErrorGuidance(errorType: string): string | undefined {
  const guidanceMap: Record<string, string> = {
    assertion: 'Review the assertion logic and expected vs actual values',
    timeout: 'Increase timeout limit or optimize async operations',
    'file-not-found': 'Verify file path exists and permissions are correct',
    'type-error': 'Check for null/undefined values before accessing properties'
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
    return 'Tests are timing out - consider increasing timeout or optimizing async code';
  }
  if (errorTypes.has('type-error')) {
    return 'Runtime type errors detected - add null checks before property access';
  }

  return 'Review test failures and error messages above';
}

/**
 * Format clean output for LLM consumption
 */
function formatCleanOutput(errors: FormattedError[]): string {
  if (errors.length === 0) {
    return '';
  }

  return errors
    .map(error => {
      const location = error.file
        ? `${error.file}${error.line ? `:${error.line}` : ''}`
        : 'unknown location';

      const context = error.context ? `[${error.context}] ` : '';
      return `${location}: ${context}${error.message}`;
    })
    .join('\n');
}
