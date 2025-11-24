/**
 * TypeScript Error Extractor Plugin
 *
 * Parses and formats TypeScript compiler (tsc) error output for LLM consumption.
 *
 * @package @vibe-validate/extractors
 */

import type {
  ExtractorPlugin,
  ErrorExtractorResult,
  FormattedError,
  DetectionResult,
  ExtractorSample,
} from '../../types.js';
import { MAX_ERRORS_IN_ARRAY } from '../../result-schema.js';

/**
 * Generate TypeScript-specific guidance based on error codes
 *
 * @param errors - Parsed TypeScript errors
 * @returns Actionable guidance string
 */
function getTypeScriptGuidance(errors: FormattedError[]): string {
  const errorCodes = new Set(errors.map((e) => e.code));
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

/**
 * Extract TypeScript compiler errors from output
 *
 * @param output - Raw tsc command output
 * @returns Structured error information with TypeScript-specific guidance
 */
function extract(output: string): ErrorExtractorResult {
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
      message: match[6].trim(),
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
        message: match[6].trim(),
      });
    }
  }

  const errorCount = errors.filter((e) => e.severity === 'error').length;
  const warningCount = errors.filter((e) => e.severity === 'warning').length;

  // Build error summary (limit to MAX_ERRORS_IN_ARRAY for token efficiency)
  const errorSummary = errors
    .slice(0, MAX_ERRORS_IN_ARRAY)
    .map((e) => `${e.file}:${e.line}:${e.column} - ${e.code}: ${e.message}`)
    .join('\n');

  return {
    errors: errors.slice(0, MAX_ERRORS_IN_ARRAY),
    summary: `${errorCount} type error(s), ${warningCount} warning(s)`,
    totalErrors: errors.length,
    guidance: getTypeScriptGuidance(errors),
    errorSummary,
  };
}

/**
 * Detect if output is from TypeScript compiler
 *
 * @param output - Command output to analyze
 * @returns Detection result with confidence and patterns
 */
function detect(output: string): DetectionResult {
  const match = /error TS\d+:/.exec(output);
  if (match) {
    return {
      confidence: 95,
      patterns: ['error TS#### pattern'],
      reason: 'TypeScript compiler error format detected',
    };
  }
  return { confidence: 0, patterns: [], reason: '' };
}

/**
 * Sample test cases for TypeScript extractor
 */
const samples: ExtractorSample[] = [
  {
    name: 'single-type-error',
    description: 'Single TypeScript type mismatch error',
    input: `src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.`,
    expectedErrors: 1,
    expectedPatterns: ['TS2322', 'Type mismatch'],
  },
  {
    name: 'multiple-errors-with-warning',
    description: 'Multiple TypeScript errors with one warning',
    input: `src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/config.ts(25,12): error TS2304: Cannot find name 'process'.
src/utils.ts(100,3): warning TS6133: 'unusedVar' is declared but never used.`,
    expectedErrors: 3,
    expectedPatterns: ['TS2322', 'TS2304', 'TS6133'],
  },
];

/**
 * TypeScript Error Extractor Plugin
 *
 * Extracts TypeScript compiler errors with high confidence (95%).
 * Supports both old (file(line,col)) and new (file:line:col) formats.
 */
const typescriptPlugin: ExtractorPlugin = {
  metadata: {
    name: 'typescript',
    version: '1.0.0',
    author: 'vibe-validate',
    description: 'Extracts TypeScript compiler (tsc) errors',
    repository: 'https://github.com/jdutton/vibe-validate',
    tags: ['typescript', 'compiler', 'type-checking'],
  },
  hints: {
    required: ['error TS'],
    anyOf: [],
  },
  priority: 95,
  detect,
  extract,
  samples,
};

export default typescriptPlugin;
