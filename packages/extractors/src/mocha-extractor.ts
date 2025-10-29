/**
 * Mocha Error Extractor
 *
 * Parses Mocha test output and formats failures for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, FormattedError, ExtractionMetadata } from './types.js';

/**
 * Extract errors from Mocha test output
 *
 * @param output - Mocha text output
 * @returns Structured error information
 *
 * @example
 * ```typescript
 * const mochaOutput = execSync('mocha tests/**\/*.test.js', { encoding: 'utf-8' });
 * const result = extractMochaErrors(mochaOutput);
 * console.log(result.summary); // "5 test(s) failed"
 * ```
 */
export function extractMochaErrors(output: string): ErrorExtractorResult {
  // Note: ANSI codes are stripped centrally in smart-extractor.ts

  // Check if this looks like Mocha output
  if (!output.includes('failing') && !output.includes('passing')) {
    return {
      summary: 'Unable to parse Mocha output - invalid format',
      errors: [],
      totalCount: 0,
      cleanOutput: output.trim(),
      guidance: 'Ensure the input is valid Mocha test output',
      metadata: {
        confidence: 0,
        completeness: 0,
        issues: ['Not Mocha output format']
      }
    };
  }

  // Extract failure count
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Mocha test framework summary (controlled output), not user input
  const failingMatch = /(\d+) failing/.exec(output);
  const failureCount = failingMatch ? Number.parseInt(failingMatch[1], 10) : 0;

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
    const file = failure.file ?? 'unknown';
    const message = failure.message ?? 'Test failed';
    const context = failure.testName ?? '';

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
  const confidence = failures.length > 0 ? 95 : 100; // High confidence for Mocha

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
 * Failure information from Mocha output
 */
interface FailureInfo {
  file?: string;
  line?: number;
  message?: string;
  testName?: string;
  errorType?: string;
}

/**
 * Extract failure information from Mocha output
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 30 acceptable for Mocha output parsing (handles test hierarchies, error messages, and stack trace extraction)
function extractFailures(output: string): FailureInfo[] {
  const failures: FailureInfo[] = [];
  const lines = output.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Look for numbered failure markers (e.g., "  1) ")
    // Only match detailed format (2 spaces), not summary format (6+ spaces)
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Mocha test framework output (controlled output), not user input
    const failureMatch = /^ {2}(\d+)\)\s+(.*)$/.exec(line);

    if (failureMatch) {
      // failureMatch[1] contains the failure number (not used - test name is more important)
      const firstPart = failureMatch[2].trim();

      // Collect test hierarchy lines
      const testNameParts: string[] = [];

      // Check if first part ends with colon (simple format: "1) Test:")
      const isSimpleFormat = firstPart.endsWith(':');

      if (firstPart) {
        testNameParts.push(firstPart.replace(/:$/, '')); // Remove trailing colon
      }

      let j = i + 1;

      // If simple format, don't try to collect more hierarchy
      if (!isSimpleFormat) {
        // Continue collecting hierarchy lines until we hit blank line or error
        while (j < lines.length) {
          const nextLine = lines[j];

          // Blank line marks end of hierarchy
          if (nextLine.trim() === '') {
            break;
          }

          // Error line marks end of hierarchy
          if (/^\s+(Error|AssertionError|TypeError)/.exec(nextLine)) {
            break;
          }

          // Indented lines are part of hierarchy (at least 5 spaces for Mocha)
          if (/^\s{5,}\S/.exec(nextLine)) {
            const part = nextLine.trim().replace(/:$/, ''); // Remove trailing colon
            testNameParts.push(part);
          }

          j++;
        }
      }

      const testName = testNameParts.join(' > ');

      // Now scan for error message and stack trace
      let message: string | undefined;
      let errorType: string | undefined;
      let file: string | undefined;
      let lineNumber: number | undefined;

      // Continue from where we left off
      while (j < lines.length && j < i + 40) {
        const nextLine = lines[j];

        // Stop if we hit the next failure
        if (/^\s+\d+\)\s+/.exec(nextLine)) {
          break;
        }

        // Extract error type and message
        // Pattern 1: "     AssertionError [ERR_ASSERTION]: Expected..."
        // Pattern 2: "     Error: ENOENT: no such file..."
        // Pattern 3: "     TypeError: Cannot read..."
        if (!message) {
          // Match plain "Error" or prefixed errors like "TypeError", "AssertionError"
          const errorMatch = /^\s+([A-Za-z]*Error)(?:\s\[\w+\])?\s*:\s*(.+)/.exec(nextLine);
          if (errorMatch) {
            errorType = errorMatch[1];
            message = errorMatch[2].trim();
          }
        }

        // Extract file location from stack trace
        if (!file && nextLine.includes('at Context.<anonymous>')) {
          // Match various path formats:
          // - file:///path/to/file.js:10:20
          // - /absolute/path/file.js:10:20
          // - relative/path/file.js:10:20
          const locationMatch = /at Context\.<anonymous> \((?:file:\/\/)?([^:)]+):(\d+)(?::(\d+))?\)/.exec(nextLine);
          if (locationMatch) {
            file = locationMatch[1];
            lineNumber = Number.parseInt(locationMatch[2], 10);
          }
        }

        // Extract file from timeout error messages: "Error: Timeout... (/path/to/file.js)"
        if (!file && message?.includes('Timeout')) {
          // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Mocha test framework timeout messages (controlled output), not user input
          const timeoutFileMatch = /\(([^)]+\.(?:js|ts|mjs|cjs))\)/.exec(message);
          if (timeoutFileMatch) {
            file = timeoutFileMatch[1];
          }
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
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 16 acceptable for guidance generation (categorizes multiple error types and generates actionable suggestions)
function generateGuidance(failures: FailureInfo[]): string {
  const guidances: string[] = [];
  const seen = new Set<string>();

  for (const failure of failures) {
    const message = failure.message ?? '';
    const errorType = failure.errorType;

    // Assertion errors
    if (errorType === 'AssertionError' || message.includes('expected') || message.includes('Expected')) {
      if (!seen.has('assertion')) {
        guidances.push('Review test assertions and expected values');
        seen.add('assertion');
      }
    }

    // Timeout errors
    if (message.includes('Timeout') || message.includes('timeout') || message.includes('exceeded')) {
      if (!seen.has('timeout')) {
        guidances.push('Increase test timeout or optimize async operations');
        seen.add('timeout');
      }
    }

    // Type errors
    if (errorType === 'TypeError') {
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
    if (message.includes('Cannot find package') || message.includes('Cannot find module')) {
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
