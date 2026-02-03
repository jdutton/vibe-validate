/**
 * JUnit XML Error Extractor Plugin
 *
 * Parses JUnit XML test reports and formats failures for LLM consumption.
 * Supports Vitest, Jest, and other test frameworks that output JUnit XML.
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

// XML tag constants
const XML_TAG_TESTSUITE = '<testsuite';
const XML_TAG_TESTSUITES = '<testsuites';

/**
 * Failure information extracted from JUnit XML
 */
interface FailureInfo {
  file?: string;
  location?: string;
  message?: string;
  testName?: string;
  errorType?: string;
}

/**
 * Extract attribute value from XML tag
 */
function extractXmlAttribute(tag: string, attrName: string): string | undefined {
  const idx = tag.indexOf(`${attrName}="`);
  if (idx === -1) return undefined;
  const start = idx + `${attrName}="`.length;
  const end = tag.indexOf('"', start);
  return tag.substring(start, end);
}

/**
 * Extract failure information from JUnit XML
 */
function extractFailures(xml: string): FailureInfo[] {
  const failures: FailureInfo[] = [];
  const testcasePattern = /<testcase[^>]*>([\s\S]*?)<\/testcase>/g;
  let testcaseMatch;

  while ((testcaseMatch = testcasePattern.exec(xml)) !== null) {
    const testcaseContent = testcaseMatch[0];
    const testcaseInner = testcaseMatch[1];

    // Skip passing tests
    if (!testcaseInner.includes('<failure')) {
      continue;
    }

    // Extract testcase tag attributes
    const testcaseTagMatch = /<testcase([^>]*)>/.exec(testcaseContent);
    const testcaseTag = testcaseTagMatch ? testcaseTagMatch[1] : '';
    const file = extractXmlAttribute(testcaseTag, 'classname');
    const testName = extractXmlAttribute(testcaseTag, 'name');

    // Extract failure element
    const failurePattern = /<failure[^>]*>([\s\S]*?)<\/failure>/;
    const failureMatch = failurePattern.exec(testcaseInner);
    if (!failureMatch) {
      continue;
    }

    const failureContent = failureMatch[0];
    const failureText = failureMatch[1];

    // Extract failure attributes
    const message = extractXmlAttribute(failureContent, 'message');
    const errorType = extractXmlAttribute(failureContent, 'type');

    // Extract location from failure text (❯ file:line:column)
    // eslint-disable-next-line security/detect-unsafe-regex -- Safe: only parses JUnit XML test output (controlled output), not user input
    const locationPattern = /❯\s+([\w/.-]+):(\d+)(?::\d+)?/;
    const locationMatch = locationPattern.exec(failureText);

    let location: string | undefined;
    let extractedFile: string | undefined;

    if (locationMatch) {
      extractedFile = locationMatch[1];
      location = `${extractedFile}:${locationMatch[2]}`;
    }

    failures.push({
      file: extractedFile ?? file,
      location,
      message,
      testName,
      errorType,
    });
  }

  return failures;
}

/**
 * Decode HTML entities in XML content
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&'); // Must be last to avoid double-decoding
}

/**
 * Generate JUnit-specific guidance based on error patterns
 */
function getJUnitGuidance(failures: FailureInfo[]): string {
  const guidance: string[] = [];
  const errorTypes = new Set(failures.map((f) => f.errorType));
  const messages = failures.map((f) => f.message?.toLowerCase() ?? '');

  // Check for assertion errors
  if (errorTypes.has('AssertionError') || messages.some((m) => m.includes('expected'))) {
    guidance.push('Review test assertions - expected values may not match actual results');
  }

  // Check for type errors
  if (errorTypes.has('TypeError') || messages.some((m) => m.includes('cannot read properties'))) {
    guidance.push('Check for null/undefined values before property access');
  }

  // Check for file system errors
  if (messages.some((m) => m.includes('enoent') || m.includes('no such file'))) {
    guidance.push('Verify file paths and ensure required files exist');
  }

  // Check for timeout errors
  if (messages.some((m) => m.includes('timed out') || m.includes('timeout'))) {
    guidance.push('Consider increasing test timeout or optimizing slow operations');
  }

  if (guidance.length === 0) {
    return 'Review failing tests and fix assertion errors';
  }

  return guidance.join('. ');
}

/**
 * Extract JUnit XML errors from test output
 */
