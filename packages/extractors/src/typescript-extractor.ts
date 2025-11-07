/**
 * TypeScript Error Extractor
 *
 * Parses and formats TypeScript compiler (tsc) error output for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, FormattedError } from './types.js';
import { MAX_ERRORS_IN_ARRAY } from './result-schema.js';

/**
 * Format TypeScript compiler errors
 *
 * Parses tsc output format: `file(line,col): error TSxxxx: message`
 *
 * @param output - Raw tsc command output
 * @returns Structured error information with TypeScript-specific guidance
 *
 * @example
 * ```typescript
 * const result = extractTypeScriptErrors(tscOutput);
 * console.log(result.summary); // "3 type error(s), 0 warning(s)"
 * console.log(result.guidance); // "Type mismatch - check variable/parameter types"
 * ```
 */
export function extractTypeScriptErrors(output: string): ErrorExtractorResult {
  const errors: FormattedError[] = [];

  // TypeScript error patterns - support both old and new formats:
  // Old: file(line,col): error TSxxxx: message
  // New: file:line:col - error TSxxxx: message
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses TypeScript compiler output (controlled tool output), not user input
  const oldPattern = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s+(.+)$/gm;
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses TypeScript compiler output (controlled tool output), not user input
  const newPattern = /^(.+?):(\d+):(\d+)\s+-\s*(error|warning)\s+(TS\d+):\s+(.+)$/gm;

  // Try new format first (more common in modern tsc)
  let match;
  while ((match = newPattern.exec(output)) !== null) {
    errors.push({
      file: match[1].trim(),
      line: Number.parseInt(match[2]),
      column: Number.parseInt(match[3]),
      severity: match[4] as 'error' | 'warning',
      code: match[5],
      message: match[6].trim()
    });
  }

  // Try old format if no matches yet
  if (errors.length === 0) {
    while ((match = oldPattern.exec(output)) !== null) {
      errors.push({
        file: match[1].trim(),
        line: Number.parseInt(match[2]),
        column: Number.parseInt(match[3]),
        severity: match[4] as 'error' | 'warning',
        code: match[5],
        message: match[6].trim()
      });
    }
  }

  const errorCount = errors.filter(e => e.severity === 'error').length;
  const warningCount = errors.filter(e => e.severity === 'warning').length;

  // Build error summary (limit to MAX_ERRORS_IN_ARRAY for token efficiency)
  const errorSummary = errors
    .slice(0, MAX_ERRORS_IN_ARRAY)
    .map(e => `${e.file}:${e.line}:${e.column} - ${e.code}: ${e.message}`)
    .join('\n');

  return {
    errors: errors.slice(0, MAX_ERRORS_IN_ARRAY),
    summary: `${errorCount} type error(s), ${warningCount} warning(s)`,
    totalErrors: errors.length,
    guidance: getTypeScriptGuidance(errors),
    errorSummary
  };
}

/**
 * Generate TypeScript-specific guidance based on error codes
 *
 * @param errors - Parsed TypeScript errors
 * @returns Actionable guidance string
 */
function getTypeScriptGuidance(errors: FormattedError[]): string {
  const errorCodes = new Set(errors.map(e => e.code));
  const guidance: string[] = [];

  if (errorCodes.has('TS2322')) {
    guidance.push('Type mismatch - check variable/parameter types');
  }

  if (errorCodes.has('TS2304')) {
    guidance.push('Cannot find name - check imports and type definitions');
  }

  if (errorCodes.has('TS2345')) {
    guidance.push('Argument type mismatch - check function signatures');
  }

  if (guidance.length === 0) {
    return 'Fix TypeScript type errors in listed files';
  }

  return guidance.join('. ');
}
