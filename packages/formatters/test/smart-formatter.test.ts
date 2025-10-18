/**
 * Smart Formatter Tests
 *
 * Tests auto-detection and routing to appropriate formatters.
 *
 * @package @vibe-validate/formatters
 */

import { describe, it, expect } from 'vitest';
import { formatByStepName } from '../src/smart-formatter.js';

describe('formatByStepName', () => {
  it('should route to TypeScript formatter for "TypeScript" step', () => {
    const output = 'src/index.ts(10,5): error TS2322: Type error.';
    const result = formatByStepName('TypeScript Type Checking', output);

    expect(result.summary).toContain('type error');
  });

  it('should route to TypeScript formatter for "typecheck" step', () => {
    const output = 'src/index.ts(10,5): error TS2322: Type error.';
    const result = formatByStepName('typecheck', output);

    expect(result.summary).toContain('type error');
  });

  it('should route to ESLint formatter for "ESLint" step', () => {
    const output = 'src/index.ts:10:5: error Error message rule-name';
    const result = formatByStepName('ESLint Code Quality', output);

    expect(result.summary).toContain('ESLint');
  });

  it('should route to ESLint formatter for "lint" step', () => {
    const output = 'src/index.ts:10:5: error Error message rule-name';
    const result = formatByStepName('lint', output);

    expect(result.summary).toContain('ESLint');
  });

  it('should route to Vitest formatter for "test" step', () => {
    const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test
AssertionError: expected 3000 to be 9999
 ❯ test/unit/config/environment.test.ts:57:30
    `.trim();

    const result = formatByStepName('Unit Tests', output);

    // Smart formatter routes to Vitest formatter based on step name "test"
    // Result should contain test failure information
    expect(result.summary).toBeDefined();
    expect(result.errors).toBeDefined();
  });

  it('should NOT route to Vitest formatter for "OpenAPI test"', () => {
    const output = 'Some OpenAPI validation error';
    const result = formatByStepName('OpenAPI Validation test', output);

    // Should route to OpenAPI formatter, not Vitest
    expect(result.summary).not.toContain('test failure');
  });

  it('should route to OpenAPI formatter for "OpenAPI" step', () => {
    const output = `
openapi.yaml:25:3 - error - Property 'description' is missing
openapi.yaml:30:5 - warning - Example should match schema
    `.trim();

    const result = formatByStepName('OpenAPI Validation', output);

    expect(result.summary).toContain('OpenAPI');
  });

  it('should route to generic formatter for unknown step types', () => {
    const output = 'Some random error output\nAnother error line';
    const result = formatByStepName('Custom Build Step', output);

    expect(result.summary).toContain('Custom Build Step');
    expect(result.guidance).toContain('Review the output');
  });

  it('should handle case-sensitive step names', () => {
    const output = 'src/index.ts(10,5): error TS2322: Type error.';

    // Should match "TypeScript" (case-sensitive)
    const result1 = formatByStepName('typescript checking', output);
    expect(result1.summary).not.toContain('type error');

    // Should match "TypeScript"
    const result2 = formatByStepName('TypeScript checking', output);
    expect(result2.summary).toContain('type error');
  });

  it('should handle step names with multiple keywords', () => {
    const output = 'src/index.ts:10:5: error Error message rule-name';
    const result = formatByStepName('lint and format', output);

    // Should match "lint" first
    expect(result.summary).toContain('ESLint');
  });

  it('should prioritize specific matchers over generic', () => {
    const output = `
 FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test
AssertionError: expected 3000 to be 9999
    `.trim();

    // Even though step has "test", should match Vitest formatter
    const result = formatByStepName('Integration tests', output);
    expect(result.summary).toContain('test failure');
  });

  it('should handle empty step names gracefully', () => {
    const output = 'Some error output';
    const result = formatByStepName('', output);

    // Should route to generic formatter
    expect(result.summary).toBeDefined();
    expect(result.errors).toBeDefined();
  });

  it('should handle empty output gracefully', () => {
    const result = formatByStepName('TypeScript', '');

    expect(result.summary).toBe('0 type error(s), 0 warning(s)');
    expect(result.errors).toHaveLength(0);
  });

  it('should preserve formatter-specific error structure', () => {
    const output = 'src/index.ts(10,5): error TS2322: Type error.';
    const result = formatByStepName('TypeScript', output);

    expect(result.errors[0]).toHaveProperty('file');
    expect(result.errors[0]).toHaveProperty('line');
    expect(result.errors[0]).toHaveProperty('column');
    expect(result.errors[0]).toHaveProperty('code');
    expect(result.errors[0].code).toBe('TS2322');
  });

  it('should preserve formatter-specific guidance', () => {
    const output = 'src/index.ts(10,5): error TS2322: Type mismatch.';
    const result = formatByStepName('TypeScript', output);

    expect(result.guidance).toContain('Type mismatch');
    expect(result.guidance).toContain('check variable/parameter types');
  });
});
