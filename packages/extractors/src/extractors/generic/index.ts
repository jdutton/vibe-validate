/**
 * Generic Error Extractor Plugin
 *
 * Fallback extractor for unknown validation step types.
 * Intelligently extracts error keywords and relevant lines for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ExtractorPlugin, DetectionResult, ErrorExtractorResult } from '../../types.js';

/**
 * Error keyword patterns for intelligent extraction
 */
const ERROR_KEYWORDS = [
  'failed', 'fail', 'error', 'exception', 'traceback', 'assertionerror',
  'typeerror', 'valueerror', 'panic:', 'fatal:', 'syntaxerror', 'referenceerror',
  'comparisonerror', 'comparisonfailure', 'arithmeticexception',
  'at ', '-->', 'undefined:',
];

/**
 * Noise patterns to filter out
 */
const NOISE_PATTERNS = [
  /^>/,
  /npm ERR!/,
  /^npm WARN/,
  /^warning:/i,
  /node_modules/,
  /^Download/i,
  /^Resolving packages/i,
  /^Already up[- ]to[- ]date/i,
];

/**
 * Generic extractor always accepts (lowest priority fallback)
 */
export function detectGeneric(_output: string): DetectionResult {
  return {
    confidence: 10, // Lowest priority
    patterns: ['Generic fallback'],
    reason: 'Fallback extractor for unknown formats',
  };
}

/**
 * Generic error extractor (fallback)
 *
 * Intelligently extracts error information by:
 * - Identifying lines with error keywords
 * - Extracting file paths with line numbers
 * - Capturing summary lines
 * - Removing npm/package manager noise
 * - Limiting to 20 most relevant lines
 */
export function extractGeneric(output: string, _command?: string): ErrorExtractorResult {
  const lines = output.split('\n');
  const relevantLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (NOISE_PATTERNS.some((pattern) => pattern.test(line))) continue;

    const lineLower = line.toLowerCase();
    const hasErrorKeyword = ERROR_KEYWORDS.some((keyword) => lineLower.includes(keyword));
    // Optimized: Use atomic groups or possessive quantifiers equivalent - simple alternation
    const hasFileLineRef = /(?:\.py|\.go|\.rs|\.rb|\.java|\.cpp|\.c|\.h|\.js|\.ts|\.tsx|\.jsx):\d+/.test(line);
    // Optimized: Use substring checks to avoid regex backtracking entirely
    const isSummaryLine =
      lineLower.includes(' failed') ||
      lineLower.includes(' passed') ||
      lineLower.includes(' error') ||
      lineLower.includes(' success') ||
      lineLower.includes(' example');

    if (hasErrorKeyword || hasFileLineRef || isSummaryLine) {
      relevantLines.push(line);
    }
  }

  let errorSummary: string;
  if (relevantLines.length > 0) {
    errorSummary = relevantLines.slice(0, 20).join('\n');
  } else {
    errorSummary = lines
      .filter((line) => {
        if (line.trim() === '') return false;
        if (NOISE_PATTERNS.some((pattern) => pattern.test(line))) return false;
        return true;
      })
      .slice(0, 20)
      .join('\n');
  }

  const hasErrors = relevantLines.length > 0;

  return {
    errors: [],
    summary: hasErrors ? 'Command failed - see output' : 'No errors detected',
    totalErrors: 0,
    guidance: hasErrors ? 'Review the output above and fix the errors' : '',
    errorSummary,
    metadata: {
      detection: {
        extractor: 'generic',
        confidence: 10,
        patterns: ['Generic fallback'],
        reason: 'Fallback extractor',
      },
      confidence: 50,
      completeness: 50,
      issues: [],
    },
  };
}

/**
 * Generic Extractor Plugin (Fallback)
 */
const genericExtractor: ExtractorPlugin = {
  metadata: {
    name: 'generic',
    version: '1.0.0',
    author: 'Jeff Dutton <jeff@duckcreek.com>',
    description: 'Fallback extractor for unknown validation output formats',
    repository: 'https://github.com/jdutton/vibe-validate',
    tags: ['generic', 'fallback'],
  },

  hints: undefined, // No hints - accepts everything

  priority: 10, // Lowest priority (fallback)

  detect: detectGeneric,
  extract: extractGeneric,

  samples: [
    {
      name: 'python-pytest',
      description: 'Python pytest output',
      input: `FAILED tests/test_foo.py::test_divide - ZeroDivisionError
FAILED tests/test_bar.py::test_validate - AssertionError
2 failed, 3 passed`,
      expected: {
        totalErrors: 0, // Generic doesn't populate errors array
      },
    },
  ],
};

export default genericExtractor;
