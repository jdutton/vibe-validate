/**
 * Test Schema Validation Helpers for Extractors
 *
 * DRY test helpers that use strict validation (throws on invalid data).
 * This ensures all extractor tests validate their output against the canonical schemas.
 *
 * @packageDocumentation
 */

import { parse as parseYaml } from 'yaml';

import { validateExtractorResult } from '../../src/result-schema.js';
import type { ErrorExtractorResult } from '../../src/result-schema.js';

/**
 * Validate an ErrorExtractorResult in tests (strict - throws on invalid data)
 *
 * Use this in ALL extractor tests to ensure output conforms to the schema.
 *
 * @param data - Data to validate
 * @returns Validated result (or throws)
 * @throws {ZodError} If data doesn't match schema
 *
 * @example
 * ```typescript
 * const result = extractTypeScriptErrors(tscOutput);
 * const validated = validateExtractorResult(result); // Throws if invalid
 * expect(validated.errors.length).toBeGreaterThan(0);
 * ```
 */
export function validateExtractorResultStrict(data: unknown): ErrorExtractorResult {
  try {
    return validateExtractorResult(data);
  } catch (error) {
    console.error('❌ Extractor output validation failed!');
    console.error('Data:', JSON.stringify(data, null, 2));
    throw error;
  }
}

/**
 * Validate YAML-parsed ErrorExtractorResult
 *
 * @param yamlString - YAML string to parse and validate
 * @returns Validated result
 * @throws {Error} If YAML is invalid or doesn't match schema
 *
 * @example
 * ```typescript
 * const yamlOutput = execSync('vibe-validate run "npm test"').toString();
 * const parts = yamlOutput.split('---\n');
 * const result = validateExtractorResultYaml(parts[1]);
 * ```
 */
export function validateExtractorResultYaml(yamlString: string): ErrorExtractorResult {
  const parsed = parseYaml(yamlString);
  if (parsed && typeof parsed === 'object' && 'extraction' in parsed) {
    // Handle nested structure from run command
    return validateExtractorResultStrict(parsed.extraction);
  }
  return validateExtractorResultStrict(parsed);
}

/**
 * Assert that data is a valid ErrorExtractorResult
 *
 * Useful in expect() assertions for clear error messages.
 *
 * @example
 * ```typescript
 * expect(() => assertValidExtractorResult(result)).not.toThrow();
 * ```
 */
export function assertValidExtractorResult(data: unknown): asserts data is ErrorExtractorResult {
  validateExtractorResultStrict(data);
}
