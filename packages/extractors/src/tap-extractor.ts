/**
 * TAP Error Extractor
 *
 * Parses TAP (Test Anything Protocol) test output and formats failures for LLM consumption.
 * Supports TAP version 13 and compatible test frameworks (tape, node-tap, etc.)
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, FormattedError, ExtractionMetadata } from './types.js';
import { formatCleanOutput } from './utils/formatter-utils.js';
import { generateGuidanceFromPatterns, type GuidancePattern } from './utils/guidance-generator.js';

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
  // Note: ANSI codes are stripped centrally in smart-extractor.ts

  // Extract all failures
  const failures = extractFailures(output);

  if (failures.length === 0) {
    return {
      summary: '0 test(s) failed',
      errors: [],
      totalErrors: 0,
      errorSummary: '',
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
    const file = failure.file ?? undefined;
    const message = failure.message ?? 'Test failed';
    const context = failure.testName ?? '';

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

  // Generate guidance using TAP-specific patterns
  const guidance = generateGuidanceFromPatterns(failures, TAP_GUIDANCE_PATTERNS);

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
    totalErrors: failures.length,
    errorSummary: formatCleanOutput(errors),
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
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 17 acceptable for TAP output parsing (handles test comments, failure markers, and YAML diagnostic blocks)
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
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses TAP test framework output (controlled output), not user input
    const failureMatch = /^not ok\s+\d+\s+(.+)$/.exec(line);
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
          // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses TAP test framework YAML diagnostics (controlled output), not user input
          const atMatch = /^\s+at:\s+(.+)$/.exec(yamlLine);
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
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses TAP test framework location strings (controlled output), not user input
  const parenMatch = /\(([^)]+)\)/.exec(location);
  const pathString = parenMatch ? parenMatch[1] : location;

  // Remove file:// protocol if present
  const cleanPath = pathString.replace(/^file:\/\//, '');

  // Extract file path and line number
  // Format: /path/to/file.js:line:col or path/to/file.js:line:col
  const match = /^(.+):(\d+):\d+$/.exec(cleanPath);
  if (match) {
    return {
      file: match[1],
      line: Number.parseInt(match[2], 10)
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
 * TAP-specific guidance patterns
 * TAP uses detectErrorType() which returns specific keys, so we map those to guidance
 */
const TAP_GUIDANCE_PATTERNS: GuidancePattern[] = [
  {
    key: 'assertion',
    messageMatchers: ['expected', 'should'],
    guidance: 'Review the assertion logic and expected vs actual values'
  },
  {
    key: 'timeout',
    messageMatchers: ['timeout', 'timed out'],
    guidance: 'Increase timeout limit or optimize async operations'
  },
  {
    key: 'file-not-found',
    messageMatchers: ['enoent', 'no such file'],
    guidance: 'Verify file path exists and permissions are correct'
  },
  {
    key: 'type-error',
    messageMatchers: ['cannot read properties', 'typeerror'],
    guidance: 'Check for null/undefined values before accessing properties'
  }
];

/**
 * Get guidance for a specific error type
 */
function getErrorGuidance(errorType: string): string | undefined {
  const pattern = TAP_GUIDANCE_PATTERNS.find(p => p.key === errorType);
  return pattern?.guidance;
}
