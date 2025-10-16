/**
 * ESLint Error Formatter
 *
 * Parses and formats ESLint error output for LLM consumption.
 *
 * @package @vibe-validate/formatters
 */

import type { ErrorFormatterResult, FormattedError } from './types.js';

/**
 * Format ESLint errors
 *
 * Parses ESLint output format: `file:line:col - severity message [rule-name]`
 *
 * @param output - Raw ESLint command output
 * @returns Structured error information with ESLint-specific guidance
 *
 * @example
 * ```typescript
 * const result = formatESLintErrors(eslintOutput);
 * console.log(result.summary); // "5 ESLint error(s), 2 warning(s)"
 * console.log(result.guidance); // "Remove or prefix unused variables with underscore"
 * ```
 */
export function formatESLintErrors(output: string): ErrorFormatterResult {
  const errors: FormattedError[] = [];

  // ESLint error pattern (modern format): file:line:col - severity message [rule-name]
  const eslintPattern = /^(.+?):(\d+):(\d+):\s+(error|warning)\s+(.+?)\s+(\S+)$/gm;

  let match;
  while ((match = eslintPattern.exec(output)) !== null) {
    errors.push({
      file: match[1].trim(),
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      severity: match[4] as 'error' | 'warning',
      message: match[5].trim(),
      code: match[6]  // Rule name
    });
  }

  const errorCount = errors.filter(e => e.severity === 'error').length;
  const warningCount = errors.filter(e => e.severity === 'warning').length;

  // Build clean output (limit to first 10 for token efficiency)
  const cleanOutput = errors
    .slice(0, 10)
    .map(e => `${e.file}:${e.line}:${e.column} - ${e.message} [${e.code}]`)
    .join('\n');

  return {
    errors: errors.slice(0, 10),
    summary: `${errorCount} ESLint error(s), ${warningCount} warning(s)`,
    totalCount: errors.length,
    guidance: getESLintGuidance(errors),
    cleanOutput
  };
}

/**
 * Generate ESLint-specific guidance based on rule violations
 *
 * @param errors - Parsed ESLint errors
 * @returns Actionable guidance string
 */
function getESLintGuidance(errors: FormattedError[]): string {
  const rules = new Set(errors.map(e => e.code));
  const guidance: string[] = [];

  if (rules.has('@typescript-eslint/no-unused-vars')) {
    guidance.push('Remove or prefix unused variables with underscore');
  }

  if (rules.has('no-console')) {
    guidance.push('Replace console.log with logger');
  }

  if (guidance.length === 0) {
    return 'Fix ESLint errors - run with --fix to auto-fix some issues';
  }

  return guidance.join('. ');
}
