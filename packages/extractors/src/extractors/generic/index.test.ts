/**
 * Generic Extractor Tests
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';

import genericExtractor from './index.js';

const { extract: extractGenericErrors } = genericExtractor;

describe('Generic Extractor Plugin', () => {
  describe('Python pytest output', () => {
    it('should extract error lines from pytest output', () => {
      const pytestOutput = `
FAILED tests/test_foo.py::test_divide - ZeroDivisionError
FAILED tests/test_bar.py::test_validate - AssertionError
2 failed, 3 passed
`;

      const result = extractGenericErrors(pytestOutput);

      expect(result.summary).toBe('Command failed - see output');
      expect(result.errorSummary).toContain('FAILED');
      expect(result.errorSummary).toContain('ZeroDivisionError');
    });
  });

  describe('Go test output', () => {
    it('should extract FAIL lines from Go output', () => {
      const goOutput = `
--- FAIL: TestDivide (0.00s)
panic: runtime error
FAIL example.com/project 0.123s
`;

      const result = extractGenericErrors(goOutput);

      expect(result.errorSummary).toContain('FAIL: TestDivide');
      expect(result.errorSummary).toContain('panic:');
    });
  });

  describe('Token efficiency', () => {
    it('should limit errorSummary to 20 lines max', () => {
      const manyErrors = Array.from({ length: 50 }, (_, i) =>
        `FAILED test${i}.py - Error`
      ).join('\n');

      const result = extractGenericErrors(manyErrors);

      const lineCount = result.errorSummary!.split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(20);
    });
  });

  describe('Data integrity', () => {
    it('should always have totalErrors = 0 (generic doesnt populate errors array)', () => {
      const result = extractGenericErrors('FAILED test - error');
      expect(result.totalErrors).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  describe('Plugin Samples', () => {
    it('should pass all registered samples', () => {
      for (const sample of genericExtractor.samples) {
        const result = extractGenericErrors(sample.input!);
        if (sample.expected!.totalErrors !== undefined) {
          expect(result.totalErrors).toBe(sample.expected!.totalErrors);
        }
      }
    });
  });
});
