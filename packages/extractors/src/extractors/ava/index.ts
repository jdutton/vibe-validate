/**
 * Ava Error Extractor Plugin
 *
 * Parses Ava test output and formats failures for LLM consumption.
 * Supports Ava v6+ output format with Unicode symbols and clean error formatting.
 *
 * @package @vibe-validate/extractors
 */

import type {
  ExtractorPlugin,
  DetectionResult,
  ErrorExtractorResult,
  FormattedError,
  ExtractionMetadata,
} from '../../types.js';
import { formatCleanOutput } from '../../utils/formatter-utils.js';
import {
  generateGuidanceFromPatterns,
  COMMON_GUIDANCE_PATTERNS,
  type GuidancePattern,
} from '../../utils/guidance-generator.js';
import {
  collectLinesUntil,
  parseStackLocation,
  COMMON_STACK_PATTERNS,
} from '../../utils/parser-utils.js';

// Detection reason constants
const REASON_AVA_DETECTED = 'Ava test output detected';
const REASON_AVA_POSSIBLE = 'Possible Ava test output';
const REASON_NOT_AVA = 'Not Ava test output';
const AVA_TIMEOUT_MESSAGE = 'Test timeout exceeded';

/**
 * Ava-specific guidance patterns
 * Extends common patterns with Ava-specific timeout guidance
 */
const AVA_GUIDANCE_PATTERNS: GuidancePattern[] = [
  ...COMMON_GUIDANCE_PATTERNS,
  {
    key: 'ava-timeout',
    messageMatchers: [],
    errorTypeMatchers: ['timeout'],
    guidance: 'Tests are timing out - use t.timeout() to increase limit or optimize async operations',
  },
];

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
 * Detects if output is from Ava test framework
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 20 acceptable for Ava detection (pattern scoring with multiple marker types)
export function detectAva(output: string): DetectionResult {
  const lines = output.split('\n');
  let score = 0;
  const foundPatterns: string[] = [];

  // Look for Ava-specific patterns
  let hasAvaFailureMarker = false;
  let hasAvaTestHeader = false;
  let hasFileUrlFormat = false;
  let hasErrorThrownMarker = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // High-value markers (30 points each)
    if (!hasAvaFailureMarker && /✘\s+\[fail\]:/.test(trimmed)) {
      score += 30;
      foundPatterns.push('Ava failure marker (✘ [fail]:)');
      hasAvaFailureMarker = true;
    }

    // Medium-value markers (20 points)
    if (!hasAvaTestHeader && trimmed.includes('›') && !trimmed.startsWith('›') && trimmed.length > 15) {
      score += 20;
      foundPatterns.push('Ava test hierarchy (›)');
      hasAvaTestHeader = true;
    }

    if (!hasFileUrlFormat && /›\s+file:\/\//.test(trimmed)) {
      score += 20;
      foundPatterns.push('file:// URL format');
      hasFileUrlFormat = true;
    }

    // Ava-specific error markers (15 points)
    if (!hasErrorThrownMarker && (trimmed === 'Error thrown in test:' || trimmed === 'Rejected promise returned by test. Reason:')) {
      score += 15;
      foundPatterns.push('Ava error marker');
      hasErrorThrownMarker = true;
    }

    // Low-value markers (10 points)
    if (trimmed.includes(AVA_TIMEOUT_MESSAGE)) {
      score += 10;
      foundPatterns.push('Ava timeout message');
    }

    // File path with line number format (10 points)
    if (/^[^:]+\.(?:js|ts|mjs|cjs):\d+$/.test(trimmed)) {
      score += 5;
      foundPatterns.push('file:line format');
    }
  }

  // Determine reason based on score
  let reason: string;
  if (score >= 50) {
    reason = REASON_AVA_DETECTED;
  } else if (score >= 30) {
    reason = REASON_AVA_POSSIBLE;
  } else {
    reason = REASON_NOT_AVA;
  }

  return {
    confidence: Math.min(score, 100),
    patterns: foundPatterns,
    reason,
  };
}

/**
 * Extract errors from Ava test output
 */
