/**
 * Jasmine Error Extractor
 *
 * Parses Jasmine test output and formats failures for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, FormattedError, ExtractionMetadata } from './types.js';

/**
 * Extract errors from Jasmine test output
 *
 * @param output - Jasmine text output
 * @returns Structured error information
 *
 * @example
 * ```typescript
 * const jasmineOutput = execSync('jasmine tests/**\/*.spec.js', { encoding: 'utf-8' });
 * const result = extractJasmineErrors(jasmineOutput);
 * console.log(result.summary); // "5 test(s) failed"
 * ```
 */
export function extractJasmineErrors(output: string): ErrorExtractorResult {
  // Note: ANSI codes are stripped centrally in smart-extractor.ts

  // Check if this looks like Jasmine output
  if (!output.includes('spec') && !output.includes('Failures:')) {
    return {
      summary: 'Unable to parse Jasmine output - invalid format',
      errors: [],
      totalCount: 0,
      cleanOutput: output.trim(),
      guidance: 'Ensure the input is valid Jasmine test output',
      metadata: {
        confidence: 0,
        completeness: 0,
        issues: ['Not Jasmine output format']
      }
    };
  }

  // Extract failure count
  const failureMatch = output.match(/(\d+) spec(?:s)?, (\d+) failure(?:s)?/);
  const failureCount = failureMatch ? parseInt(failureMatch[2], 10) : 0;

  if (failureCount === 0) {
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

  // Extract all failures
  const failures = extractFailures(output);
  const errors: FormattedError[] = [];

  let completeCount = 0;

  for (const failure of failures) {
    const file = failure.file || 'unknown';
    const message = failure.message || 'Test failed';
    const context = failure.testName || '';

    const isComplete = file !== 'unknown' && failure.line && message;
    if (isComplete) {
      completeCount++;
    }

    errors.push({
      file,
      line: failure.line,
      message,
      context
    });
  }

  // Generate summary
  const summary = `${failures.length} test(s) failed`;

  // Generate guidance
  const guidance = generateGuidance(failures);

  // Calculate quality metadata
  const completeness = failures.length > 0 ? (completeCount / failures.length) * 100 : 100;
  const confidence = failures.length > 0 ? 95 : 100; // High confidence for Jasmine

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
 * Failure information from Jasmine output
 */
interface FailureInfo {
  file?: string;
  line?: number;
  message?: string;
  testName?: string;
  errorType?: string;
}

/**
 * Extract failure information from Jasmine output
 */
function extractFailures(output: string): FailureInfo[] {
  const failures: FailureInfo[] = [];
  const lines = output.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Look for numbered failure markers (e.g., "1) Test name")
    const failureMatch = line.match(/^(\d+)\)\s+(.+)$/);

    if (failureMatch) {
      // failureMatch[1] contains the failure number (not used - line number extracted from stack trace instead)
      const testName = failureMatch[2].trim();

      let j = i + 1;
      let message: string | undefined;
      let errorType: string | undefined;
      let file: string | undefined;
      let lineNumber: number | undefined;

      // Scan for Message: and Stack: sections
      while (j < lines.length && j < i + 30) {
        const nextLine = lines[j];

        // Stop if we hit the next failure
        if (nextLine.match(/^\d+\)\s+/)) {
          break;
        }

        // Extract message (comes after "  Message:" line)
        if (nextLine.trim() === 'Message:') {
          j++;
          // Collect message lines until we hit "Stack:" or empty line
          const messageLines: string[] = [];
          while (j < lines.length) {
            const msgLine = lines[j];
            if (msgLine.trim() === 'Stack:' || msgLine.trim() === '') {
              break;
            }
            messageLines.push(msgLine.trim());
            j++;
          }
          message = messageLines.join(' ').trim();

          // Extract error type if present (e.g., "TypeError:", "Error:")
          const errorMatch = message.match(/^([A-Za-z]*Error):\s*/);
          if (errorMatch) {
            errorType = errorMatch[1];
          }

          continue;
        }

        // Extract file location from stack trace
        if (nextLine.trim() === 'Stack:') {
          j++;
          // Scan stack trace for file location
          while (j < lines.length && j < i + 40) {
            const stackLine = lines[j];

            // Stop if we hit the next failure or empty section
            if (stackLine.match(/^\d+\)\s+/) || (stackLine.trim() === '' && lines[j + 1]?.match(/^\d+\)\s+/))) {
              break;
            }

            // Extract file from UserContext.<anonymous> stack lines
            if (stackLine.includes('UserContext.<anonymous>')) {
              const locationMatch = stackLine.match(/UserContext\.<anonymous> \(([^:)]+):(\d+)(?::(\d+))?\)/);
              if (locationMatch) {
                file = locationMatch[1];
                lineNumber = parseInt(locationMatch[2], 10);
                break;
              }
            }

            // Also try Object.* patterns
            if (!file && stackLine.includes(' (') && stackLine.includes('.js:')) {
              const altMatch = stackLine.match(/\(([^:)]+):(\d+)(?::(\d+))?\)/);
              if (altMatch) {
                file = altMatch[1];
                lineNumber = parseInt(altMatch[2], 10);
                break;
              }
            }

            j++;
          }
          continue;
        }

        j++;
      }

      failures.push({
        testName,
        message,
        errorType,
        file,
        line: lineNumber
      });

      i = j; // Skip to after this failure
    } else {
      i++;
    }
  }

  return failures;
}

/**
 * Generate guidance based on failure types
 */
function generateGuidance(failures: FailureInfo[]): string {
  const guidances: string[] = [];
  const seen = new Set<string>();

  for (const failure of failures) {
    const message = failure.message || '';
    const errorType = failure.errorType;

    // Assertion errors
    if (message.includes('Expected') || message.includes('expected')) {
      if (!seen.has('assertion')) {
        guidances.push('Review test assertions and expected values');
        seen.add('assertion');
      }
    }

    // Timeout errors
    if (message.includes('Timeout') || message.includes('timeout') || message.includes('did not complete')) {
      if (!seen.has('timeout')) {
        guidances.push('Increase test timeout or optimize async operations');
        seen.add('timeout');
      }
    }

    // Type errors
    if (errorType === 'TypeError' || message.includes('Cannot read properties')) {
      if (!seen.has('type')) {
        guidances.push('Check for null/undefined values and type mismatches');
        seen.add('type');
      }
    }

    // File errors
    if (message.includes('ENOENT') || message.includes('no such file')) {
      if (!seen.has('file')) {
        guidances.push('Verify file paths and ensure test fixtures exist');
        seen.add('file');
      }
    }

    // Module errors
    if (message.includes('Cannot find module') || message.includes('Cannot find package')) {
      if (!seen.has('module')) {
        guidances.push('Install missing dependencies or check import paths');
        seen.add('module');
      }
    }
  }

  return guidances.join('\n');
}

/**
 * Format clean output for LLM consumption
 */
function formatCleanOutput(errors: FormattedError[]): string {
  if (errors.length === 0) {
    return '';
  }

  return errors
    .map((error) => {
      const location = error.line ? `${error.file}:${error.line}` : error.file;
      const contextStr = error.context ? ` (${error.context})` : '';
      return `${location}: ${error.message}${contextStr}`;
    })
    .join('\n');
}
