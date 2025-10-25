/**
 * Smart Error Extractor
 *
 * Auto-detects validation step type and applies appropriate extractor.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult } from './types.js';
import { extractTypeScriptErrors } from './typescript-extractor.js';
import { extractESLintErrors } from './eslint-extractor.js';
import { extractVitestErrors } from './vitest-extractor.js';
import { extractJUnitErrors } from './junit-extractor.js';
import { extractOpenAPIErrors } from './openapi-extractor.js';
import { extractGenericErrors } from './generic-extractor.js';

/**
 * Smart extractor - detects step type and applies appropriate formatting
 *
 * Auto-detection rules:
 * - TypeScript: Step name contains "TypeScript" or "typecheck"
 * - ESLint: Step name contains "ESLint" or "lint"
 * - JUnit XML: Output contains JUnit XML format (<?xml + <testsuite)
 * - Vitest/Jest: Step name contains "test" (but not "OpenAPI")
 * - OpenAPI: Step name contains "OpenAPI"
 * - Generic: Fallback for unknown step types
 *
 * @param stepName - Name of validation step (used for detection)
 * @param output - Raw command output
 * @returns Structured error information from appropriate extractor
 *
 * @example
 * ```typescript
 * const result = extractByStepName('TypeScript Type Checking', tscOutput);
 * // Uses extractTypeScriptErrors automatically
 *
 * const result2 = extractByStepName('ESLint', eslintOutput);
 * // Uses extractESLintErrors automatically
 *
 * const result3 = extractByStepName('Test', junitXmlOutput);
 * // Auto-detects JUnit XML and uses extractJUnitErrors
 * ```
 */
export function extractByStepName(stepName: string, output: string): ErrorExtractorResult {
  const lowerStepName = stepName.toLowerCase();

  if (lowerStepName.includes('typescript') || lowerStepName.includes('typecheck') || lowerStepName.includes('tsc')) {
    return extractTypeScriptErrors(output);
  }

  if (lowerStepName.includes('eslint') || lowerStepName.includes('lint')) {
    return extractESLintErrors(output);
  }

  // Auto-detect JUnit XML format (before test keyword check)
  if (output.includes('<?xml') && output.includes('<testsuite')) {
    return extractJUnitErrors(output);
  }

  if (lowerStepName.includes('test') && !lowerStepName.includes('openapi')) {
    return extractVitestErrors(output);
  }

  if (lowerStepName.includes('openapi')) {
    return extractOpenAPIErrors(output);
  }

  return extractGenericErrors(output, stepName);
}
