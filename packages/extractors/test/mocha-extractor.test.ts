/**
 * Mocha Error Extractor Tests
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';
import { extractMochaErrors } from '../src/mocha-extractor.js';

describe('extractMochaErrors', () => {
  describe('Basic Extraction', () => {
    it('should extract single test failure from Mocha output', () => {
      const input = `
  Vibe-Validate Mocha Test Matrix
    Failure Type 1: Assertion Errors
      1) should match expected value

  0 passing (10ms)
  1 failing

  1) Vibe-Validate Mocha Test Matrix
       Failure Type 1: Assertion Errors
         should match expected value:

      AssertionError [ERR_ASSERTION]: Expected 4 to equal 5
      at Context.<anonymous> (file:///tmp/test.js:16:14)
`;

      const result = extractMochaErrors(input);

      expect(result.summary).toBe('1 test(s) failed');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        // eslint-disable-next-line sonarjs/publicly-writable-directories -- Test fixture path, not actual file operation
        file: '/tmp/test.js',
        line: 16,
        message: 'Expected 4 to equal 5'
      });
      expect(result.errors[0].context).toContain('should match expected value');
    });

    it('should extract multiple test failures', () => {
      const input = `
  0 passing (20ms)
  3 failing

  1) Suite > Test 1:
     Error: First error
      at Context.<anonymous> (test.js:10:15)

  2) Suite > Test 2:
     Error: Second error
      at Context.<anonymous> (test.js:20:15)

  3) Suite > Test 3:
     Error: Third error
      at Context.<anonymous> (test.js:30:15)
`;

      const result = extractMochaErrors(input);

      expect(result.summary).toBe('3 test(s) failed');
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0].line).toBe(10);
      expect(result.errors[1].line).toBe(20);
      expect(result.errors[2].line).toBe(30);
    });
  });

  describe('Error Type Detection', () => {
    it('should detect AssertionError', () => {
      const input = `
  1 failing

  1) Test:
     AssertionError [ERR_ASSERTION]: Values not equal
      at Context.<anonymous> (test.js:10:14)
`;

      const result = extractMochaErrors(input);
      expect(result.errors[0].message).toContain('Values not equal');
    });

    it('should detect TypeError', () => {
      const input = `
  1 failing

  1) Test:
     TypeError: Cannot read properties of null (reading 'foo')
      at Context.<anonymous> (test.js:15:20)
`;

      const result = extractMochaErrors(input);
      expect(result.errors[0].message).toContain('Cannot read properties of null');
    });

    it('should detect ENOENT errors', () => {
      const input = `
  1 failing

  1) Test:
     Error: ENOENT: no such file or directory
      at Context.<anonymous> (test.js:20:10)
`;

      const result = extractMochaErrors(input);
      expect(result.errors[0].message).toContain('ENOENT');
    });

    it('should detect timeout errors', () => {
      const input = `
  1 failing

  1) Test:
     Error: Timeout of 100ms exceeded
      at listOnTimeout (node:internal/timers:608:17)
`;

      const result = extractMochaErrors(input);
      expect(result.errors[0].message).toContain('Timeout');
    });
  });

  describe('Location Extraction', () => {
    it('should extract file:line:column format', () => {
      const input = `
  1 failing

  1) Test:
     Error: Test error
      at Context.<anonymous> (file:///path/to/test.js:42:15)
`;

      const result = extractMochaErrors(input);
      expect(result.errors[0].file).toBe('/path/to/test.js');
      expect(result.errors[0].line).toBe(42);
    });

    it('should handle relative paths', () => {
      const input = `
  1 failing

  1) Test:
     Error: Test error
      at Context.<anonymous> (tests/unit/helpers.test.js:128:30)
`;

      const result = extractMochaErrors(input);
      expect(result.errors[0].file).toBe('tests/unit/helpers.test.js');
      expect(result.errors[0].line).toBe(128);
    });

    it('should handle absolute paths without file:// prefix', () => {
      const input = `
  1 failing

  1) Test:
     Error: Test error
      at Context.<anonymous> (/Users/jeff/project/test.js:50:10)
`;

      const result = extractMochaErrors(input);
      expect(result.errors[0].file).toBe('/Users/jeff/project/test.js');
      expect(result.errors[0].line).toBe(50);
    });
  });

  describe('Test Hierarchy', () => {
    it('should preserve test hierarchy in context', () => {
      const input = `
  1 failing

  1) Outer Suite
       Inner Suite
         Deep Suite
           should do something:
     Error: Test error
      at Context.<anonymous> (test.js:10:20)
`;

      const result = extractMochaErrors(input);
      expect(result.errors[0].context).toContain('Outer Suite');
      expect(result.errors[0].context).toContain('should do something');
    });

    it('should handle deeply nested describe blocks', () => {
      const input = `
  1 failing

  1) Level 1
       Level 2
         Level 3
           should work at deep nesting:
     AssertionError: Deep failure
      at Context.<anonymous> (test.js:100:15)
`;

      const result = extractMochaErrors(input);
      expect(result.errors[0].context).toContain('Level 3');
      expect(result.errors[0].context).toContain('should work at deep nesting');
    });
  });

  describe('Edge Cases', () => {
    it('should handle output with no failures', () => {
      const input = `
  5 passing (20ms)
  0 failing
`;

      const result = extractMochaErrors(input);
      expect(result.summary).toBe('0 test(s) failed');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle missing stack trace', () => {
      const input = `
  1 failing

  1) Test:
     Error: Something went wrong
`;

      const result = extractMochaErrors(input);
      expect(result.errors[0].message).toContain('Something went wrong');
      // Should still extract even without file/line
    });

    it('should handle malformed output gracefully', () => {
      const input = 'Not valid Mocha output';

      const result = extractMochaErrors(input);
      expect(result.summary).toContain('Unable to parse');
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Guidance Generation', () => {
    it('should provide assertion error guidance', () => {
      const input = `
  1 failing

  1) Test:
     AssertionError: Expected values to be equal
      at Context.<anonymous> (test.js:10:14)
`;

      const result = extractMochaErrors(input);
      expect(result.guidance).toContain('assertion');
    });

    it('should provide timeout guidance', () => {
      const input = `
  1 failing

  1) Test:
     Error: Timeout of 100ms exceeded
      at listOnTimeout (node:internal/timers:608:17)
`;

      const result = extractMochaErrors(input);
      expect(result.guidance).toContain('timeout');
    });
  });

  describe('Quality Metadata', () => {
    it('should include extraction metadata', () => {
      const input = `
  1 failing

  1) Test:
     Error: Test error
      at Context.<anonymous> (test.js:10:20)
`;

      const result = extractMochaErrors(input);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.confidence).toBeGreaterThan(0);
      expect(result.metadata?.completeness).toBeGreaterThan(0);
    });
  });
});
