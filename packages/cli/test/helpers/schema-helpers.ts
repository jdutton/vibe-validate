/**
 * Test Schema Validation Helpers for CLI
 *
 * DRY test helpers that use strict validation (throws on invalid data).
 * This ensures all CLI tests validate their data against the canonical schemas.
 *
 * @packageDocumentation
 */

import { validateRunResult } from '../../src/schemas/run-result-schema.js';
import type { RunResult } from '../../src/schemas/run-result-schema.js';
import { validateResult as validateValidationResult } from '@vibe-validate/core';
import type { ValidationResult } from '@vibe-validate/core';
import { parse as parseYaml } from 'yaml';

/**
 * Validate a RunResult in tests (strict - throws on invalid data)
 *
 * Use this in ALL tests that work with run command output to ensure
 * test data conforms to the schema.
 *
 * @param data - Data to validate
 * @returns Validated result (or throws)
 * @throws {ZodError} If data doesn't match schema
 *
 * @example
 * ```typescript
 * const result = await executeAndExtract('npm test');
 * const validated = validateRunResultStrict(result.result);
 * expect(validated.exitCode).toBe(0);
 * ```
 */
export function validateRunResultStrict(data: unknown): RunResult {
  try {
    return validateRunResult(data);
  } catch (error) {
    console.error('❌ Run result validation failed!');
    console.error('Data:', JSON.stringify(data, null, 2));
    throw error;
  }
}

/**
 * Validate YAML-parsed RunResult (from stdout, git notes, etc.)
 *
 * @param yamlString - YAML string to parse and validate
 * @returns Validated result
 * @throws {Error} If YAML is invalid or doesn't match schema
 *
 * @example
 * ```typescript
 * const output = execSync('vibe-validate run "npm test"').toString();
 * const yamlPart = output.split('---\n').slice(1).join('---\n');
 * const result = validateRunResultYaml(yamlPart);
 * ```
 */
export function validateRunResultYaml(yamlString: string): RunResult {
  const parsed = parseYaml(yamlString);
  return validateRunResultStrict(parsed);
}

/**
 * Validate a ValidationResult in CLI tests (re-exported from core)
 *
 * Use this for validate command output.
 *
 * @param data - Data to validate
 * @returns Validated result (or throws)
 * @throws {ZodError} If data doesn't match schema
 *
 * @example
 * ```typescript
 * const result = await runValidateWorkflow(config, options);
 * const validated = validateValidationResultStrict(result);
 * expect(validated.passed).toBe(true);
 * ```
 */
export function validateValidationResultStrict(data: unknown): ValidationResult {
  try {
    return validateValidationResult(data);
  } catch (error) {
    console.error('❌ Validation result validation failed!');
    console.error('Data:', JSON.stringify(data, null, 2));
    throw error;
  }
}

/**
 * Validate YAML-parsed ValidationResult
 *
 * @param yamlString - YAML string to parse and validate
 * @returns Validated result
 * @throws {Error} If YAML is invalid or doesn't match schema
 */
export function validateValidationResultYaml(yamlString: string): ValidationResult {
  const parsed = parseYaml(yamlString);
  return validateValidationResultStrict(parsed);
}

/**
 * Assert that data is a valid RunResult
 *
 * Useful in expect() assertions for clear error messages.
 *
 * @example
 * ```typescript
 * expect(() => assertValidRunResult(result)).not.toThrow();
 * ```
 */
export function assertValidRunResult(data: unknown): asserts data is RunResult {
  validateRunResultStrict(data);
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
  validateValidationResultStrict(data);
}
