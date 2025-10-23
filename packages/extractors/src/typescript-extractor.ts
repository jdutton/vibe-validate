/**
 * TypeScript Error Extractor
 *
 * Parses and formats TypeScript compiler (tsc) error output for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, FormattedError } from './types.js';

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

  // TypeScript error pattern: file(line,col): error TSxxxx: message
  const tsErrorPattern = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s+(.+)$/gm;

  let match;
  while ((match = tsErrorPattern.exec(output)) !== null) {
    errors.push({
      file: match[1].trim(),
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      severity: match[4] as 'error' | 'warning',
      code: match[5],
      message: match[6].trim()
    });
  }

  const errorCount = errors.filter(e => e.severity === 'error').length;
  const warningCount = errors.filter(e => e.severity === 'warning').length;

  // Build clean output (limit to first 10 for token efficiency)
  const cleanOutput = errors
    .slice(0, 10)
    .map(e => `${e.file}:${e.line}:${e.column} - ${e.code}: ${e.message}`)
    .join('\n');

  return {
    errors: errors.slice(0, 10),
    summary: `${errorCount} type error(s), ${warningCount} warning(s)`,
    totalCount: errors.length,
    guidance: getTypeScriptGuidance(errors),
    cleanOutput
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
