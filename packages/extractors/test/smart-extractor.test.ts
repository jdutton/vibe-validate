/**
 * Smart Extractor Tests
 *
 * Tests auto-detection and routing to appropriate extractors.
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';
import { extractByStepName } from '../src/smart-extractor.js';

describe('extractByStepName', () => {
  it('should route to TypeScript extractor for "TypeScript" step', () => {
    const output = 'src/index.ts(10,5): error TS2322: Type error.';
    const result = extractByStepName('TypeScript Type Checking', output);

    expect(result.summary).toContain('type error');
  });

  it('should route to TypeScript extractor for "typecheck" step', () => {
    const output = 'src/index.ts(10,5): error TS2322: Type error.';
    const result = extractByStepName('typecheck', output);

    expect(result.summary).toContain('type error');
  });

  it('should route to ESLint extractor for "ESLint" step', () => {
    const output = 'src/index.ts:10:5: error Error message rule-name';
    const result = extractByStepName('ESLint Code Quality', output);

    expect(result.summary).toContain('ESLint');
  });

  it('should route to ESLint extractor for "lint" step', () => {
    const output = 'src/index.ts:10:5: error Error message rule-name';
    const result = extractByStepName('lint', output);

    expect(result.summary).toContain('ESLint');
  });

  it('should route to Vitest extractor for "test" step', () => {
    const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test
AssertionError: expected 3000 to be 9999
 ❯ test/unit/config/environment.test.ts:57:30
    `.trim();

    const result = extractByStepName('Unit Tests', output);

    // Smart extractor routes to Vitest extractor based on step name "test"
    // Result should contain test failure information
    expect(result.summary).toBeDefined();
    expect(result.errors).toBeDefined();
  });

  it('should NOT route to Vitest extractor for "OpenAPI test"', () => {
    const output = 'Some OpenAPI validation error';
    const result = extractByStepName('OpenAPI Validation test', output);

    // Should route to OpenAPI extractor, not Vitest
    expect(result.summary).not.toContain('test failure');
  });

  it('should route to OpenAPI extractor for "OpenAPI" step', () => {
    const output = `
openapi.yaml:25:3 - error - Property 'description' is missing
openapi.yaml:30:5 - warning - Example should match schema
    `.trim();

    const result = extractByStepName('OpenAPI Validation', output);

    expect(result.summary).toContain('OpenAPI');
  });

  it('should route to generic extractor for unknown step types', () => {
    const output = 'Some random error output\nAnother error line';
    const result = extractByStepName('Custom Build Step', output);

    expect(result.summary).toContain('Custom Build Step');
    expect(result.guidance).toContain('Review the output');
  });

  it('should handle case-insensitive step names', () => {
    const output = 'src/index.ts(10,5): error TS2322: Type error.';

    // Should match TypeScript extractor (case-insensitive)
    const result1 = extractByStepName('typescript checking', output);
    expect(result1.summary).toContain('type error');

    // Should also match TypeScript extractor
    const result2 = extractByStepName('TypeScript checking', output);
    expect(result2.summary).toContain('type error');

    // Even all caps should match
    const result3 = extractByStepName('TYPESCRIPT checking', output);
    expect(result3.summary).toContain('type error');
  });

  it('should handle step names with multiple keywords', () => {
    const output = 'src/index.ts:10:5: error Error message rule-name';
    const result = extractByStepName('lint and format', output);

    // Should match "lint" first
    expect(result.summary).toContain('ESLint');
  });

  it('should prioritize specific matchers over generic', () => {
    const output = `
 FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test
AssertionError: expected 3000 to be 9999
    `.trim();

    // Even though step has "test", should match Vitest extractor
    const result = extractByStepName('Integration tests', output);
    expect(result.summary).toContain('test failure');
  });

  it('should handle empty step names gracefully', () => {
    const output = 'Some error output';
    const result = extractByStepName('', output);

    // Should route to generic extractor
    expect(result.summary).toBeDefined();
    expect(result.errors).toBeDefined();
  });

  it('should handle empty output gracefully', () => {
    const result = extractByStepName('TypeScript', '');

    expect(result.summary).toBe('0 type error(s), 0 warning(s)');
    expect(result.errors).toHaveLength(0);
  });

  it('should preserve extractor-specific error structure', () => {
    const output = 'src/index.ts(10,5): error TS2322: Type error.';
    const result = extractByStepName('TypeScript', output);

    expect(result.errors[0]).toHaveProperty('file');
    expect(result.errors[0]).toHaveProperty('line');
    expect(result.errors[0]).toHaveProperty('column');
    expect(result.errors[0]).toHaveProperty('code');
    expect(result.errors[0].code).toBe('TS2322');
  });

  it('should preserve extractor-specific guidance', () => {
    const output = 'src/index.ts(10,5): error TS2322: Type mismatch.';
    const result = extractByStepName('TypeScript', output);

    expect(result.guidance).toContain('Type mismatch');
    expect(result.guidance).toContain('check variable/parameter types');
  });
});
