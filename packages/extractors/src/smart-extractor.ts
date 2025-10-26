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
import { extractJestErrors } from './jest-extractor.js';
import { extractJUnitErrors } from './junit-extractor.js';
import { extractMochaErrors } from './mocha-extractor.js';
import { extractJasmineErrors } from './jasmine-extractor.js';
import { extractTAPErrors } from './tap-extractor.js';
import { extractAvaErrors } from './ava-extractor.js';
import { extractPlaywrightErrors } from './playwright-extractor.js';
import { extractOpenAPIErrors } from './openapi-extractor.js';
import { extractGenericErrors } from './generic-extractor.js';

/**
 * Smart extractor - detects step type and applies appropriate formatting
 *
 * Auto-detection rules:
 * - TypeScript: Step name contains "TypeScript" or "typecheck"
 * - ESLint: Step name contains "ESLint" or "lint"
 * - JUnit XML: Output contains JUnit XML format (<?xml + <testsuite)
 * - TAP: Output contains "TAP version 13" or "not ok N" pattern
 * - Jasmine: Output contains "Failures:" header
 * - Mocha: Output contains "X passing" or "X failing" format
 * - Ava: Output contains ✘ [fail]: pattern with › hierarchy
 * - Playwright: Output contains ✘ symbol and .spec.ts files
 * - Jest: Output contains "FAIL" keyword and "●" bullet pattern
 * - Vitest: Step name contains "test" (but not "OpenAPI") - fallback for test frameworks
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
 *
 * const result4 = extractByStepName('Test', mochaOutput);
 * // Auto-detects Mocha format and uses extractMochaErrors
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

  // Auto-detect TAP format (distinctive "TAP version 13" header or "not ok N" pattern)
  if (output.includes('TAP version') || output.match(/^not ok \d+/m)) {
    return extractTAPErrors(output);
  }

  // Auto-detect Jasmine format (distinctive "Failures:" header)
  if (output.includes('Failures:') && output.match(/^\d+\)\s+/m)) {
    return extractJasmineErrors(output);
  }

  // Auto-detect Mocha format (distinctive "X passing"/"X failing" pattern)
  if ((output.includes(' passing') || output.includes(' failing')) &&
      output.match(/\s+\d+\)\s+/)) {
    return extractMochaErrors(output);
  }

  // Auto-detect Ava format (✘ [fail]: pattern with › hierarchy)
  if (output.includes('✘') && output.includes('[fail]:') && output.includes('›')) {
    return extractAvaErrors(output);
  }

  // Auto-detect Playwright format (✘ symbol with .spec.ts files)
  if (output.includes('✘') && output.includes('.spec.ts')) {
    return extractPlaywrightErrors(output);
  }

  // Auto-detect Jest format (FAIL keyword and ● bullet pattern)
  if (output.includes('FAIL') && output.includes('●')) {
    return extractJestErrors(output);
  }

  if (lowerStepName.includes('test') && !lowerStepName.includes('openapi')) {
    return extractVitestErrors(output);
  }

  if (lowerStepName.includes('openapi')) {
    return extractOpenAPIErrors(output);
  }

  return extractGenericErrors(output, stepName);
}
