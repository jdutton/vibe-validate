/**
 * ESLint Error Extractor
 *
 * Parses and formats ESLint error output for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, FormattedError } from './types.js';
import { MAX_ERRORS_IN_ARRAY } from './result-schema.js';

/**
 * Deduplicate ESLint errors by file:line:column
 *
 * When multiple rules report the same error at the same location,
 * prefer @typescript-eslint/* rules over base ESLint rules.
 *
 * @param errors - Array of parsed ESLint errors
 * @returns Deduplicated array of errors
 */
function deduplicateESLintErrors(errors: FormattedError[]): FormattedError[] {
  // Group errors by file:line:column
  const errorMap = new Map<string, FormattedError[]>();

  for (const error of errors) {
    const key = `${error.file}:${error.line}:${error.column}`;
    if (!errorMap.has(key)) {
      errorMap.set(key, []);
    }
    const locationErrors = errorMap.get(key);
    if (locationErrors) {
      locationErrors.push(error);
    }
  }

  // For each location, pick the best error
  const deduplicated: FormattedError[] = [];
  for (const locationErrors of errorMap.values()) {
    if (locationErrors.length === 1) {
      deduplicated.push(locationErrors[0]);
      continue;
    }

    // Prefer @typescript-eslint/* rules over base ESLint rules
    const typescriptEslintError = locationErrors.find(e => e.code?.startsWith('@typescript-eslint/'));
    if (typescriptEslintError) {
      deduplicated.push(typescriptEslintError);
    } else {
      // No typescript-eslint rule, just take the first one
      deduplicated.push(locationErrors[0]);
    }
  }

  return deduplicated;
}

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
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses ESLint output (controlled linter output), not user input
    const modernMatch = /^(.+?):(\d+):(\d+):\s+(error|warning)\s+(.+?)\s+(\S+)$/.exec(line);
    if (modernMatch) {
      const ruleMessage = modernMatch[5].trim();
      const ruleName = modernMatch[6].replace(/[[\]]/g, ''); // Remove brackets if present
      errors.push({
        file: modernMatch[1].trim(),
        line: Number.parseInt(modernMatch[2]),
        column: Number.parseInt(modernMatch[3]),
        severity: modernMatch[4] as 'error' | 'warning',
        message: `${ruleMessage} (${ruleName})`,
        code: ruleName
      });
      continue;
    }

    // Stylish format: spaces + line:col + spaces + severity + spaces + message + spaces + rule
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses ESLint output (controlled linter output), not user input
    const stylishMatch = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(\S+)\s*$/.exec(line);
    if (stylishMatch && currentFile) {
      const ruleMessage = stylishMatch[4].trim();
      const ruleName = stylishMatch[5];
      errors.push({
        file: currentFile,
        line: Number.parseInt(stylishMatch[1]),
        column: Number.parseInt(stylishMatch[2]),
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
    }
  }

  // Deduplicate errors (prefer @typescript-eslint/* rules over base ESLint rules)
  const deduplicatedErrors = deduplicateESLintErrors(errors);

  const errorCount = deduplicatedErrors.filter(e => e.severity === 'error').length;
  const warningCount = deduplicatedErrors.filter(e => e.severity === 'warning').length;

  // Build clean output (limit to MAX_ERRORS_IN_ARRAY for token efficiency)
  const errorSummary = deduplicatedErrors
    .slice(0, MAX_ERRORS_IN_ARRAY)
    .map(e => `${e.file}:${e.line}:${e.column} - ${e.message} [${e.code}]`)
    .join('\n');

  return {
    errors: deduplicatedErrors.slice(0, MAX_ERRORS_IN_ARRAY),
    summary: `${errorCount} ESLint error(s), ${warningCount} warning(s)`,
    totalErrors: deduplicatedErrors.length,
    guidance: getESLintGuidance(deduplicatedErrors),
    errorSummary
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