function extract(output: string): ErrorExtractorResult {
  // Validate XML structure
  if (!output.includes(XML_TAG_TESTSUITE) && !output.includes(XML_TAG_TESTSUITES)) {
    return {
      summary: 'Unable to parse JUnit XML - invalid format',
      errors: [],
      totalErrors: 0,
      errorSummary: output.trim(),
      guidance: 'Ensure the input is valid JUnit XML format',
    };
  }

  // Extract all failure elements
  const failures = extractFailures(output);
  const errors: FormattedError[] = [];

  for (const failure of failures) {
    const file = failure.file ?? 'unknown';
    const location = failure.location ?? `${file}:0`;
    const message = failure.message ?? 'Test failed';
    const context = failure.testName ?? '';

    // Parse location to get line/column
    let line: number | undefined;
    if (location) {
      const locationParts = location.split(':');
      line = locationParts[1] ? Number.parseInt(locationParts[1], 10) : undefined;
    }

    errors.push({
      file,
      line,
      message: decodeHtmlEntities(message),
      context: decodeHtmlEntities(context),
    });
  }

  // Limit errors for token efficiency
  const limitedErrors = errors.slice(0, MAX_ERRORS_IN_ARRAY);

  // Generate summary
  const failureCount = failures.length;
  const summary = `${failureCount} test(s) failed`;

  // Generate guidance based on error types
  const guidance = getJUnitGuidance(failures);

  // Build error summary
  const errorSummary = limitedErrors
    .map((e) => `${e.file ?? 'unknown'}:${e.line ?? 0} - ${e.message}`)
    .join('\n');

  return {
    summary,
    errors: limitedErrors,
    totalErrors: failures.length,
    errorSummary,
    guidance,
  };
}

/**
 * Detect if output is JUnit XML format
 */
function detect(output: string): DetectionResult {
  // Check for JUnit XML structure
  if (output.includes(XML_TAG_TESTSUITE) || output.includes(XML_TAG_TESTSUITES)) {
    // Check for failure elements
    if (output.includes('<failure')) {
      return {
        confidence: 90,
        patterns: ['<testsuite>', '<failure>'],
        reason: 'JUnit XML format with test failures detected',
      };
    }
    return {
      confidence: 85,
      patterns: ['<testsuite>'],
      reason: 'JUnit XML format detected (no failures)',
    };
  }
  return { confidence: 0, patterns: [], reason: '' };
}

/**
 * Sample test cases for JUnit extractor
 */
const samples: ExtractorSample[] = [
  {
    name: 'single-test-failure',
    description: 'Single test failure with location',
    input: `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="1" failures="1" errors="0" time="0.002">
    <testsuite name="test/calculator.test.ts" tests="1" failures="1" errors="0" skipped="0" time="0.002">
        <testcase classname="test/calculator.test.ts" name="Calculator &gt; should add numbers" time="0.001">
            <failure message="expected 4 to be 5 // Object.is equality" type="AssertionError">
AssertionError: expected 4 to be 5 // Object.is equality
 ❯ test/calculator.test.ts:10:21
            </failure>
        </testcase>
    </testsuite>
</testsuites>`,
    expected: {
      totalErrors: 1,
      summary: '1 test(s) failed',
    },
  },
  {
    name: 'multiple-test-failures',
    description: 'Multiple test failures from different test cases',
    input: `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="2" errors="0" time="0.006">
    <testsuite name="test/math.test.ts" tests="3" failures="2" errors="0" skipped="0" time="0.006">
        <testcase classname="test/math.test.ts" name="Math &gt; should multiply" time="0.002">
            <failure message="expected 6 to be 8 // Object.is equality" type="AssertionError">
AssertionError: expected 6 to be 8 // Object.is equality
 ❯ test/math.test.ts:15:20
            </failure>
        </testcase>
        <testcase classname="test/math.test.ts" name="Math &gt; should subtract" time="0.003">
            <failure message="expected -1 to be 0 // Object.is equality" type="AssertionError">
AssertionError: expected -1 to be 0 // Object.is equality
 ❯ test/math.test.ts:25:22
            </failure>
        </testcase>
    </testsuite>
</testsuites>`,
    expected: {
      totalErrors: 2,
      summary: '2 test(s) failed',
    },
  },
];

/**
 * JUnit XML Error Extractor Plugin
 *
 * Extracts test failures from JUnit XML reports with high confidence (90%).
 * Supports Vitest, Jest, and other test frameworks using JUnit XML output.
 */
const junitPlugin: ExtractorPlugin = {
  metadata: {
    name: 'junit',
    version: '1.0.0',
    author: 'vibe-validate',
    description: 'Extracts test failures from JUnit XML reports',
    repository: 'https://github.com/jdutton/vibe-validate',
    tags: ['junit', 'xml', 'testing', 'vitest', 'jest'],
  },
  hints: {
    required: [XML_TAG_TESTSUITE],
    anyOf: [],
  },
  priority: 90,
  detect,
  extract,
  samples,
};

export default junitPlugin;
