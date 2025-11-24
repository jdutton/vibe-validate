/**
 * ESLint Extractor Plugin Tests
 *
 * Tests ESLint error parsing and formatting.
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';
import eslintPlugin from './index.js';

describe('ESLint Plugin', () => {
  describe('detect', () => {
    it('should detect modern ESLint format', () => {
      const output = `src/index.ts:10:5: error Unexpected console statement no-console`;
      const result = eslintPlugin.detect(output);

      expect(result.confidence).toBe(85);
      expect(result.patterns).toContain('file:line:col: error/warning rule-name');
      expect(result.reason).toBe('ESLint error format detected');
    });

    it('should detect stylish format', () => {
      const output = `  10:5  error  Unexpected console statement  no-console`;
      const result = eslintPlugin.detect(output);

      expect(result.confidence).toBe(85);
      expect(result.patterns).toContain('file:line:col: error/warning rule-name');
    });

    it('should not detect non-ESLint output', () => {
      const output = `Some random text that is not ESLint output`;
      const result = eslintPlugin.detect(output);

      expect(result.confidence).toBe(0);
      expect(result.patterns).toEqual([]);
    });

    it('should not detect TypeScript errors', () => {
      const output = `src/index.ts(10,5): error TS2322: Type mismatch`;
      const result = eslintPlugin.detect(output);

      expect(result.confidence).toBe(0);
    });
  });

  describe('extract', () => {
    it('should parse single ESLint error', () => {
      const output = `src/index.ts:10:5: error Unexpected console statement no-console`;

      const result = eslintPlugin.extract(output);

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
      expect(result.totalErrors).toBe(1);
    });

    it('should parse multiple ESLint errors and warnings', () => {
      const output = `src/index.ts:10:5: error Unexpected console statement no-console
src/config.ts:25:12: warning 'unusedVar' is defined but never used @typescript-eslint/no-unused-vars
src/utils.ts:100:3: error Missing semicolon semi`;

      const result = eslintPlugin.extract(output);

      expect(result.errors).toHaveLength(3);
      expect(result.summary).toBe('2 ESLint error(s), 1 warning(s)');
      expect(result.totalErrors).toBe(3);

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

      const result = eslintPlugin.extract(errors);

      expect(result.totalErrors).toBe(15);
      expect(result.errors).toHaveLength(10);
      expect(result.summary).toBe('15 ESLint error(s), 0 warning(s)');
    });

    it('should generate no-console guidance', () => {
      const output = `src/index.ts:10:5: error Unexpected console statement no-console`;

      const result = eslintPlugin.extract(output);

      expect(result.guidance).toContain('Replace console.log with logger');
    });

    it('should generate no-unused-vars guidance', () => {
      const output = `src/config.ts:25:12: warning 'unusedVar' is defined but never used @typescript-eslint/no-unused-vars`;

      const result = eslintPlugin.extract(output);

      expect(result.guidance).toContain('Remove or prefix unused variables with underscore');
    });

    it('should generate generic guidance for unknown rules', () => {
      const output = `src/index.ts:10:5: error Unknown error unknown-rule`;

      const result = eslintPlugin.extract(output);

      expect(result.guidance).toBe('Fix ESLint errors - run with --fix to auto-fix some issues');
    });

    it('should combine multiple guidance messages', () => {
      const output = `src/index.ts:10:5: error Unexpected console statement no-console
src/config.ts:25:12: warning 'unusedVar' is defined but never used @typescript-eslint/no-unused-vars`;

      const result = eslintPlugin.extract(output);

      expect(result.guidance).toContain('Replace console.log with logger');
      expect(result.guidance).toContain('Remove or prefix unused variables with underscore');
    });

    it('should generate clean output with file:line:column format', () => {
      const output = `src/index.ts:10:5: error Unexpected console statement no-console
src/config.ts:25:12: warning 'unusedVar' is defined but never used @typescript-eslint/no-unused-vars`;

      const result = eslintPlugin.extract(output);

      expect(result.errorSummary).toContain('src/index.ts:10:5 - Unexpected console statement (no-console) [no-console]');
      expect(result.errorSummary).toContain('src/config.ts:25:12 - \'unusedVar\' is defined but never used (@typescript-eslint/no-unused-vars) [@typescript-eslint/no-unused-vars]');
    });

    it('should handle empty output', () => {
      const result = eslintPlugin.extract('');

      expect(result.errors).toHaveLength(0);
      expect(result.summary).toBe('0 ESLint error(s), 0 warning(s)');
      expect(result.totalErrors).toBe(0);
      expect(result.guidance).toBe('Fix ESLint errors - run with --fix to auto-fix some issues');
    });

    it('should handle output with no matches', () => {
      const output = `Some random text
That does not match
The ESLint error format`;

      const result = eslintPlugin.extract(output);

      expect(result.errors).toHaveLength(0);
      expect(result.summary).toBe('0 ESLint error(s), 0 warning(s)');
    });

    it('should handle files with spaces in path', () => {
      const output = `src/my folder/index.ts:10:5: error Error message rule-name`;

      const result = eslintPlugin.extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('src/my folder/index.ts');
    });

    it('should handle TypeScript ESLint rules', () => {
      const output = `src/index.ts:10:5: error Missing return type @typescript-eslint/explicit-function-return-type
src/config.ts:25:12: error Promise must be handled @typescript-eslint/no-floating-promises`;

      const result = eslintPlugin.extract(output);

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].code).toBe('@typescript-eslint/explicit-function-return-type');
      expect(result.errors[1].code).toBe('@typescript-eslint/no-floating-promises');
    });

    it('should handle scoped package rule names', () => {
      const output = `src/index.ts:10:5: error Custom error @my-org/custom-rule`;

      const result = eslintPlugin.extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('@my-org/custom-rule');
    });
  });

  describe('samples', () => {
    it('should have valid sample test cases', () => {
      expect(eslintPlugin.samples).toBeDefined();
      expect(eslintPlugin.samples.length).toBeGreaterThan(0);

      for (const sample of eslintPlugin.samples) {
        expect(sample.name).toBeTruthy();
        expect(sample.description).toBeTruthy();
        expect(sample.input).toBeTruthy();
        expect(sample.expectedErrors).toBeGreaterThan(0);
        expect(sample.expectedPatterns!.length).toBeGreaterThan(0);
      }
    });

    it('should extract expected errors from samples', () => {
      for (const sample of eslintPlugin.samples) {
        const result = eslintPlugin.extract(sample.input!);
        expect(result.errors.length).toBe(sample.expectedErrors);

        // Verify expected patterns appear in output
        for (const pattern of sample.expectedPatterns!) {
          const found = result.errors.some(e =>
            e.code?.includes(pattern) ||
            e.message?.includes(pattern) ||
            result.guidance?.includes(pattern)
          );
          expect(found).toBe(true);
        }
      }
    });
  });

  describe('metadata', () => {
    it('should have complete metadata', () => {
      expect(eslintPlugin.metadata.name).toBe('eslint');
      expect(eslintPlugin.metadata.version).toBeTruthy();
      expect(eslintPlugin.metadata.author).toBeTruthy();
      expect(eslintPlugin.metadata.description).toBeTruthy();
      expect(eslintPlugin.metadata.repository).toBeTruthy();
      expect(eslintPlugin.metadata.tags!.length).toBeGreaterThan(0);
    });
  });

  describe('hints', () => {
    it('should have performance hints defined', () => {
      expect(eslintPlugin.hints).toBeDefined();
      expect(eslintPlugin.hints!.required).toBeDefined();
      expect(eslintPlugin.hints!.anyOf).toBeDefined();
    });
  });

  describe('priority', () => {
    it('should have priority set', () => {
      expect(eslintPlugin.priority).toBe(85);
    });
  });
});
