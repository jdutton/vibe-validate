/**
 * JUnit XML Error Extractor
 *
 * Parses JUnit XML test reports and formats failures for LLM consumption.
 * Supports Vitest, Jest, and other test frameworks that output JUnit XML.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, FormattedError, ExtractionMetadata } from './types.js';

/**
 * Extract errors from JUnit XML test output
 *
 * @param output - JUnit XML string
 * @returns Structured error information
 *
 * @example
 * ```typescript
 * const junitXml = fs.readFileSync('junit.xml', 'utf-8');
 * const result = extractJUnitErrors(junitXml);
 * console.log(result.summary); // "5 test(s) failed"
 * ```
 */
export function extractJUnitErrors(output: string): ErrorExtractorResult {
  // Note: ANSI codes are stripped centrally in smart-extractor.ts

  // Try to parse XML
  let isValidXml = false;
  try {
    // Simple XML parsing - look for <testsuite> and <testcase> elements
    isValidXml = parseSimpleXML(output);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      summary: `Unable to parse JUnit XML - invalid format: ${errorMsg}`,
      errors: [],
      totalCount: 0,
      cleanOutput: output.trim(),
      guidance: 'Ensure the input is valid JUnit XML format',
      metadata: {
        confidence: 0,
        completeness: 0,
        issues: ['Failed to parse XML']
      }
    };
  }

  if (!isValidXml) {
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

  // Extract all failure elements
  const failures = extractFailures(output);
  const errors: FormattedError[] = [];

  let completeCount = 0;

  for (const failure of failures) {
    const file = failure.file ?? 'unknown';
    const location = failure.location ?? `${file}:0`;
    const message = failure.message ?? 'Test failed';
    const context = failure.testName ?? '';

    const isComplete = file !== 'unknown' && failure.location && message;
    if (isComplete) {
      completeCount++;
    }

    // Parse location to get line/column (only if location exists)
    let line: number | undefined;
    if (location) {
      const locationParts = location.split(':');
      line = locationParts[1] ? parseInt(locationParts[1], 10) : undefined;
    }

    errors.push({
      file,
      line,
      message: decodeHtmlEntities(message),
      context: decodeHtmlEntities(context)
    });
  }

  // Generate summary
  const failureCount = failures.length;
  const summary = `${failureCount} test(s) failed`;

  // Generate guidance based on error types
  const guidance = generateGuidance(failures);

  // Calculate quality metadata
  const completeness = failures.length > 0 ? (completeCount / failures.length) * 100 : 100;
  const confidence = failures.length > 0 ? 95 : 100; // High confidence for JUnit XML

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
 * Simple XML parser for JUnit format
 * (We avoid full XML parsers to minimize dependencies)
 */
function parseSimpleXML(xml: string): boolean {
  // Check if it contains testsuite elements
  if (!xml.includes('<testsuite') && !xml.includes('<testsuites')) {
    throw new Error('Not JUnit XML format');
  }

  // Validate basic XML structure
  if (!xml.includes('<?xml') && !xml.includes('<testsuite')) {
    throw new Error('Invalid XML structure');
  }

  // Return that XML is valid
  return true;
}

/**
 * Extract failure information from JUnit XML
 */
interface FailureInfo {
  file?: string;
  location?: string;
  message?: string;
  testName?: string;
  errorType?: string;
}

function extractFailures(xml: string): FailureInfo[] {
  const failures: FailureInfo[] = [];

  // Match all <testcase> elements with <failure> children
  const testcasePattern = /<testcase[^>]*>([\s\S]*?)<\/testcase>/g;
  let testcaseMatch;

  while ((testcaseMatch = testcasePattern.exec(xml)) !== null) {
    const testcaseContent = testcaseMatch[0];
    const testcaseInner = testcaseMatch[1];

    // Check if this testcase has a failure
    if (!testcaseInner.includes('<failure')) {
      continue; // Skip passing tests
    }

    // Extract attributes from testcase opening tag using more reliable string extraction
    const testcaseTagMatch = /<testcase([^>]*)>/.exec(testcaseContent);
    const testcaseTag = testcaseTagMatch ? testcaseTagMatch[1] : '';

    // Extract classname using indexOf/substring (more reliable than regex for attributes with special chars)
    let file: string | undefined;
    const classnameIdx = testcaseTag.indexOf('classname="');
    if (classnameIdx !== -1) {
      const start = classnameIdx + 'classname="'.length;
      const end = testcaseTag.indexOf('"', start);
      file = testcaseTag.substring(start, end);
    }

    // Extract name (test hierarchy) similarly
    let testName: string | undefined;
    const nameIdx = testcaseTag.indexOf('name="');
    if (nameIdx !== -1) {
      const start = nameIdx + 'name="'.length;
      const end = testcaseTag.indexOf('"', start);
      testName = testcaseTag.substring(start, end);
    }

    // Extract failure element
    const failurePattern = /<failure[^>]*>([\s\S]*?)<\/failure>/;
    const failureMatch = failurePattern.exec(testcaseInner);

    if (!failureMatch) {
      continue;
    }

    const failureContent = failureMatch[0];
    const failureText = failureMatch[1];

    // Extract message attribute
    const messageMatch = /message="([^"]+)"/.exec(failureContent);
    const message = messageMatch ? messageMatch[1] : undefined;

    // Extract error type
    const typeMatch = /type="([^"]+)"/.exec(failureContent);
    const errorType = typeMatch ? typeMatch[1] : undefined;

    // Extract location from failure text (❯ file:line:column)
    // Note: We strip column number to keep format consistent (file:line)
    // Pattern allows word chars, forward slashes, dots, and hyphens in paths
    const locationPattern = /❯\s+([\w/.-]+):(\d+)(?::\d+)?/;
    const locationMatch = locationPattern.exec(failureText);

    let location: string | undefined;
    let extractedFile: string | undefined;

    if (locationMatch) {
      extractedFile = locationMatch[1];
      const line = locationMatch[2];
      location = `${extractedFile}:${line}`;
    }
    // No fallback - if no location found in failure text, leave location undefined

    failures.push({
      file: extractedFile ?? file,
      location,
      message,
      testName,
      errorType
    });
  }

  return failures;
}

/**
 * Decode HTML entities in XML content
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // Must be last to avoid double-decoding
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
    if (errorType === 'AssertionError' || message.includes('expected')) {
      if (!seen.has('assertion')) {
        guidances.push('Review test assertions and expected values');
        seen.add('assertion');
      }
    }

    // Timeout errors
    if (message.includes('timed out') || message.includes('timeout')) {
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