export function extractAva(output: string, _command?: string): ErrorExtractorResult {
  const detection = detectAva(output);

  if (detection.confidence < 30) {
    return {
      summary: REASON_NOT_AVA,
      totalErrors: 0,
      errors: [],
      metadata: {
        detection: {
          extractor: 'ava',
          confidence: detection.confidence,
          patterns: detection.patterns,
          reason: detection.reason,
        },
        confidence: detection.confidence,
        completeness: 100,
        issues: [],
      },
    };
  }

  // Extract all failures using two-pass approach:
  // 1. Parse summary lines to get test names
  // 2. Parse detailed blocks to get file locations and messages
  const failures = extractFailures(output);

  if (failures.length === 0) {
    return {
      summary: '0 test(s) failed',
      errors: [],
      totalErrors: 0,
      errorSummary: '',
      guidance: '',
      metadata: {
        detection: {
          extractor: 'ava',
          confidence: detection.confidence,
          patterns: detection.patterns,
          reason: detection.reason,
        },
        confidence: 100,
        completeness: 100,
        issues: [],
      },
    };
  }

  const errors: FormattedError[] = [];
  let completeCount = 0;

  for (const failure of failures) {
    const file = failure.file ?? 'unknown';
    // Use test name as fallback message if no explicit message extracted
    const message = failure.message ?? failure.testName ?? 'Test failed';
    const context = failure.testName ?? '';

    const isComplete = file !== 'unknown' && failure.line && message && message !== 'Test failed';
    if (isComplete) {
      completeCount++;
    }

    errors.push({
      file,
      line: failure.line,
      message,
      context,
      guidance: failure.guidance,
    });
  }

  // Generate summary
  const summary = `${failures.length} test(s) failed`;

  // Generate guidance using Ava-specific patterns
  const guidance = generateGuidanceFromPatterns(failures, AVA_GUIDANCE_PATTERNS);

  // Calculate quality metadata
  const completeness = failures.length > 0 ? (completeCount / failures.length) * 100 : 100;
  const confidence = failures.length > 0 ? 90 : 100; // High confidence for Ava's structured output

  const metadata: ExtractionMetadata = {
    detection: {
      extractor: 'ava',
      confidence: detection.confidence,
      patterns: detection.patterns,
      reason: detection.reason,
    },
    confidence,
    completeness,
    issues: [],
  };

  return {
    summary,
    errors,
    totalErrors: failures.length,
    errorSummary: formatCleanOutput(errors),
    guidance,
    metadata,
  };
}

/**
 * Extract all failures from Ava output
 * Strategy: Find detailed headers (test names with ›), then parse each block
 */
/**
 * Enrich failure with error type detection and guidance
 */
function enrichFailureWithErrorType(failure: FailureInfo): void {
  if (!failure.errorType && failure.message) {
    failure.errorType = detectErrorType(failure.message);
  }
  if (failure.errorType) {
    failure.guidance = getErrorGuidance(failure.errorType);
  }
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 23 acceptable for Ava output parsing (handles multiple output formats with fallback detection)
function extractFailures(output: string): FailureInfo[] {
  const lines = output.split('\n');
  const failures: FailureInfo[] = [];

  // Find all detailed block headers (clean test names with ›)
  // These are the authoritative source - each one represents a failure
  const headerIndices: Array<{ index: number; testName: string }> = [];

  for (const [i, line] of lines.entries()) {
    const trimmed = line.trim();

    // Detailed header: has ›, not a summary, not a file:// line, not code, reasonable length
    if (
      trimmed.includes('›') &&
      !trimmed.includes('[fail]:') &&
      !trimmed.startsWith('›') &&
      !trimmed.includes('file://') &&
      !/^\d+:/.exec(trimmed) &&
      !/^Error/.exec(trimmed) &&
      !trimmed.includes('{') &&
      !trimmed.includes('}') &&
      trimmed.length > 10
    ) {
      headerIndices.push({ index: i, testName: trimmed });
    }
  }

  // If we found detailed headers, parse each one
  if (headerIndices.length > 0) {
    for (const header of headerIndices) {
      const failure: FailureInfo = {
        testName: header.testName,
      };

      // Parse block starting from line after header
      parseDetailedBlock(lines, header.index + 1, failure);

      // Add error type detection and guidance
      enrichFailureWithErrorType(failure);

      failures.push(failure);
    }
  } else {
    // Fallback: No detailed headers found (minimal format)
    // Look for summary lines and parse content after them
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.includes('✘') && trimmed.includes('[fail]:')) {
        const failure: FailureInfo = {};
        const summaryMatch = /✘\s+\[fail\]:\s+(.+)/.exec(trimmed);
        if (summaryMatch) {
          failure.testName = summaryMatch[1];
        }

        // Parse block starting from next line
        parseDetailedBlock(lines, i + 1, failure);

        // Add error type detection and guidance
        enrichFailureWithErrorType(failure);

        failures.push(failure);
      }
    }
  }

  return failures;
}

