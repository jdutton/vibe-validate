/**
 * TypeScript Extractor Tests
 *
 * Tests TypeScript compiler error parsing and formatting.
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';
import { extractTypeScriptErrors } from '../src/typescript-extractor.js';

describe('extractTypeScriptErrors', () => {
  it('should parse single TypeScript error', () => {
    const output = `
src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
    `.trim();

    const result = extractTypeScriptErrors(output);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      file: 'src/index.ts',
      line: 10,
      column: 5,
      severity: 'error',
      code: 'TS2322',
      message: "Type 'string' is not assignable to type 'number'."
    });
    expect(result.summary).toBe('1 type error(s), 0 warning(s)');
    expect(result.totalCount).toBe(1);
  });

  it('should parse multiple TypeScript errors', () => {
    const output = `
src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/config.ts(25,12): error TS2304: Cannot find name 'process'.
src/utils.ts(100,3): warning TS6133: 'unusedVar' is declared but never used.
    `.trim();

    const result = extractTypeScriptErrors(output);

    expect(result.errors).toHaveLength(3);
    expect(result.summary).toBe('2 type error(s), 1 warning(s)');
    expect(result.totalCount).toBe(3);

    // Verify first error
    expect(result.errors[0].file).toBe('src/index.ts');
    expect(result.errors[0].severity).toBe('error');
    expect(result.errors[0].code).toBe('TS2322');

    // Verify warning
    expect(result.errors[2].severity).toBe('warning');
    expect(result.errors[2].code).toBe('TS6133');
  });

  it('should limit output to first 10 errors', () => {
    // Generate 15 errors
    const errors = Array.from({ length: 15 }, (_, i) =>
      `src/file${i}.ts(${i + 1},5): error TS2322: Type error ${i + 1}.`
    ).join('\n');

    const result = extractTypeScriptErrors(errors);

    expect(result.totalCount).toBe(15);
    expect(result.errors).toHaveLength(10);
    expect(result.summary).toBe('15 type error(s), 0 warning(s)');
  });

  it('should generate TS2322 guidance for type mismatch', () => {
    const output = `
src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
    `.trim();

    const result = extractTypeScriptErrors(output);

    expect(result.guidance).toContain('Type mismatch');
    expect(result.guidance).toContain('check variable/parameter types');
  });

  it('should generate TS2304 guidance for missing name', () => {
    const output = `
src/config.ts(25,12): error TS2304: Cannot find name 'process'.
    `.trim();

    const result = extractTypeScriptErrors(output);

    expect(result.guidance).toContain('Cannot find name');
    expect(result.guidance).toContain('check imports and type definitions');
  });

  it('should generate TS2345 guidance for argument type mismatch', () => {
    const output = `
src/utils.ts(50,10): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
    `.trim();

    const result = extractTypeScriptErrors(output);

    expect(result.guidance).toContain('Argument type mismatch');
    expect(result.guidance).toContain('check function signatures');
  });

  it('should generate generic guidance for unknown error codes', () => {
    const output = `
src/index.ts(10,5): error TS9999: Unknown error code.
    `.trim();

    const result = extractTypeScriptErrors(output);

    expect(result.guidance).toBe('Fix TypeScript type errors in listed files');
  });

  it('should combine multiple guidance messages', () => {
    const output = `
src/index.ts(10,5): error TS2322: Type mismatch.
src/config.ts(25,12): error TS2304: Cannot find name.
src/utils.ts(50,10): error TS2345: Argument type error.
    `.trim();

    const result = extractTypeScriptErrors(output);

    expect(result.guidance).toContain('Type mismatch');
    expect(result.guidance).toContain('Cannot find name');
    expect(result.guidance).toContain('Argument type mismatch');
  });

  it('should generate clean output with file:line:column format', () => {
    const output = `
src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/config.ts(25,12): error TS2304: Cannot find name 'process'.
    `.trim();

    const result = extractTypeScriptErrors(output);

    expect(result.errorSummary).toContain('src/index.ts:10:5 - TS2322:');
    expect(result.errorSummary).toContain('src/config.ts:25:12 - TS2304:');
  });

  it('should handle empty output', () => {
    const result = extractTypeScriptErrors('');

    expect(result.errors).toHaveLength(0);
    expect(result.summary).toBe('0 type error(s), 0 warning(s)');
    expect(result.totalCount).toBe(0);
    expect(result.guidance).toBe('Fix TypeScript type errors in listed files');
  });

  it('should handle output with no matches', () => {
    const output = `
Some random text
That does not match
The TypeScript error format
    `.trim();

    const result = extractTypeScriptErrors(output);

    expect(result.errors).toHaveLength(0);
    expect(result.summary).toBe('0 type error(s), 0 warning(s)');
  });

  it('should handle files with spaces in path', () => {
    const output = `
src/my folder/index.ts(10,5): error TS2322: Type error.
    `.trim();

    const result = extractTypeScriptErrors(output);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe('src/my folder/index.ts');
  });
});
