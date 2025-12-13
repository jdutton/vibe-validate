/**
 * Ava Error Extractor Tests
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';
import avaExtractor from './index.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { extract: extractAvaErrors, detect: detectAva } = avaExtractor;

describe('Ava Extractor Plugin', () => {
  describe('Detection', () => {
    it('should detect Ava output with high confidence', () => {
      const input = `
  ✘ [fail]: Test › should fail

  Test › should fail

  tests/test.js:10

  › file://tests/test.js:10:5
`;

      const result = detectAva(input);
      expect(result.confidence).toBeGreaterThanOrEqual(70);
      expect(result.patterns).toContain('Ava failure marker (✘ [fail]:)');
    });

    it('should reject non-Ava output', () => {
      const input = `
PASS tests/test.js
  ✓ test passes
`;

      const result = detectAva(input);
      expect(result.confidence).toBeLessThan(40);
    });
  });

  describe('Basic Extraction', () => {
    it('should extract single test failure from Ava output', () => {
      const input = `
  ✘ [fail]: Extractors › should extract TypeScript errors correctly should have 5 errors

  Extractors › should extract TypeScript errors correctly

  tests/ava/comprehensive-failures.test.js:28

   27:   // Expected: 1 error, but we assert 5 (INTENTIONAL FAILURE)
   28:   t.is(result.errors.length, 5, 'should have 5 errors');
   29: });

  should have 5 errors

  Difference (- actual, + expected):

  - 1
  + 5

  › file://tests/ava/comprehensive-failures.test.js:28:5
`;

      const result = extractAvaErrors(input);

      expect(result.summary).toBe('1 test(s) failed');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        file: 'tests/ava/comprehensive-failures.test.js',
        line: 28,
        message: 'should have 5 errors',
      });
      expect(result.errors[0].context).toContain('Extractors › should extract TypeScript errors correctly');
    });

    it('should extract multiple test failures', () => {
      const input = `
  ✘ [fail]: Test 1 › should fail first assertion error one
  ✘ [fail]: Test 2 › should fail second assertion error two
  ✘ [fail]: Test 3 › should fail third assertion error three

  Test 1 › should fail first assertion

  tests/ava/test.js:10

   10:   t.is(1, 2, 'error one');

  error one

  › file://tests/ava/test.js:10:5

  Test 2 › should fail second assertion

  tests/ava/test.js:20

   20:   t.is(2, 3, 'error two');

  error two

  › file://tests/ava/test.js:20:5

  Test 3 › should fail third assertion

  tests/ava/test.js:30

   30:   t.is(3, 4, 'error three');

  error three

  › file://tests/ava/test.js:30:5
`;

      const result = extractAvaErrors(input);

      expect(result.summary).toBe('3 test(s) failed');
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0].line).toBe(10);
      expect(result.errors[1].line).toBe(20);
      expect(result.errors[2].line).toBe(30);
      expect(result.errors[0].message).toBe('error one');
      expect(result.errors[1].message).toBe('error two');
      expect(result.errors[2].message).toBe('error three');
    });
  });

  describe('Error Type Detection', () => {
    it('should detect assertion errors', () => {
      const input = `
  ✘ [fail]: should fail assertion error

  tests/test.js:10

   10:   t.is(2 + 2, 5, '2+2 should equal 5');

  2+2 should equal 5

  Difference (- actual, + expected):

  - 4
  + 5

  › file://tests/test.js:10:5
`;

      const result = extractAvaErrors(input);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('2+2 should equal 5');
      expect(result.errors[0].guidance).toContain('assertion');
    });

    it('should detect TypeError', () => {
      const input = `
  ✘ [fail]: should fail with TypeError Error thrown in test

  Error thrown in test:

  TypeError {
    message: 'Cannot read properties of null (reading "someProperty")',
  }

  TypeError: Cannot read properties of null (reading 'someProperty')
      at file:///Users/jeff/project/test.js:118:21
`;

      const result = extractAvaErrors(input);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Cannot read properties of null');
      expect(result.errors[0].guidance).toContain('null/undefined');
    });

    it('should detect file not found errors (ENOENT)', () => {
      const input = String.raw`
  ✘ [fail]: should fail when reading non-existent file Error thrown in test

  Error thrown in test:

  Error {
    code: 'ENOENT',
    errno: -2,
    path: '/this/path/does/not/exist.txt',
    syscall: 'open',
    message: 'ENOENT: no such file or directory, open \'/this/path/does/not/exist.txt\'',
  }

  Error: ENOENT: no such file or directory, open '/this/path/does/not/exist.txt'
      at readFileSync (node:fs:435:20)
      at file:///Users/jeff/project/test.js:65:19
`;

      const result = extractAvaErrors(input);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('ENOENT');
      expect(result.errors[0].guidance).toContain('file path');
    });

    it('should detect timeout errors', () => {
      const input = `
  ✘ [fail]: should timeout waiting for operation Test timeout exceeded

  Error: Test timeout exceeded
      at Timeout.<anonymous> (file:///path/to/ava/lib/test.js:439:24)
      at listOnTimeout (node:internal/timers:608:17)
`;

      const result = extractAvaErrors(input);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('timeout');
      expect(result.errors[0].guidance).toContain('timeout');
    });
  });

  describe('Location Extraction', () => {
    it('should extract file location from file:// URL', () => {
      const input = `
  ✘ [fail]: test error

  tests/ava/test.js:96

  › file://tests/ava/test.js:96:5
`;

      const result = extractAvaErrors(input);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('tests/ava/test.js');
      expect(result.errors[0].line).toBe(96);
    });

    it('should extract file location from absolute path in file:// URL', () => {
      const input = `
  ✘ [fail]: test error

  Error: Something failed
      at file:///Users/jeff/Workspaces/project/tests/ava/test.js:118:21
`;

      const result = extractAvaErrors(input);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('/Users/jeff/Workspaces/project/tests/ava/test.js');
      expect(result.errors[0].line).toBe(118);
    });

    it('should extract file location from regular path format', () => {
      const input = `
  ✘ [fail]: test error

  tests/ava/comprehensive-failures.test.js:28

   28:   t.is(result.errors.length, 5, 'should have 5 errors');
`;

      const result = extractAvaErrors(input);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('tests/ava/comprehensive-failures.test.js');
      expect(result.errors[0].line).toBe(28);
    });
  });

  describe('Test Hierarchy', () => {
    it('should preserve test hierarchy in context', () => {
      const input = `
  ✘ [fail]: Extractors › Assertion Errors › should extract TypeScript errors correctly should have 5 errors

  Extractors › Assertion Errors › should extract TypeScript errors correctly

  tests/test.js:28

  › file://tests/test.js:28:5
`;

      const result = extractAvaErrors(input);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].context).toContain('Extractors › Assertion Errors › should extract TypeScript errors correctly');
    });

    it('should preserve deep hierarchy with multiple levels', () => {
      const input = `
  ✘ [fail]: Edge Cases › Nested describe blocks › Level 1 › Level 2 › should handle deep nesting 2+2 should equal 5

  Edge Cases › Nested describe blocks › Level 1 › Level 2 › should handle deep nesting

  tests/test.js:96

  › file://tests/test.js:96:5
`;

      const result = extractAvaErrors(input);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].context).toContain('Edge Cases › Nested describe blocks › Level 1 › Level 2 › should handle deep nesting');
    });
  });

  describe('Edge Cases', () => {
    it('should return empty errors for output with no failures', () => {
      // Has Ava patterns but no [fail] markers (all tests passed)
      const input = `
  ✓ Test Suite › should pass

  11 tests passed
`;

      const result = extractAvaErrors(input);

      // Detection should fail for passing tests (no ✘ [fail] marker)
      expect(result.errors).toHaveLength(0);
      expect(result.summary).toBe('Not Ava test output');
    });

    it('should handle empty output', () => {
      const result = extractAvaErrors('');

      expect(result.errors).toHaveLength(0);
      expect(result.summary).toBe('Not Ava test output');
    });

    it('should handle malformed failure output gracefully', () => {
      const input = `
  ✘ [fail]: malformed test

  This is malformed output without proper structure
`;

      const result = extractAvaErrors(input);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('unknown');
      expect(result.errors[0].line).toBeUndefined();
    });
  });

  describe('Guidance Generation', () => {
    it('should provide guidance for assertion errors', () => {
      const input = `
  ✘ [fail]: assertion failure 2+2 should equal 5

  Difference (- actual, + expected):

  - 4
  + 5

  › file://tests/test.js:10:5
`;

      const result = extractAvaErrors(input);

      expect(result.errors[0].guidance).toBeDefined();
      expect(result.errors[0].guidance).toContain('assertion');
    });

    it('should provide guidance for timeout errors', () => {
      const input = `
  ✘ [fail]: timeout Test timeout exceeded

  Error: Test timeout exceeded
`;

      const result = extractAvaErrors(input);

      expect(result.errors[0].guidance).toBeDefined();
      expect(result.errors[0].guidance).toContain('timeout');
    });
  });

  describe('Quality Metadata', () => {
    it('should include quality metadata in result', () => {
      const input = `
  ✘ [fail]: test error

  tests/test.js:10

  › file://tests/test.js:10:5
`;

      const result = extractAvaErrors(input);

      expect(result.metadata).toBeDefined();
      expect(result.metadata!.confidence).toBeGreaterThan(0);
      expect(result.metadata!.completeness).toBeGreaterThan(0);
      expect(result.metadata!.issues).toBeInstanceOf(Array);
    });

    it('should report high confidence for well-formed output', () => {
      const input = `
  ✘ [fail]: test error message

  Test › should fail

  tests/test.js:10

   10:   t.is(1, 2, 'error message');

  error message

  › file://tests/test.js:10:5
`;

      const result = extractAvaErrors(input);

      expect(result.metadata!.confidence).toBeGreaterThanOrEqual(90);
      expect(result.metadata!.completeness).toBeGreaterThanOrEqual(90);
    });
  });

  describe('Comprehensive Sample', () => {
    it('should extract errors from real Ava comprehensive failure output', () => {
      const samplePath = join(__dirname, 'samples', 'comprehensive-failures-001.txt');
      const sampleOutput = readFileSync(samplePath, 'utf-8');

      const result = extractAvaErrors(sampleOutput);

      // Should extract 11 failures from comprehensive test suite
      expect(result.errors.length).toBeGreaterThanOrEqual(10);
      expect(result.errors.length).toBeLessThanOrEqual(13);

      // Verify quality metadata
      expect(result.metadata!.confidence).toBeGreaterThanOrEqual(85);
      expect(result.metadata!.completeness).toBeGreaterThanOrEqual(70); // 8/11 failures have complete data

      // Spot check some specific failures
      const assertionErrors = result.errors.filter((e) => e.guidance?.includes('assertion'));
      expect(assertionErrors.length).toBeGreaterThan(0);

      const typeErrors = result.errors.filter((e) => e.guidance?.includes('null/undefined'));
      expect(typeErrors.length).toBeGreaterThan(0);

      // Verify all errors have required fields
      for (const error of result.errors) {
        expect(error.message).toBeDefined();
        expect(error.message.length).toBeGreaterThan(0);
        if (error.file !== 'unknown') {
          expect(error.file).toBeTruthy();
        }
      }
    });
  });

  describe('Plugin Samples', () => {
    // Helper: Verify expected vs actual error
    function verifyError(expected: Record<string, unknown>, actual: Record<string, unknown>) {
      if (expected.file) expect(actual.file).toBe(expected.file);
      if (expected.line) expect(actual.line).toBe(expected.line);
      if (expected.message) expect(actual.message).toContain(expected.message);
    }

    // Helper: Verify errors array
    function verifyErrors(expected: Array<Record<string, unknown>>, actual: Array<Record<string, unknown>>) {
      expect(actual).toHaveLength(expected.length);
      for (let i = 0; i < expected.length; i++) {
        verifyError(expected[i], actual[i]);
      }
    }

    // Helper: Test a single sample
    function testSample(sample: typeof avaExtractor.samples[number]) {
      const input = sample.input ?? readFileSync(join(__dirname, sample.inputFile!), 'utf-8');
      const result = extractAvaErrors(input);

      if (sample.expected!.totalErrors !== undefined) {
        expect(result.totalErrors).toBe(sample.expected!.totalErrors);
      }

      if (sample.expected!.errors) {
        verifyErrors(sample.expected!.errors, result.errors);
      }
    }

    it('should pass all registered samples', () => {
      for (const sample of avaExtractor.samples) {
        testSample(sample);
      }
    });
  });
});