/**
 * Parse a detailed error block to extract file, line, and message
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 40 acceptable for Ava error block parsing (state machine handling multiple output formats and edge cases)
function parseDetailedBlock(lines: string[], startIndex: number, failure: FailureInfo): void {
  let i = startIndex;
  let foundCodeSnippet = false;
  let inErrorObject = false;

  while (i < lines.length && i < startIndex + 60) {
    const line = lines[i];
    const trimmed = line.trim();

    // Stop at next test header (clean test name with ›)
    if (
      i > startIndex + 3 &&
      trimmed.includes('›') &&
      !trimmed.startsWith('›') &&
      trimmed.length > 15 &&
      !trimmed.includes('file://') &&
      !/^\d+:/.exec(trimmed) &&
      !/^Error/.exec(trimmed) &&
      !trimmed.includes('{') &&
      !trimmed.includes('}')
    ) {
      break;
    }

    // Stop at separator
    if (trimmed === '─') {
      break;
    }

    // Extract file path: "tests/ava/test.js:28" (appears right after test name header)
    if (!failure.file) {
      const location = parseStackLocation(trimmed, COMMON_STACK_PATTERNS.simpleFileLine);
      if (location.file) {
        failure.file = location.file;
        failure.line = location.line;
        i++;
        continue;
      }
    }

    // Extract from file:// URL: "› file://tests/ava/test.js:28:5"
    if (!failure.file) {
      const location = parseStackLocation(trimmed, COMMON_STACK_PATTERNS.avaFileUrl);
      if (location.file) {
        failure.file = location.file;
        failure.line = location.line;
        i++;
        continue;
      }
    }

    // Code snippet marker (line numbers like "  28:   code here")
    if (/^\d+:/.exec(trimmed)) {
      foundCodeSnippet = true;
      i++;
      continue;
    }

    // Error object start
    if (/^(?:TypeError|Error|.*Error)\s*\{$/.exec(trimmed)) {
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
      const msgMatch = /message:\s*'([^']+)'/.exec(trimmed);
      if (msgMatch && !failure.message) {
        failure.message = msgMatch[1];
      }

      // code property for error type detection
      const codeMatch = /code:\s*'([^']+)'/.exec(trimmed);
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
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses Ava test framework error messages (controlled output), not user input
    const errorLineMatch = /^(?:TypeError|Error|.*Error):\s+(.+)$/.exec(trimmed);
    if (errorLineMatch) {
      failure.message ??= errorLineMatch[1];

      // Look for file in stack trace (next few lines)
      if (!failure.file && i + 1 < lines.length) {
        const { lines: stackLines } = collectLinesUntil(
          lines,
          i + 1,
          (_line, index) => index >= i + 10
        );

        for (const stackLine of stackLines) {
          const location = parseStackLocation(stackLine, COMMON_STACK_PATTERNS.avaFileUrl);
          // Skip node_modules and ava library files
          if (location.file && !location.file.includes('node_modules') && !location.file.includes('/ava/lib/')) {
            failure.file = location.file;
            failure.line = location.line;
            break;
          }
        }
      }
      i++;
      continue;
    }

    // Timeout marker
    if (trimmed.includes(AVA_TIMEOUT_MESSAGE)) {
      failure.message ??= AVA_TIMEOUT_MESSAGE;
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
      failure.message ??= 'Assertion failed';
      failure.errorType ??= 'assertion';
      i++;
      continue;
    }

    // Skip diff headers and diff lines
    if (
      trimmed.startsWith('Difference') ||
      trimmed.startsWith('Expected:') ||
      trimmed.startsWith('Received:') ||
      /^[+-]\s/.exec(trimmed)
    ) {
      i++;
      continue;
    }

    // Assertion message (single line after code snippet, before Difference section)
    if (
      foundCodeSnippet &&
      !failure.message &&
      trimmed.length > 0 &&
      trimmed.length < 150 &&
      !/^\d+:/.exec(trimmed) &&
      !trimmed.includes('Difference') &&
      !trimmed.includes('{') &&
      !trimmed.includes('}') &&
      !/^at\s+/.exec(trimmed) &&
      !trimmed.includes('file://') &&
      !trimmed.includes('.js:') &&
      !trimmed.includes('.ts:')
    ) {
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
    'import-error': 'Verify module path and ensure dependencies are installed',
  };

  return guidanceMap[errorType];
}

/**
 * Ava Extractor Plugin
 */
const avaExtractor: ExtractorPlugin = {
  metadata: {
    name: 'ava',
    version: '1.0.0',
    author: 'Jeff Dutton <jeff@duckcreek.com>',
    description: 'Extracts test failures from Ava test framework output',
    repository: 'https://github.com/jdutton/vibe-validate',
    tags: ['ava', 'test', 'javascript', 'typescript'],
  },

  hints: {
    anyOf: ['✘', '[fail]', 'file://'],
  },

  priority: 82,

  detect: detectAva,
  extract: extractAva,

  samples: [
    {
      name: 'basic-assertion-failure',
      description: 'Simple assertion failure with file and line',
      input: `
  ✘ [fail]: Extractors › should extract TypeScript errors correctly should have 5 errors

  Extractors › should extract TypeScript errors correctly

  tests/ava/comprehensive-failures.test.js:28

   27:   // Expected: 1 error, but we assert 5 (INTENTIONAL FAILURE)
   28:   t.is(result.errors.length, 5, 'should have 5 errors');
   29: });

  should have 5 errors

  Difference (- actual, + expected):

  - 1
  + 5

  › file://tests/ava/comprehensive-failures.test.js:28:5
`,
      expected: {
        totalErrors: 1,
        errors: [
          {
            file: 'tests/ava/comprehensive-failures.test.js',
            line: 28,
            message: 'should have 5 errors',
          },
        ],
      },
    },
    {
      name: 'comprehensive-failures',
      description: 'Real Ava comprehensive failure output',
      inputFile: './samples/comprehensive-failures-001.txt',
      expected: {
        totalErrors: 11,
      },
    },
  ],
};

export default avaExtractor;
