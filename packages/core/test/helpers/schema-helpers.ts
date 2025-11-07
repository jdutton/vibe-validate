/**
 * Test Schema Validation Helpers
 *
 * DRY test helpers that use strict validation (throws on invalid data).
 * This ensures all tests validate their data against the canonical schemas.
 *
 * @packageDocumentation
 */

import { validateResult } from '../../src/result-schema.js';
import type { ValidationResult } from '../../src/result-schema.js';
import { parse as parseYaml } from 'yaml';

/**
 * Validate a ValidationResult in tests (strict - throws on invalid data)
 *
 * Use this in ALL tests that work with validation results to ensure
 * test data conforms to the schema.
 *
 * @param data - Data to validate
 * @returns Validated result (or throws)
 * @throws {ZodError} If data doesn't match schema
 *
 * @example
 * ```typescript
 * const result = await runValidation(config);
 * const validated = validateValidationResult(result); // Throws if invalid
 * expect(validated.passed).toBe(true);
 * ```
 */
export function validateValidationResult(data: unknown): ValidationResult {
  try {
    return validateResult(data);
  } catch (error) {
    console.error('❌ Test data validation failed!');
    console.error('Data:', JSON.stringify(data, null, 2));
    throw error;
  }
}

/**
 * Validate YAML-parsed ValidationResult (from git notes, state command, etc.)
 *
 * @param yamlString - YAML string to parse and validate
 * @returns Validated result
 * @throws {Error} If YAML is invalid or doesn't match schema
 *
 * @example
 * ```typescript
 * const state = execSync('vibe-validate state').toString();
 * const result = validateValidationResultYaml(state);
 * ```
 */
export function validateValidationResultYaml(yamlString: string): ValidationResult {
  const parsed = parseYaml(yamlString);
  return validateValidationResult(parsed);
}

/**
 * Assert that data is a valid ValidationResult
 *
 * Useful in expect() assertions for clear error messages.
 *
 * @example
 * ```typescript
 * expect(() => assertValidValidationResult(result)).not.toThrow();
 * ```
 */
export function assertValidValidationResult(data: unknown): asserts data is ValidationResult {
  validateValidationResult(data);
}
