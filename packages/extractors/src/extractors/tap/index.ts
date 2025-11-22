/**
 * TAP Error Extractor Plugin
 *
 * Parses TAP (Test Anything Protocol) test output and formats failures for LLM consumption.
 * Supports TAP version 13 and compatible test frameworks (tape, node-tap, etc.)
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
import { generateGuidanceFromPatterns, type GuidancePattern } from '../../utils/guidance-generator.js';

/**
 * TAP-specific guidance patterns
 * TAP uses detectErrorType() which returns specific keys, so we map those to guidance
 */
const TAP_GUIDANCE_PATTERNS: GuidancePattern[] = [
  {
    key: 'assertion',
    messageMatchers: ['expected', 'should'],
    guidance: 'Review the assertion logic and expected vs actual values',
  },
  {
    key: 'timeout',
    messageMatchers: ['timeout', 'timed out'],
    guidance: 'Increase timeout limit or optimize async operations',
  },
  {
    key: 'file-not-found',
    messageMatchers: ['enoent', 'no such file'],
    guidance: 'Verify file path exists and permissions are correct',
  },
  {
    key: 'type-error',
    messageMatchers: ['cannot read properties', 'typeerror'],
    guidance: 'Check for null/undefined values before accessing properties',
  },
];

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
 * Detects if output is from TAP protocol
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 16 acceptable for TAP detection (pattern scoring with multiple marker types)
export function detectTAP(output: string): DetectionResult {
  const lines = output.split('\n');
  let score = 0;
  const foundPatterns: string[] = [];

  let hasTAPVersion = false;
  let hasNotOk = false;
  let hasYAMLBlock = false;
  let hasTestComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // High-value markers (30 points each)
    if (!hasTAPVersion && /^TAP version \d+/.test(trimmed)) {
      score += 30;
      foundPatterns.push('TAP version header');
      hasTAPVersion = true;
    }

    // Medium-value markers (20 points)
    if (!hasNotOk && /^not ok \d+/.test(trimmed)) {
      score += 20;
      foundPatterns.push('not ok N failure marker');
      hasNotOk = true;
    }

    if (!hasYAMLBlock && trimmed === '---') {
      score += 15;
      foundPatterns.push('YAML diagnostic block (---)');
      hasYAMLBlock = true;
    }

    // Low-value markers (10 points)
    if (!hasTestComment && trimmed.startsWith('# ')) {
      score += 10;
      foundPatterns.push('Test comment marker (#)');
      hasTestComment = true;
    }
  }

  // Determine reason based on score
  let reason: string;
  if (score >= 60) {
    reason = 'TAP protocol output detected';
  } else if (score >= 30) {
    reason = 'Possible TAP output';
  } else {
    reason = 'Not TAP output';
  }

  return {
    confidence: Math.min(score, 100),
    patterns: foundPatterns,
    reason,
  };
}

/**
 * Extract errors from TAP test output
 */
export function extractTAP(output: string, _command?: string): ErrorExtractorResult {
  const detection = detectTAP(output);

  if (detection.confidence < 30) {
    return {
      summary: 'Not TAP output',
      totalErrors: 0,
      errors: [],
      metadata: {
        detection: {
          extractor: 'tap',
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
        detection: {
          extractor: 'tap',
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
      guidance: failure.guidance,
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
    detection: {
      extractor: 'tap',
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
        testName: currentTestName,
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
      line: Number.parseInt(match[2], 10),
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
  const pattern = TAP_GUIDANCE_PATTERNS.find((p) => p.key === errorType);
  return pattern?.guidance;
}

/**
 * TAP Extractor Plugin
 */
const tapExtractor: ExtractorPlugin = {
  metadata: {
    name: 'tap',
    version: '1.0.0',
    author: 'Jeff Dutton <jeff@duckcreek.com>',
    description: 'Extracts test failures from TAP (Test Anything Protocol) output',
    repository: 'https://github.com/jdutton/vibe-validate',
    tags: ['tap', 'test', 'tape', 'node-tap'],
  },

  hints: {
    anyOf: ['not ok', 'TAP version', '---'],
  },

  priority: 78,

  detect: detectTAP,
  extract: extractTAP,

  samples: [
    {
      name: 'basic-failure',
      description: 'Simple TAP failure with YAML diagnostics',
      // NOSONAR -- /tmp path is part of test fixture sample data, not actual temporary file creation or manipulation
      input: `TAP version 13
# Test › should pass assertion
not ok 1 should have 5 errors
  ---
    operator: equal
    expected: 5
    actual:   1
    at: Test.<anonymous> (file:///tmp/test.js:28:5)
    stack: |-
      Error: should have 5 errors
          at Test.assert [as _assert] (/path/to/tape/lib/test.js:492:48)
          at Test.<anonymous> (file:///tmp/test.js:28:5)
  ...
`,
      expected: {
        totalErrors: 1,
        errors: [
          {
            // eslint-disable-next-line sonarjs/publicly-writable-directories -- /tmp path is part of test fixture sample data, not actual temporary file creation
            file: '/tmp/test.js',
            line: 28,
            message: 'should have 5 errors',
          },
        ],
      },
    },
    {
      name: 'comprehensive-failures',
      description: 'Real TAP comprehensive failure output',
      inputFile: './samples/comprehensive-failures-001.txt',
      expected: {
        totalErrors: 15,
      },
    },
  ],
};

export default tapExtractor;
