/**
 * Smart Error Formatter
 *
 * Auto-detects validation step type and applies appropriate formatter.
 *
 * @package @vibe-validate/formatters
 */

import type { ErrorFormatterResult } from './types.js';
import { formatTypeScriptErrors } from './typescript-formatter.js';
import { formatESLintErrors } from './eslint-formatter.js';
import { formatVitestErrors } from './vitest-formatter.js';
import { formatOpenAPIErrors } from './openapi-formatter.js';
import { formatGenericErrors } from './generic-formatter.js';

/**
 * Smart formatter - detects step type and applies appropriate formatting
 *
 * Auto-detection rules:
 * - TypeScript: Step name contains "TypeScript" or "typecheck"
 * - ESLint: Step name contains "ESLint" or "lint"
 * - Vitest/Jest: Step name contains "test" (but not "OpenAPI")
 * - OpenAPI: Step name contains "OpenAPI"
 * - Generic: Fallback for unknown step types
 *
 * @param stepName - Name of validation step (used for detection)
 * @param output - Raw command output
 * @returns Structured error information from appropriate formatter
 *
 * @example
 * ```typescript
 * const result = formatByStepName('TypeScript Type Checking', tscOutput);
 * // Uses formatTypeScriptErrors automatically
 *
 * const result2 = formatByStepName('ESLint', eslintOutput);
 * // Uses formatESLintErrors automatically
 * ```
 */
export function formatByStepName(stepName: string, output: string): ErrorFormatterResult {
  const lowerStepName = stepName.toLowerCase();

  if (lowerStepName.includes('typescript') || lowerStepName.includes('typecheck') || lowerStepName.includes('tsc')) {
    return formatTypeScriptErrors(output);
  }

  if (lowerStepName.includes('eslint') || lowerStepName.includes('lint')) {
    return formatESLintErrors(output);
  }

  if (lowerStepName.includes('test') && !lowerStepName.includes('openapi')) {
    return formatVitestErrors(output);
  }

  if (lowerStepName.includes('openapi')) {
    return formatOpenAPIErrors(output);
  }

  return formatGenericErrors(output, stepName);
}
