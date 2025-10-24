/**
 * ESLint Extractor Tests
 *
 * Tests ESLint error parsing and formatting.
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';
import { extractESLintErrors } from '../src/eslint-extractor.js';

describe('extractESLintErrors', () => {
  it('should parse single ESLint error', () => {
    const output = `
src/index.ts:10:5: error Unexpected console statement no-console
    `.trim();

    const result = extractESLintErrors(output);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      file: 'src/index.ts',
      line: 10,
      column: 5,
      severity: 'error',
      message: 'Unexpected console statement (no-console)',
      code: 'no-console'
    });
    expect(result.summary).toBe('1 ESLint error(s), 0 warning(s)');
    expect(result.totalCount).toBe(1);
  });

  it('should parse multiple ESLint errors and warnings', () => {
    const output = `
src/index.ts:10:5: error Unexpected console statement no-console
src/config.ts:25:12: warning 'unusedVar' is defined but never used @typescript-eslint/no-unused-vars
src/utils.ts:100:3: error Missing semicolon semi
    `.trim();

    const result = extractESLintErrors(output);

    expect(result.errors).toHaveLength(3);
    expect(result.summary).toBe('2 ESLint error(s), 1 warning(s)');
    expect(result.totalCount).toBe(3);

    // Verify first error
    expect(result.errors[0].file).toBe('src/index.ts');
    expect(result.errors[0].severity).toBe('error');
    expect(result.errors[0].code).toBe('no-console');

    // Verify warning
    expect(result.errors[1].severity).toBe('warning');
    expect(result.errors[1].code).toBe('@typescript-eslint/no-unused-vars');
  });

  it('should limit output to first 10 errors', () => {
    // Generate 15 errors
    const errors = Array.from({ length: 15 }, (_, i) =>
      `src/file${i}.ts:${i + 1}:5: error Error message ${i + 1} rule-${i}`
    ).join('\n');

    const result = extractESLintErrors(errors);

    expect(result.totalCount).toBe(15);
    expect(result.errors).toHaveLength(10);
    expect(result.summary).toBe('15 ESLint error(s), 0 warning(s)');
  });

  it('should generate no-console guidance', () => {
    const output = `
src/index.ts:10:5: error Unexpected console statement no-console
    `.trim();

    const result = extractESLintErrors(output);

    expect(result.guidance).toContain('Replace console.log with logger');
  });

  it('should generate no-unused-vars guidance', () => {
    const output = `
src/config.ts:25:12: warning 'unusedVar' is defined but never used @typescript-eslint/no-unused-vars
    `.trim();

    const result = extractESLintErrors(output);

    expect(result.guidance).toContain('Remove or prefix unused variables with underscore');
  });

  it('should generate generic guidance for unknown rules', () => {
    const output = `
src/index.ts:10:5: error Unknown error unknown-rule
    `.trim();

    const result = extractESLintErrors(output);

    expect(result.guidance).toBe('Fix ESLint errors - run with --fix to auto-fix some issues');
  });

  it('should combine multiple guidance messages', () => {
    const output = `
src/index.ts:10:5: error Unexpected console statement no-console
src/config.ts:25:12: warning 'unusedVar' is defined but never used @typescript-eslint/no-unused-vars
    `.trim();

    const result = extractESLintErrors(output);

    expect(result.guidance).toContain('Replace console.log with logger');
    expect(result.guidance).toContain('Remove or prefix unused variables with underscore');
  });

  it('should generate clean output with file:line:column format', () => {
    const output = `
src/index.ts:10:5: error Unexpected console statement no-console
src/config.ts:25:12: warning 'unusedVar' is defined but never used @typescript-eslint/no-unused-vars
    `.trim();

    const result = extractESLintErrors(output);

    expect(result.cleanOutput).toContain('src/index.ts:10:5 - Unexpected console statement (no-console) [no-console]');
    expect(result.cleanOutput).toContain('src/config.ts:25:12 - \'unusedVar\' is defined but never used (@typescript-eslint/no-unused-vars) [@typescript-eslint/no-unused-vars]');
  });

  it('should handle empty output', () => {
    const result = extractESLintErrors('');

    expect(result.errors).toHaveLength(0);
    expect(result.summary).toBe('0 ESLint error(s), 0 warning(s)');
    expect(result.totalCount).toBe(0);
    expect(result.guidance).toBe('Fix ESLint errors - run with --fix to auto-fix some issues');
  });

  it('should handle output with no matches', () => {
    const output = `
Some random text
That does not match
The ESLint error format
    `.trim();

    const result = extractESLintErrors(output);

    expect(result.errors).toHaveLength(0);
    expect(result.summary).toBe('0 ESLint error(s), 0 warning(s)');
  });

  it('should handle files with spaces in path', () => {
    const output = `
src/my folder/index.ts:10:5: error Error message rule-name
    `.trim();

    const result = extractESLintErrors(output);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe('src/my folder/index.ts');
  });

  it('should handle TypeScript ESLint rules', () => {
    const output = `
src/index.ts:10:5: error Missing return type @typescript-eslint/explicit-function-return-type
src/config.ts:25:12: error Promise must be handled @typescript-eslint/no-floating-promises
    `.trim();

    const result = extractESLintErrors(output);

    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].code).toBe('@typescript-eslint/explicit-function-return-type');
    expect(result.errors[1].code).toBe('@typescript-eslint/no-floating-promises');
  });

  it('should handle scoped package rule names', () => {
    const output = `
src/index.ts:10:5: error Custom error @my-org/custom-rule
    `.trim();

    const result = extractESLintErrors(output);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('@my-org/custom-rule');
  });
});
