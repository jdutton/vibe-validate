/**
 * TypeScript Extractor Plugin Tests
 *
 * Tests TypeScript compiler error parsing and formatting.
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';

import {
  expectDetection,
  expectEmptyExtraction,
  expectErrorObject,
  expectExtractionResult,
  expectPluginMetadata,
} from '../../test/helpers/extractor-test-helpers.js';

import typescriptPlugin from './index.js';

const { extract } = typescriptPlugin;

describe('TypeScript Extractor Plugin', () => {
  describe('detect', () => {
    it('should detect TypeScript errors with high confidence', () => {
      expectDetection(
        typescriptPlugin,
        `src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.`,
        {
          confidence: 95,
          patterns: ['error TS#### pattern'],
          reasonContains: 'TypeScript compiler',
        }
      );
      expect(typescriptPlugin).toBeDefined();
    });

    it('should not detect non-TypeScript output', () => {
      expectDetection(typescriptPlugin, 'Some random text without TypeScript errors', {
        confidence: 0,
      });
    expect(typescriptPlugin).toBeDefined();
    });
  });

  describe('extract', () => {
    it('should parse single TypeScript error', () => {
      const output = `
src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
    `.trim();

      const result = extract(output);

      expect(result).toBeDefined();
      expectExtractionResult(result, {
        errorCount: 1,
        summaryPattern: '1 type error(s), 0 warning(s)',
      });

      expectErrorObject(result.errors[0], {
        file: 'src/index.ts',
        line: 10,
        column: 5,
        severity: 'error',
        code: 'TS2322',
        messageContains: "Type 'string' is not assignable to type 'number'.",
      });
    });

    it('should parse multiple TypeScript errors', () => {
      const output = `
src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/config.ts(25,12): error TS2304: Cannot find name 'process'.
src/utils.ts(100,3): warning TS6133: 'unusedVar' is declared but never used.
    `.trim();

      const result = extract(output);

      expect(result).toBeDefined();
      expectExtractionResult(result, {
        errorCount: 3,
        summaryPattern: '2 type error(s), 1 warning(s)',
      });

      // Verify first error
      expectErrorObject(result.errors[0], {
        file: 'src/index.ts',
        severity: 'error',
        code: 'TS2322',
      });

      // Verify warning
      expectErrorObject(result.errors[2], {
        severity: 'warning',
        code: 'TS6133',
      });
    });

    it('should limit output to first 10 errors', () => {
      // Generate 15 errors
      const errors = Array.from(
        { length: 15 },
        (_, i) => `src/file${i}.ts(${i + 1},5): error TS2322: Type error ${i + 1}.`
      ).join('\n');

      const result = extract(errors);

      expect(result.totalErrors).toBe(15);
      expect(result.errors).toHaveLength(10);
      expect(result.summary).toBe('15 type error(s), 0 warning(s)');
    });

    it('should generate TS2322 guidance for type mismatch', () => {
      const output = `
src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
    `.trim();

      const result = extract(output);

      expect(result.guidance).toContain('Type mismatch');
      expect(result.guidance).toContain('check variable/parameter types');
    });

    it('should generate TS2304 guidance for missing name', () => {
      const output = `
src/config.ts(25,12): error TS2304: Cannot find name 'process'.
    `.trim();

      const result = extract(output);

      expect(result.guidance).toContain('Cannot find name');
      expect(result.guidance).toContain('check imports and type definitions');
    });

    it('should generate TS2345 guidance for argument type mismatch', () => {
      const output = `
src/utils.ts(50,10): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
    `.trim();

      const result = extract(output);

      expect(result.guidance).toContain('Argument type mismatch');
      expect(result.guidance).toContain('check function signatures');
    });

    it('should generate generic guidance for unknown error codes', () => {
      const output = `
src/index.ts(10,5): error TS9999: Unknown error code.
    `.trim();

      const result = extract(output);

      expect(result.guidance).toBe('Fix TypeScript type errors in listed files');
    });

    it('should combine multiple guidance messages', () => {
      const output = `
src/index.ts(10,5): error TS2322: Type mismatch.
src/config.ts(25,12): error TS2304: Cannot find name.
src/utils.ts(50,10): error TS2345: Argument type error.
    `.trim();

      const result = extract(output);

      expect(result.guidance).toContain('Type mismatch');
      expect(result.guidance).toContain('Cannot find name');
      expect(result.guidance).toContain('Argument type mismatch');
    });

    it('should generate clean output with file:line:column format', () => {
      const output = `
src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/config.ts(25,12): error TS2304: Cannot find name 'process'.
    `.trim();

      const result = extract(output);

      expect(result.errorSummary).toContain('src/index.ts:10:5 - TS2322:');
      expect(result.errorSummary).toContain('src/config.ts:25:12 - TS2304:');
    });

    it('should handle empty output', () => {
      expectEmptyExtraction(extract, '0 type error(s), 0 warning(s)');

      // Verify guidance is present
      const result = extract('');
      expect(result.guidance).toBe('Fix TypeScript type errors in listed files');
    });

    it('should handle output with no matches', () => {
      const output = `
Some random text
That does not match
The TypeScript error format
    `.trim();

      expectEmptyExtraction(() => extract(output), '0 type error(s), 0 warning(s)');
      expect(typescriptPlugin).toBeDefined();
    });

    it('should handle files with spaces in path', () => {
      const output = `
src/my folder/index.ts(10,5): error TS2322: Type error.
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('src/my folder/index.ts');
    });

    it('should truncate errors array to MAX_ERRORS_IN_ARRAY but preserve totalErrors count', async () => {
      const { expectMaxErrorsTruncation } = await import('../../test/helpers/max-errors-helper.js');

      // Generate 15 TypeScript errors (more than MAX_ERRORS_IN_ARRAY = 10)
      const errors = Array.from(
        { length: 15 },
        (_, i) => `src/file${i + 1}.ts(${i + 1},5): error TS2322: Type error ${i + 1}.`
      );
      const output = errors.join('\n');

      const result = extract(output);

      // Verify truncation behavior (assertions in helper)
      expect(result.errors.length).toBeGreaterThan(0);
      await expectMaxErrorsTruncation(result, {
        totalCount: 15,
        firstError: 'src/file1.ts',
        lastTruncatedError: 'src/file10.ts',
        summaryPattern: '15 type error(s), 0 warning(s)'
      });
    });
  });

  describe('plugin metadata', () => {
    it('should have correct metadata', () => {
      expectPluginMetadata(typescriptPlugin, {
        name: 'typescript',
        priority: 95,
        requiredHints: ['error TS'],
      });
    expect(typescriptPlugin).toBeDefined();
    });

    it('should include sample test cases', () => {
      expect(typescriptPlugin.samples).toBeDefined();
      expect(typescriptPlugin.samples.length).toBeGreaterThan(0);
    });
  });
});
