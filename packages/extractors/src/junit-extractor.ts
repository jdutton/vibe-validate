/**
 * JUnit XML Error Extractor
 *
 * Parses JUnit XML test reports and formats failures for LLM consumption.
 * Supports Vitest, Jest, and other test frameworks that output JUnit XML.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, FormattedError, ExtractionMetadata } from './types.js';
import { formatCleanOutput } from './utils/formatter-utils.js';
import { generateGuidanceFromPatterns } from './utils/guidance-generator.js';

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
      totalErrors: 0,
      errorSummary: output.trim(),
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
      line = locationParts[1] ? Number.parseInt(locationParts[1], 10) : undefined;
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
  const guidance = generateGuidanceFromPatterns(failures);

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
    totalErrors: failures.length,
    errorSummary: formatCleanOutput(errors),
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

