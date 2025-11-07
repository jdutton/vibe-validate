/**
 * Guidance Generator Utilities for Error Extractors
 *
 * Shared logic for generating actionable guidance from test failures.
 * Uses pattern matching to categorize errors and suggest fixes.
 *
 * @package @vibe-validate/extractors
 */

/**
 * Pattern for detecting specific error types and providing guidance
 */
export interface GuidancePattern {
  /** Unique key to prevent duplicate guidance */
  key: string;
  /** Strings to match in error messages */
  messageMatchers: string[];
  /** Error type strings to match (e.g., "TypeError", "AssertionError") */
  errorTypeMatchers?: string[];
  /** Actionable guidance to provide when pattern matches */
  guidance: string;
}

/**
 * Common guidance patterns used across test frameworks
 *
 * These patterns detect common error types and provide standardized
 * guidance that works across Jasmine, Mocha, Jest, Vitest, TAP, etc.
 */
export const COMMON_GUIDANCE_PATTERNS: GuidancePattern[] = [
  {
    key: 'assertion',
    messageMatchers: ['Expected', 'expected', 'should'],
    errorTypeMatchers: ['AssertionError'],
    guidance: 'Review test assertions and expected values'
  },
  {
    key: 'timeout',
    messageMatchers: ['Timeout', 'timeout', 'exceeded', 'did not complete', 'timed out'],
    guidance: 'Increase test timeout or optimize async operations'
  },
  {
    key: 'type',
    messageMatchers: ['Cannot read properties', 'typeerror'],
    errorTypeMatchers: ['TypeError'],
    guidance: 'Check for null/undefined values and type mismatches'
  },
  {
    key: 'file',
    messageMatchers: ['ENOENT', 'no such file'],
    guidance: 'Verify file paths and ensure test fixtures exist'
  },
  {
    key: 'module',
    messageMatchers: ['Cannot find module', 'Cannot find package'],
    guidance: 'Install missing dependencies or check import paths'
  }
];

/**
 * Minimal failure interface for guidance generation
 *
 * Extractors can use any failure structure as long as it has these fields.
 */
export interface FailureWithMessage {
  message?: string;
  errorType?: string;
}

/**
 * Generate guidance from failure patterns
 *
 * Analyzes failures using configurable patterns and returns actionable guidance.
 * Prevents duplicate guidance by tracking which patterns have already matched.
 *
 * @param failures - Array of failures with message and/or errorType
 * @param patterns - Guidance patterns to match against (defaults to COMMON_GUIDANCE_PATTERNS)
 * @returns Newline-separated guidance strings, or empty string if no matches
 *
 * @example
 * ```typescript
 * const failures = [
 *   { message: 'Expected true, got false', errorType: 'AssertionError' },
 *   { message: 'Timeout after 5000ms', errorType: 'Error' }
 * ];
 *
 * const guidance = generateGuidanceFromPatterns(failures);
 * // Returns:
 * // "Review test assertions and expected values
 * // Increase test timeout or optimize async operations"
 * ```
 *
 * @example
 * ```typescript
 * // With custom patterns
 * const customPatterns: GuidancePattern[] = [
 *   ...COMMON_GUIDANCE_PATTERNS,
 *   {
 *     key: 'snapshot',
 *     messageMatchers: ['Snapshot', 'snapshot'],
 *     guidance: 'Update snapshots with --update-snapshots flag'
 *   }
 * ];
 *
 * const guidance = generateGuidanceFromPatterns(failures, customPatterns);
 * ```
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 17 acceptable for guidance generation (categorizes multiple error types across different test frameworks and generates actionable suggestions)
export function generateGuidanceFromPatterns(
  failures: FailureWithMessage[],
  patterns: GuidancePattern[] = COMMON_GUIDANCE_PATTERNS
): string {
  const guidances: string[] = [];
  const seen = new Set<string>();

  for (const failure of failures) {
    const message = failure.message ?? '';
    const errorType = failure.errorType;

    for (const pattern of patterns) {
      // Skip if we've already added guidance for this pattern
      if (seen.has(pattern.key)) {
        continue;
      }

      // Check error type matches (if pattern specifies error types)
      if (pattern.errorTypeMatchers && errorType) {
        if (pattern.errorTypeMatchers.includes(errorType)) {
          guidances.push(pattern.guidance);
          seen.add(pattern.key);
          continue;
        }
      }

      // Check message matches
      const messageMatches = pattern.messageMatchers.some((matcher) =>
        message.includes(matcher)
      );

      if (messageMatches) {
        guidances.push(pattern.guidance);
        seen.add(pattern.key);
      }
    }
  }

  return guidances.join('\n');
}
