/**
 * Formatter Utilities for Error Extractors
 *
 * Shared formatting functions used across multiple extractors to format
 * errors for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { FormattedError } from '../types.js';

/**
 * Format clean output for LLM consumption
 *
 * Converts structured errors into a compact, readable format suitable
 * for AI assistants and developers.
 *
 * @param errors - Array of formatted errors
 * @returns Formatted error string, one error per line
 *
 * @example
 * ```typescript
 * const errors: FormattedError[] = [
 *   { file: 'test.ts', line: 42, message: 'Expected true, got false', context: 'should pass' }
 * ];
 * const output = formatCleanOutput(errors);
 * // Output: "test.ts:42: Expected true, got false (should pass)"
 * ```
 */
export function formatCleanOutput(errors: FormattedError[]): string {
  if (errors.length === 0) {
    return '';
  }

  return errors
    .map((error) => {
      const location = error.line ? `${error.file ?? 'unknown'}:${error.line}` : (error.file ?? 'unknown');
      const contextStr = error.context ? ` (${error.context})` : '';
      return `${location}: ${error.message}${contextStr}`;
    })
    .join('\n');
}
