/**
 * Jest Extractor Plugin Tests
 *
 * Tests Jest test framework error parsing and formatting.
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';

import jestPlugin from './index.js';

const { extract, detect } = jestPlugin;

describe('Jest Extractor Plugin', () => {
  describe('detect', () => {
    it('should detect Jest output with FAIL marker', () => {
      const output = ` FAIL test/example.test.ts
  Example Suite
    ✕ should pass`;
      const result = detect(output);

      expect(result.confidence).toBe(90);
      expect(result.patterns).toContain('FAIL marker');
      expect(result.reason).toContain('Jest test framework');
    });

    it('should detect Jest output with detailed marker and test markers', () => {
      const output = `  ● Example Suite › should handle errors
    ✕ test failed`;
      const result = detect(output);

      expect(result.confidence).toBe(90);
      expect(result.patterns).toContain('● detailed format');
      expect(result.patterns).toContain('test markers (✕/✓)');
    });

    it('should detect Jest output with test markers only (lower confidence)', () => {
      const output = `    ✕ some test
    ✓ passing test`;
      const result = detect(output);

      expect(result.confidence).toBe(50);
      expect(result.patterns).toContain('test markers (✕/✓)');
    });

    it('should not detect non-Jest output', () => {
      const output = `Some random text without Jest markers`;
      const result = detect(output);

      expect(result.confidence).toBe(0);
    });
  });

  describe('extract', () => {
    it('should parse single inline test failure', () => {
      const output = `
 FAIL test/example.test.ts
  Example Suite
    ✕ should pass (15 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        file: 'test/example.test.ts',
        message: 'Example Suite › should pass: Test failed',
        severity: 'error',
      });
      expect(result.summary).toBe('1 test failure(s)');
      expect(result.totalErrors).toBe(1);
      expect(result.guidance).toContain('Fix each failing test individually');
    });

    it('should parse multiple test failures with hierarchy', () => {
      const output = `
 FAIL test/example.test.ts
  Example Suite
    Nested Suite
      ✕ test one (10 ms)
      ✕ test two (12 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].message).toContain('Example Suite › Nested Suite › test one');
      expect(result.errors[1].message).toContain('Example Suite › Nested Suite › test two');
      expect(result.summary).toBe('2 test failure(s)');
      expect(result.totalErrors).toBe(2);
    });

    it('should parse detailed test format with ● marker', () => {
      const output = `
 FAIL test/example.test.ts
  ● Example Suite › should handle errors

    Test failed with assertion error
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Example Suite › should handle errors');
    });

    it('should handle multiple test files', () => {
      const output = `
 FAIL test/first.test.ts
  Suite One
    ✕ test A (5 ms)

 FAIL test/second.test.ts
  Suite Two
    ✕ test B (8 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].file).toBe('test/first.test.ts');
      expect(result.errors[1].file).toBe('test/second.test.ts');
      expect(result.summary).toBe('2 test failure(s)');
    });

    it('should handle test without suite hierarchy', () => {
      const output = `
 FAIL test/example.test.ts
    ✕ standalone test (10 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('standalone test: Test failed');
    });

    it('should reset hierarchy when switching files', () => {
      const output = `
 FAIL test/first.test.ts
  First Suite
    ✕ test one (5 ms)

 FAIL test/second.test.ts
  Second Suite
    ✕ test two (8 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].message).toContain('First Suite › test one');
      expect(result.errors[1].message).toContain('Second Suite › test two');
    });

    it('should handle nested suite hierarchy changes', () => {
      const output = `
 FAIL test/example.test.ts
  Outer Suite
    Inner Suite
      ✕ nested test (5 ms)
    ✕ outer test (8 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].message).toContain('Outer Suite › Inner Suite › nested test');
      expect(result.errors[1].message).toContain('Outer Suite › outer test');
    });

    it('should ignore lines without file context', () => {
      const output = `
Some random output
    ✕ test without file
 FAIL test/example.test.ts
    ✕ real test (10 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('test/example.test.ts');
    });

    it('should handle mixed pass/fail output', () => {
      const output = `
 FAIL test/example.test.ts
  Example Suite
    ✓ passing test (5 ms)
    ✕ failing test (10 ms)
    ✓ another pass (3 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('failing test');
    });

    it('should limit output to MAX_ERRORS_IN_ARRAY', async () => {
      const { expectMaxErrorsTruncation } = await import('../../test/helpers/max-errors-helper.js');

      // Generate 15 test failures (more than MAX_ERRORS_IN_ARRAY = 10)
      const failures = Array.from(
        { length: 15 },
        (_, i) => `    ✕ test ${i + 1} (${i + 1} ms)`
      ).join('\n');

      const output = `
 FAIL test/example.test.ts
  Test Suite
${failures}
      `.trim();

      const result = extract(output);

      await expectMaxErrorsTruncation(result, {
        totalCount: 15,
        firstError: 'test 1',
        lastTruncatedError: 'test 10',
        summaryPattern: '15 test failure(s)',
        checkField: 'message',
        messageContains: true
      });

      // Error summary should also be truncated
      const { MAX_ERRORS_IN_ARRAY } = await import('../../result-schema.js');
      const summaryLines = result.errorSummary!.split('\n').filter(line => line.startsWith('●'));
      expect(summaryLines.length).toBeLessThanOrEqual(MAX_ERRORS_IN_ARRAY);
    });

    it('should handle empty output', () => {
      const result = extract('');

      expect(result.errors).toHaveLength(0);
      expect(result.summary).toBe('No test failures detected');
      expect(result.totalErrors).toBe(0);
      expect(result.guidance).toBe('');
    });

    it('should handle output with no failures', () => {
      const output = `
 PASS test/example.test.ts
  Example Suite
    ✓ should pass (5 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(0);
      expect(result.summary).toBe('No test failures detected');
      expect(result.totalErrors).toBe(0);
    });

    it('should generate clean errorSummary output', () => {
      const output = `
 FAIL test/example.test.ts
  Example Suite
    ✕ first test (10 ms)
    ✕ second test (15 ms)
    `.trim();

      const result = extract(output);

      expect(result.errorSummary).toContain('● Example Suite › first test');
      expect(result.errorSummary).toContain('● Example Suite › second test');
      expect(result.errorSummary).toContain('Location: test/example.test.ts');
      expect(result.errorSummary).toContain('Test failed');
    });

    it('should handle test names with special characters', () => {
      const output = `
 FAIL test/example.test.ts
  Example Suite
    ✕ should handle "quotes" and 'apostrophes' (10 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('should handle "quotes" and \'apostrophes\'');
    });

    it('should handle suite names with special characters', () => {
      const output = `
 FAIL test/example.test.ts
  Suite-With-Dashes
    ✕ test one (10 ms)
  Suite›With›Chevrons
    ✕ test two (15 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].message).toContain('Suite-With-Dashes › test one');
      expect(result.errors[1].message).toContain('Suite›With›Chevrons › test two');
    });

    it('should handle deeply nested suite hierarchies', () => {
      const output = `
 FAIL test/example.test.ts
  Level 1
    Level 2
      Level 3
        Level 4
          ✕ deeply nested test (10 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Level 1 › Level 2 › Level 3 › Level 4 › deeply nested test');
    });

    it('should handle file paths with directories', () => {
      const output = `
 FAIL packages/core/test/validator.test.ts
  Validator Suite
    ✕ should validate (10 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('packages/core/test/validator.test.ts');
    });

    it('should handle test timing variations', () => {
      const output = `
 FAIL test/example.test.ts
  Example Suite
    ✕ fast test (1 ms)
    ✕ slow test (1234 ms)
    ✕ no timing
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(3);
      expect(result.errors[0].message).toContain('fast test');
      expect(result.errors[1].message).toContain('slow test');
      expect(result.errors[2].message).toContain('no timing');
    });

    it('should set line/column to undefined when location info not available (regression test for GH-57)', () => {
      // Regression test: Jest output without line:column info should produce
      // undefined values (not 0) to comply with schema validation
      const output = `
 FAIL test/example.test.ts
  Example Suite
    ✕ test without location (10 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('test/example.test.ts');
      expect(result.errors[0].line).toBeUndefined(); // Not 0!
      expect(result.errors[0].column).toBeUndefined(); // Not 0!
      expect(result.errors[0].message).toContain('Example Suite › test without location');
    });
  });

  describe('plugin metadata', () => {
    it('should have correct metadata', () => {
      expect(jestPlugin.metadata.name).toBe('jest');
      expect(jestPlugin.metadata.description).toContain('Jest');
      expect(jestPlugin.priority).toBe(90);
      expect(jestPlugin.hints!.anyOf).toContain('FAIL');
      expect(jestPlugin.hints!.anyOf).toContain('✕');
      expect(jestPlugin.hints!.anyOf).toContain('●');
    });

    it('should include sample test cases', () => {
      expect(jestPlugin.samples).toBeDefined();
      expect(jestPlugin.samples.length).toBeGreaterThan(0);

      const singleFailure = jestPlugin.samples.find(s => s.name === 'single-test-failure');
      expect(singleFailure).toBeDefined();
      expect(singleFailure?.expectedErrors).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle output with only FAIL line (no test details)', () => {
      const output = ' FAIL test/example.test.ts';
      const result = extract(output);

      expect(result.errors).toHaveLength(0);
      expect(result.summary).toBe('No test failures detected');
    });

    it('should not extract suite names as failures', () => {
      const output = `
 FAIL test/example.test.ts
  Example Suite
  Another Suite
    ✕ actual test (10 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('actual test');
    });

    it('should handle malformed test markers', () => {
      const output = `
 FAIL test/example.test.ts
  Example Suite
    ✕
    ✕ valid test (10 ms)
    `.trim();

      const result = extract(output);

      // Should only extract the valid test
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('valid test');
    });

    it('should handle FAIL with module name prefix', () => {
      const output = `
 FAIL node_modules test/example.test.ts
  Example Suite
    ✕ should pass (10 ms)
    `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('test/example.test.ts');
    });
  });
});
