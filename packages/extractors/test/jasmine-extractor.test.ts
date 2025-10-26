/**
 * Jasmine Error Extractor Tests
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';
import { extractJasmineErrors } from '../src/jasmine-extractor.js';

describe('extractJasmineErrors', () => {
  describe('Basic Extraction', () => {
    it('should extract single test failure from Jasmine output', () => {
      const input = `
Started
F

Failures:
1) Vibe-Validate Jasmine Test Matrix Failure Type 1: Assertion Errors should match expected value
  Message:
    Expected 4 to equal 5.
  Stack:
        at <Jasmine>
        at UserContext.<anonymous> (/private/tmp/jasmine-comprehensive.test.js:9:17)
        at <Jasmine>

1 spec, 1 failure
Finished in 0.037 seconds
`;

      const result = extractJasmineErrors(input);

      expect(result.summary).toBe('1 test(s) failed');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        file: '/private/tmp/jasmine-comprehensive.test.js',
        line: 9,
        message: 'Expected 4 to equal 5.'
      });
      expect(result.errors[0].context).toContain('should match expected value');
    });

    it('should extract multiple test failures', () => {
      const input = `
Started
FFF

Failures:
1) Suite > Test 1
  Message:
    Expected 1 to equal 2.
  Stack:
        at UserContext.<anonymous> (test.js:10:15)

2) Suite > Test 2
  Message:
    Expected 3 to equal 4.
  Stack:
        at UserContext.<anonymous> (test.js:20:15)

3) Suite > Test 3
  Message:
    Expected 5 to equal 6.
  Stack:
        at UserContext.<anonymous> (test.js:30:15)

3 specs, 3 failures
`;

      const result = extractJasmineErrors(input);

      expect(result.summary).toBe('3 test(s) failed');
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0].line).toBe(10);
      expect(result.errors[1].line).toBe(20);
      expect(result.errors[2].line).toBe(30);
    });
  });

  describe('Error Type Detection', () => {
    it('should detect assertion errors', () => {
      const input = `
Failures:
1) Test
  Message:
    Expected 'number' to equal 'string'.
  Stack:
        at UserContext.<anonymous> (test.js:10:14)

1 spec, 1 failure
`;

      const result = extractJasmineErrors(input);
      expect(result.errors[0].message).toContain('Expected');
    });

    it('should detect TypeError', () => {
      const input = `
Failures:
1) Test
  Message:
    TypeError: Cannot read properties of null (reading 'foo')
  Stack:
        at UserContext.<anonymous> (test.js:15:20)

1 spec, 1 failure
`;

      const result = extractJasmineErrors(input);
      expect(result.errors[0].message).toContain('Cannot read properties of null');
    });

    it('should detect ENOENT errors', () => {
      const input = `
Failures:
1) Test
  Message:
    Error: ENOENT: no such file or directory
  Stack:
        at Object.readFileSync (node:fs:435:20)
        at UserContext.<anonymous> (test.js:20:10)

1 spec, 1 failure
`;

      const result = extractJasmineErrors(input);
      expect(result.errors[0].message).toContain('ENOENT');
    });

    it('should detect timeout errors', () => {
      const input = `
Failures:
1) Test
  Message:
    Error: Timeout - Async function did not complete within 100ms
  Stack:
        at <Jasmine>
        at listOnTimeout (node:internal/timers:608:17)

1 spec, 1 failure
`;

      const result = extractJasmineErrors(input);
      expect(result.errors[0].message).toContain('Timeout');
    });
  });

  describe('Location Extraction', () => {
    it('should extract file:line:column format', () => {
      const input = `
Failures:
1) Test
  Message:
    Error: Test error
  Stack:
        at UserContext.<anonymous> (/path/to/test.js:42:15)

1 spec, 1 failure
`;

      const result = extractJasmineErrors(input);
      expect(result.errors[0].file).toBe('/path/to/test.js');
      expect(result.errors[0].line).toBe(42);
    });

    it('should handle relative paths', () => {
      const input = `
Failures:
1) Test
  Message:
    Error: Test error
  Stack:
        at UserContext.<anonymous> (tests/unit/helpers.test.js:128:30)

1 spec, 1 failure
`;

      const result = extractJasmineErrors(input);
      expect(result.errors[0].file).toBe('tests/unit/helpers.test.js');
      expect(result.errors[0].line).toBe(128);
    });
  });

  describe('Test Hierarchy', () => {
    it('should preserve nested describe blocks', () => {
      const input = `
Failures:
1) Vibe-Validate Jasmine Test Matrix Failure Type 10: Nested Describe Blocks Level 2 Level 3 should work at deep nesting
  Message:
    Expected true to be false.
  Stack:
        at UserContext.<anonymous> (/tmp/test.js:72:24)

1 spec, 1 failure
`;

      const result = extractJasmineErrors(input);
      expect(result.errors[0].context).toContain('Nested Describe Blocks');
      expect(result.errors[0].context).toContain('Level 2');
      expect(result.errors[0].context).toContain('Level 3');
    });
  });

  describe('Edge Cases', () => {
    it('should handle output with no failures', () => {
      const input = `
Started
...

3 specs, 0 failures
Finished in 0.037 seconds
`;

      const result = extractJasmineErrors(input);
      expect(result.summary).toBe('0 test(s) failed');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle missing stack trace', () => {
      const input = `
Failures:
1) Test
  Message:
    Something went wrong
  Stack:

1 spec, 1 failure
`;

      const result = extractJasmineErrors(input);
      expect(result.errors[0].message).toContain('Something went wrong');
      expect(result.errors[0].file).toBe('unknown');
    });

    it('should handle malformed output gracefully', () => {
      const input = 'Some random text that is not Jasmine output';

      const result = extractJasmineErrors(input);
      expect(result.summary).toContain('Unable to parse');
    });
  });

  describe('Guidance Generation', () => {
    it('should provide assertion error guidance', () => {
      const input = `
Failures:
1) Test
  Message:
    Expected 4 to equal 5.
  Stack:
        at UserContext.<anonymous> (test.js:10:14)

1 spec, 1 failure
`;

      const result = extractJasmineErrors(input);
      expect(result.guidance).toContain('assertion');
    });

    it('should provide timeout guidance', () => {
      const input = `
Failures:
1) Test
  Message:
    Error: Timeout - Async function did not complete within 100ms
  Stack:
        at listOnTimeout (node:internal/timers:608:17)

1 spec, 1 failure
`;

      const result = extractJasmineErrors(input);
      expect(result.guidance).toContain('timeout');
    });
  });

  describe('Quality Metadata', () => {
    it('should include extraction metadata', () => {
      const input = `
Failures:
1) Test
  Message:
    Expected 4 to equal 5.
  Stack:
        at UserContext.<anonymous> (test.js:10:14)

1 spec, 1 failure
`;

      const result = extractJasmineErrors(input);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.confidence).toBeGreaterThan(90);
      expect(result.metadata.completeness).toBe(100);
      expect(result.metadata.issues).toEqual([]);
    });
  });
});
