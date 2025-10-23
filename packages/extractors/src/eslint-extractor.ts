/**
 * ESLint Error Extractor
 *
 * Parses and formats ESLint error output for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, FormattedError } from './types.js';

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
 * const result = extractESLintErrors(eslintOutput);
 * console.log(result.summary); // "5 ESLint error(s), 2 warning(s)"
 * console.log(result.guidance); // "Remove or prefix unused variables with underscore"
 * ```
 */
export function extractESLintErrors(output: string): ErrorExtractorResult {
  const errors: FormattedError[] = [];
  const lines = output.split('\n');
  let currentFile = '';

  for (const line of lines) {
    // Try modern format first: file:line:col: severity message [rule-name]
    const modernMatch = line.match(/^(.+?):(\d+):(\d+):\s+(error|warning)\s+(.+?)\s+(\S+)$/);
    if (modernMatch) {
      const ruleMessage = modernMatch[5].trim();
      const ruleName = modernMatch[6].replace(/[[\]]/g, ''); // Remove brackets if present
      errors.push({
        file: modernMatch[1].trim(),
        line: parseInt(modernMatch[2]),
        column: parseInt(modernMatch[3]),
        severity: modernMatch[4] as 'error' | 'warning',
        message: `${ruleMessage} (${ruleName})`,
        code: ruleName
      });
      continue;
    }

    // Stylish format: spaces + line:col + spaces + severity + spaces + message + spaces + rule
    const stylishMatch = line.match(/^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(\S+)\s*$/);
    if (stylishMatch && currentFile) {
      const ruleMessage = stylishMatch[4].trim();
      const ruleName = stylishMatch[5];
      errors.push({
        file: currentFile,
        line: parseInt(stylishMatch[1]),
        column: parseInt(stylishMatch[2]),
        severity: stylishMatch[3] as 'error' | 'warning',
        message: `${ruleMessage} (${ruleName})`,
        code: ruleName
      });
      continue;
    }

    // Check if this is a file path line for stylish format (no colons, just a path)
    if (line && !line.includes(':') && !line.startsWith(' ') && !line.startsWith('\t') && (line.includes('/') || line.includes('\\'))) {
      // Potential file path for stylish format
      currentFile = line.trim();
      continue;
    }
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
