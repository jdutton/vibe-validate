/**
 * Generic Extractor Tests
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';

import {
  expectDetection,
  expectPluginMetadata,
} from '../../test/helpers/extractor-test-helpers.js';

import genericExtractor from './index.js';

const { extract: extractGenericErrors } = genericExtractor;

describe('Generic Extractor Plugin', () => {
  describe('detect', () => {
    it('should always return low confidence (fallback)', () => {
      expectDetection(
        genericExtractor,
        'Any random output text that does not match any specific format',
        {
          confidence: 10,
          patterns: ['Generic fallback'],
          reasonContains: 'Fallback extractor',
        }
      );
      expect(genericExtractor).toBeDefined();
    });

    it('should return same confidence for any input', () => {
      expectDetection(
        genericExtractor,
        'FAILED tests/test.py - Error',
        {
          confidence: 10,
        }
      );
      expect(genericExtractor).toBeDefined();
    });
  });

  describe('metadata', () => {
    it('should have correct plugin metadata', () => {
      expectPluginMetadata(genericExtractor, {
        name: 'generic',
        priority: 10,
        tags: ['generic', 'fallback'],
      });
      expect(genericExtractor).toBeDefined();
    });

    it('should have undefined hints (accepts everything)', () => {
      expect(genericExtractor.hints).toBeUndefined();
    });

    it('should have samples', () => {
      expect(genericExtractor.samples).toBeDefined();
      expect(genericExtractor.samples.length).toBeGreaterThan(0);
    });
  });

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
