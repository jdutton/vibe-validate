/**
 * Generic Error Extractor
 *
 * Fallback extractor for unknown validation step types.
 * Intelligently extracts error keywords and relevant lines for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult } from './types.js';

/**
 * Error keyword patterns for intelligent extraction
 *
 * Note: Case-insensitive matching done via toLowerCase() in logic
 */
const ERROR_KEYWORDS = [
  'failed',
  'fail',
  'error',
  'exception',
  'traceback',
  'assertionerror',
  'typeerror',
  'valueerror',
  'panic:',
  'fatal:',
  'syntaxerror',
  'referenceerror',
  'comparisonerror',  // JUnit
  'comparisonfailure',  // JUnit
  'arithmeticexception',  // Java
  'at ',  // Stack trace lines
  '-->',  // Rust error pointers
  'undefined:',  // Go/JS undefined errors
];

/**
 * Noise patterns to filter out
 */
const NOISE_PATTERNS = [
  /^>/,  // npm script headers
  /npm ERR!/,
  /^npm WARN/,
  /^warning:/i,  // Generic warnings (keep errors)
  /node_modules/,  // Dependency paths
  /^Download/i,
  /^Resolving packages/i,
  /^Already up[- ]to[- ]date/i,
];

/**
 * Generic error extractor (fallback)
 *
 * Intelligently extracts error information by:
 * - Identifying lines with error keywords (FAILED, Error, Exception, etc.)
 * - Extracting file paths with line numbers (test.py:42, main.go:15)
 * - Capturing summary lines (X failed, Y passed)
 * - Removing npm/package manager noise
 * - Limiting to 15-20 most relevant lines for token efficiency
 *
 * @param output - Raw command output
 * @returns Structured error information with keyword-extracted summary
 *
 * @example
 * ```typescript
 * // Python pytest output
 * const result = extractGenericErrors(pytestOutput);
 * // errorSummary contains only: FAILED lines, AssertionError, summary
 *
 * // Go test output
 * const result = extractGenericErrors(goTestOutput);
 * // errorSummary contains only: FAIL lines, panic:, file:line references
 * ```
 */
export function extractGenericErrors(output: string): ErrorExtractorResult {
  const lines = output.split('\n');

  // Step 1: Extract lines with error keywords or file:line patterns
  const relevantLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === '') continue;

    // Skip noise patterns
    if (NOISE_PATTERNS.some(pattern => pattern.test(line))) continue;

    // Include if contains error keywords (case-insensitive)
    const lineLower = line.toLowerCase();
    const hasErrorKeyword = ERROR_KEYWORDS.some(keyword => lineLower.includes(keyword));

    // Include if looks like file:line reference (e.g., test.py:42, main.go:15:10)
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: matches file paths in validation output (controlled input), limited line length, simple pattern with no nested quantifiers
    const hasFileLineRef = /\w+\.(py|go|rs|rb|java|cpp|c|h|js|ts|tsx|jsx):\d+/.test(line);

    // Include if looks like a summary line (e.g., "2 failed, 3 passed", "X examples")
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: matches summary lines in validation output (controlled input), limited line length, simple pattern with no nested quantifiers
    const isSummaryLine = /\d+\s+(failed|passed|error|success|example)/i.test(line);

    if (hasErrorKeyword || hasFileLineRef || isSummaryLine) {
      relevantLines.push(line);
    }
  }

  // Step 2: If we found relevant lines, use them; otherwise fall back to basic cleaning
  let errorSummary: string;

  if (relevantLines.length > 0) {
    // Limit to first 20 relevant lines
    errorSummary = relevantLines.slice(0, 20).join('\n');
  } else {
    // Fallback: Basic cleaning (remove noise, limit to 20 lines)
    errorSummary = lines
      .filter(line => {
        if (line.trim() === '') return false;
        if (NOISE_PATTERNS.some(pattern => pattern.test(line))) return false;
        return true;
      })
      .slice(0, 20)
      .join('\n');
  }

  // Determine if errors were detected based on extracted content
  const hasErrors = relevantLines.length > 0;

  return {
    errors: [],
    summary: hasErrors ? 'Command failed - see output' : 'No errors detected',
    totalCount: hasErrors ? 1 : 0,
    guidance: hasErrors ? 'Review the output above and fix the errors' : '',
    errorSummary
  };
}
