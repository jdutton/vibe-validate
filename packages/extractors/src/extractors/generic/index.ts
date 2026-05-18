/**
 * Generic Error Extractor Plugin
 *
 * Fallback extractor for unknown validation step types.
 * Intelligently extracts error keywords and relevant lines for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ExtractorPlugin, DetectionResult, ErrorExtractorResult } from '../../types.js';

const GENERIC_FALLBACK_PATTERN = 'Generic fallback';

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
 * Max lines retained when preserving structured YAML output.
 * Higher than the keyword-filter cap (20) because structured data needs
 * surrounding context to remain meaningful.
 */
const YAML_MAX_LINES = 80;

const TOP_LEVEL_YAML_KEY = /^[A-Za-z_][\w-]*:(?:\s|$)/;

const LOG_INDICATORS = [
  'Traceback (most recent',
  'npm ERR!',
];

/**
 * Per-alternative regexes for YAML line classification. Each is anchored and
 * matches a single non-overlapping leading-character class, so checking each
 * in sequence is linear and ReDoS-safe (no nested quantifiers, no
 * greedy/lazy interplay).
 *
 * Split into individual literals (rather than one fat alternation) to keep
 * each pattern's complexity low and readable.
 */
const YAML_BLANK_LINE = /^\s*$/;                                // empty / whitespace-only line
const YAML_COMMENT_LINE = /^\s*#/;                              // comment
const YAML_DOC_MARKER = /^(?:---|\.\.\.)\s*$/;                  // document start/end marker
const YAML_INDENTED_LINE = /^[ \t]+\S/;                         // indented content (continuation/nested key/sequence value)
const YAML_ROOT_SEQUENCE = /^-(?: |$)/;                         // root-level sequence item ("- foo" or bare "-")
const YAML_PLAIN_ROOT_KEY = /^[A-Za-z_][\w.-]*\s*:(?: |$)/;     // plain root key ("name:" or "name: value")
const YAML_QUOTED_ROOT_KEY = /^(?:"[^"\n]*"|'[^'\n]*')\s*:(?: |$)/;  // quoted root key

/** True if the line is content-bearing YAML (key or root sequence item). */
function isYamlContentLine(line: string): boolean {
  return (
    YAML_ROOT_SEQUENCE.test(line) ||
    YAML_PLAIN_ROOT_KEY.test(line) ||
    YAML_QUOTED_ROOT_KEY.test(line)
  );
}

/** True if the line "looks like YAML" structure (content, indent, marker, blank, or comment). */
function isYamlStructuralLine(line: string): boolean {
  return (
    YAML_BLANK_LINE.test(line) ||
    YAML_COMMENT_LINE.test(line) ||
    YAML_DOC_MARKER.test(line) ||
    YAML_INDENTED_LINE.test(line) ||
    isYamlContentLine(line)
  );
}

/**
 * After the opening `---`, verifies that the first non-blank/non-comment line
 * is a content-bearing YAML line (key or root sequence item).
 */
function hasYamlContentAfter(lines: string[], startIndex: number): boolean {
  for (const line of lines.slice(startIndex)) {
    if (line.trim() === '') continue;
    if (YAML_COMMENT_LINE.test(line)) continue;
    return isYamlContentLine(line);
  }
  return false;
}

/**
 * Collects lines starting at `openingIndex` (the opening `---`) forward,
 * stopping inclusively at a closing doc marker (`---` / `...`) or exclusively
 * before the first non-YAML-structural line.
 */
function collectYamlBlockLines(lines: string[], openingIndex: number): string[] {
  const kept: string[] = [lines[openingIndex]];
  for (const line of lines.slice(openingIndex + 1)) {
    const trimmed = line.trim();
    if (trimmed === '---' || trimmed === '...') {
      kept.push(line);
      return kept;
    }
    if (!isYamlStructuralLine(line)) return kept;
    kept.push(line);
  }
  return kept;
}

/**
 * Detects a `---`-bracketed YAML block embedded in noisy output and extracts
 * only the YAML portion (opening `---` through closing doc marker or first
 * non-YAML line). Returns null if no valid block is found.
 */
function extractDelimitedYamlBlock(lines: string[]): string[] | null {
  const openingIndex = lines.findIndex((line) => line.trim() === '---');
  if (openingIndex < 0) return null;
  if (!hasYamlContentAfter(lines, openingIndex + 1)) return null;

  const kept = collectYamlBlockLines(lines, openingIndex);
  if (kept.length < 3) return null;
  return kept;
}

/**
 * Heuristic: does this output look like structured YAML rather than a free-form log?
 *
 * Free-form logs occasionally contain `key:` fragments, so we require multiple
 * top-level keys plus the absence of log-line giveaways (stack traces, npm
 * errors, file-path "at /..." frames, caret indicators).
 */
function looksLikeYaml(lines: string[]): boolean {
  let topLevelKeyCount = 0;
  let meaningfulLineCount = 0;

  for (const line of lines) {
    if (line.trim() === '') continue;
    if (NOISE_PATTERNS.some((pattern) => pattern.test(line))) continue;
    meaningfulLineCount++;

    if (TOP_LEVEL_YAML_KEY.test(line)) {
      topLevelKeyCount++;
    }

    if (LOG_INDICATORS.some((indicator) => line.includes(indicator))) {
      return false;
    }
    if (/^\s*at \//.test(line)) return false;
    if (/^\s*\^+\s*$/.test(line)) return false;
  }

  return topLevelKeyCount >= 3 && meaningfulLineCount >= 5;
}

/**
 * Generic extractor always accepts (lowest priority fallback)
 */
export function detectGeneric(_output: string): DetectionResult {
  return {
    confidence: 10, // Lowest priority
    patterns: [GENERIC_FALLBACK_PATTERN],
    reason: 'Fallback extractor for unknown formats',
  };
}

/**
 * Shared detection metadata block used by both the YAML-preservation and
 * keyword-filter result paths. Kept in sync with `detectGeneric` confidence.
 */
function genericDetectionMetadata() {
  return {
    extractor: 'generic',
    confidence: 10,
    patterns: [GENERIC_FALLBACK_PATTERN],
    reason: 'Fallback extractor',
  };
}

function buildYamlResult(lines: string[]): ErrorExtractorResult {
  const denoised = lines.filter(
    (line) => line.trim() === '' || !NOISE_PATTERNS.some((pattern) => pattern.test(line))
  );
  const truncated = denoised.length > YAML_MAX_LINES;
  const kept = truncated ? denoised.slice(0, YAML_MAX_LINES) : denoised;
  const errorSummary = truncated
    ? `${kept.join('\n')}\n... (truncated at ${YAML_MAX_LINES} lines)`
    : kept.join('\n');

  return {
    errors: [],
    summary: 'Command failed - see output',
    totalErrors: 0,
    guidance: 'Review the output above and fix the errors',
    errorSummary,
    metadata: {
      detection: genericDetectionMetadata(),
      confidence: 50,
      completeness: 50,
      issues: [],
    },
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

  const delimited = extractDelimitedYamlBlock(lines);
  if (delimited) {
    return buildYamlResult(delimited);
  }
  if (looksLikeYaml(lines)) {
    return buildYamlResult(lines);
  }

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
      detection: genericDetectionMetadata(),
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
