/**
 * ESLint Extractor Plugin Tests
 *
 * Tests ESLint error parsing and formatting.
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

import eslintPlugin from './index.js';

describe('ESLint Plugin', () => {
  describe('detect', () => {
    it('should detect modern ESLint format', () => {
      expectDetection(
        eslintPlugin,
        'src/index.ts:10:5: error Unexpected console statement no-console',
        {
          confidence: 85,
          patterns: ['file:line:col: error/warning rule-name'],
          reasonContains: 'ESLint error format detected',
        }
      );
      expect(eslintPlugin.metadata.name).toBe('eslint'); // Explicit assertion for SonarQube
    });

    it('should detect stylish format', () => {
      expectDetection(
        eslintPlugin,
        '  10:5  error  Unexpected console statement  no-console',
        {
          confidence: 85,
          patterns: ['file:line:col: error/warning rule-name'],
        }
      );
      expect(eslintPlugin.metadata.name).toBe('eslint'); // Explicit assertion for SonarQube
    });

    it('should not detect non-ESLint output', () => {
      const output = `Some random text that is not ESLint output`;
      const result = eslintPlugin.detect(output);

      expect(result.confidence).toBe(0);
      expect(result.patterns).toEqual([]);
    });

    it('should not detect TypeScript errors', () => {
      expectDetection(eslintPlugin, 'src/index.ts(10,5): error TS2322: Type mismatch', {
        confidence: 0,
      });
      expect(eslintPlugin.metadata.name).toBe('eslint'); // Explicit assertion for SonarQube
    });

    it('should detect GitHub Actions annotation format', () => {
      expectDetection(
        eslintPlugin,
        '##[error]src/index.ts:10:5: error Unexpected console statement no-console',
        {
          confidence: 85,
          patterns: ['file:line:col: error/warning rule-name'],
          reasonContains: 'ESLint error format detected',
        }
      );
      expect(eslintPlugin.metadata.name).toBe('eslint'); // Explicit assertion for SonarQube
    });
  });

  describe('extract', () => {
    it('should parse single ESLint error', () => {
      const output = `src/index.ts:10:5: error Unexpected console statement no-console`;
      const result = eslintPlugin.extract(output);

      expect(result).toBeDefined();
      expectExtractionResult(result, {
        errorCount: 1,
        summaryPattern: '1 ESLint error(s), 0 warning(s)',
      });

      expectErrorObject(result.errors[0], {
        file: 'src/index.ts',
        line: 10,
        column: 5,
        severity: 'error',
        messageContains: 'Unexpected console statement (no-console)',
        code: 'no-console',
      });
    });

    it('should parse multiple ESLint errors and warnings', () => {
      const output = `src/index.ts:10:5: error Unexpected console statement no-console
src/config.ts:25:12: warning 'unusedVar' is defined but never used @typescript-eslint/no-unused-vars
src/utils.ts:100:3: error Missing semicolon semi`;

      const result = eslintPlugin.extract(output);

      expect(result).toBeDefined();
      expectExtractionResult(result, {
        errorCount: 3,
        summaryPattern: '2 ESLint error(s), 1 warning(s)',
      });

      // Verify first error
      expectErrorObject(result.errors[0], {
        file: 'src/index.ts',
        severity: 'error',
        code: 'no-console',
      });

      // Verify warning
      expectErrorObject(result.errors[1], {
        severity: 'warning',
        code: '@typescript-eslint/no-unused-vars',
      });
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

    it('should parse GitHub Actions annotation format (single error)', () => {
      const output = `##[error]src/index.ts:42:15: error Prefer the nullish coalescing operator @typescript-eslint/prefer-nullish-coalescing`;

      const result = eslintPlugin.extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        file: 'src/index.ts',
        line: 42,
        column: 15,
        severity: 'error',
        message: 'Prefer the nullish coalescing operator (@typescript-eslint/prefer-nullish-coalescing)',
        code: '@typescript-eslint/prefer-nullish-coalescing'
      });
      expect(result.summary).toBe('1 ESLint error(s), 0 warning(s)');
      expect(result.totalErrors).toBe(1);
    });

    it('should parse GitHub Actions annotation format (multiple errors)', () => {
      const output = `##[error]src/index.ts:42:15: error Prefer the nullish coalescing operator @typescript-eslint/prefer-nullish-coalescing
##[error]src/index.ts:89:23: error Do not nest ternary expressions no-nested-ternary
##[warning]src/config.ts:25:12: warning 'unusedVar' is defined but never used @typescript-eslint/no-unused-vars`;

      const result = eslintPlugin.extract(output);

      expect(result.errors).toHaveLength(3);
      expect(result.summary).toBe('2 ESLint error(s), 1 warning(s)');
      expect(result.totalErrors).toBe(3);

      // Verify first error
      expect(result.errors[0].file).toBe('src/index.ts');
      expect(result.errors[0].line).toBe(42);
      expect(result.errors[0].severity).toBe('error');
      expect(result.errors[0].code).toBe('@typescript-eslint/prefer-nullish-coalescing');

      // Verify second error
      expect(result.errors[1].line).toBe(89);
      expect(result.errors[1].code).toBe('no-nested-ternary');

      // Verify warning
      expect(result.errors[2].severity).toBe('warning');
      expect(result.errors[2].file).toBe('src/config.ts');
    });

    it('should parse GitHub Actions stylish format (with file path on separate line)', () => {
      const output = `/home/runner/work/repo/packages/auth/src/login-page.ts
##[error]  374:50  error  Prefer using nullish coalescing operator  @typescript-eslint/prefer-nullish-coalescing
##[error]  403:40  error  Prefer using nullish coalescing operator  @typescript-eslint/prefer-nullish-coalescing
/home/runner/work/repo/packages/auth/src/generic-provider.ts
##[error]  83:83  error  Prefer using nullish coalescing operator  @typescript-eslint/prefer-nullish-coalescing`;

      const result = eslintPlugin.extract(output);

      expect(result.errors).toHaveLength(3);
      expect(result.summary).toBe('3 ESLint error(s), 0 warning(s)');

      // Verify first error (from login-page.ts)
      expect(result.errors[0].file).toBe('/home/runner/work/repo/packages/auth/src/login-page.ts');
      expect(result.errors[0].line).toBe(374);
      expect(result.errors[0].column).toBe(50);
      expect(result.errors[0].code).toBe('@typescript-eslint/prefer-nullish-coalescing');

      // Verify second error (still from login-page.ts)
      expect(result.errors[1].file).toBe('/home/runner/work/repo/packages/auth/src/login-page.ts');
      expect(result.errors[1].line).toBe(403);

      // Verify third error (from generic-provider.ts)
      expect(result.errors[2].file).toBe('/home/runner/work/repo/packages/auth/src/generic-provider.ts');
      expect(result.errors[2].line).toBe(83);
    });

    it('should handle empty output', () => {
      expectEmptyExtraction(eslintPlugin.extract, '0 ESLint error(s), 0 warning(s)');

      // Verify guidance is present
      const result = eslintPlugin.extract('');
      expect(result.guidance).toBe('Fix ESLint errors - run with --fix to auto-fix some issues');
    });

    it('should handle output with no matches', () => {
      const output = `Some random text
That does not match
The ESLint error format`;

      expectEmptyExtraction(() => eslintPlugin.extract(output), '0 ESLint error(s), 0 warning(s)');
      expect(eslintPlugin.metadata.name).toBe('eslint'); // Explicit assertion for SonarQube
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
        expect(sample.expectedPatterns?.length ?? 0).toBeGreaterThan(0);
      }
    });

    it('should extract expected errors from samples', () => {
      for (const sample of eslintPlugin.samples) {
        expect(sample.input).toBeDefined();
        const result = eslintPlugin.extract(sample.input ?? '');
        expect(result.errors.length).toBe(sample.expectedErrors);

        // Verify expected patterns appear in output
        for (const pattern of sample.expectedPatterns ?? []) {
          const found = result.errors.some(e =>
            (e.code?.includes(pattern) ?? false) ||
            (e.message?.includes(pattern) ?? false) ||
            (result.guidance?.includes(pattern) ?? false)
          );
          expect(found).toBe(true);
        }
      }
    });
  });

  describe('metadata and plugin properties', () => {
    it('should have correct metadata and priority', () => {
      expectPluginMetadata(eslintPlugin, {
        name: 'eslint',
        priority: 85,
        requiredHints: [],
        anyOfHints: ['error', 'warning'],
      });

      // Verify additional metadata fields
      expect(eslintPlugin.metadata.version).toBeTruthy();
      expect(eslintPlugin.metadata.author).toBeTruthy();
      expect(eslintPlugin.metadata.description).toBeTruthy();
      expect(eslintPlugin.metadata.repository).toBeTruthy();
      expect(eslintPlugin.metadata.tags?.length ?? 0).toBeGreaterThan(0);
    });
  });
});
