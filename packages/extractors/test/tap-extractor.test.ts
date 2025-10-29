/**
 * TAP Error Extractor Tests
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';
import { extractTAPErrors } from '../src/tap-extractor.js';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('extractTAPErrors', () => {
  describe('Basic Extraction', () => {
    it('should extract single test failure from TAP output', () => {
      const input = `TAP version 13
# Test › should pass assertion
not ok 1 should have 5 errors
  ---
    operator: equal
    expected: 5
    actual:   1
    at: Test.<anonymous> (file:///tmp/test.js:28:5)
    stack: |-
      Error: should have 5 errors
          at Test.assert [as _assert] (/path/to/tape/lib/test.js:492:48)
          at Test.<anonymous> (file:///tmp/test.js:28:5)
  ...
`;

      const result = extractTAPErrors(input);

      expect(result.summary).toBe('1 test(s) failed');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        // eslint-disable-next-line sonarjs/publicly-writable-directories -- Test fixture path, not actual file operation
        file: '/tmp/test.js',
        line: 28,
        message: 'should have 5 errors'
      });
      expect(result.errors[0].context).toContain('Test › should pass assertion');
    });

    it('should extract multiple test failures', () => {
      const input = `TAP version 13
# Test 1
not ok 1 first error
  ---
    at: Test.<anonymous> (test.js:10:5)
  ...
# Test 2
not ok 2 second error
  ---
    at: Test.<anonymous> (test.js:20:5)
  ...
# Test 3
not ok 3 third error
  ---
    at: Test.<anonymous> (test.js:30:5)
  ...
`;

      const result = extractTAPErrors(input);

      expect(result.summary).toBe('3 test(s) failed');
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0].line).toBe(10);
      expect(result.errors[1].line).toBe(20);
      expect(result.errors[2].line).toBe(30);
    });

    it('should handle passing tests without extracting them', () => {
      const input = `TAP version 13
ok 1 this test passes
# Failing test
not ok 2 this test fails
  ---
    at: test.js:15:10
  ...
ok 3 another passing test
`;

      const result = extractTAPErrors(input);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('this test fails');
    });
  });

  describe('Error Type Detection', () => {
    it('should detect assertion errors', () => {
      const input = `TAP version 13
not ok 1 should be equal
  ---
    operator: equal
    expected: 5
    actual: 3
    at: test.js:10:14
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors[0].message).toContain('should be equal');
    });

    it('should detect TypeError', () => {
      const input = `TAP version 13
not ok 1 Cannot read properties of undefined (reading 'includes')
  ---
    operator: fail
    at: test.js:15:20
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors[0].message).toContain('Cannot read properties of undefined');
    });

    it('should detect ENOENT errors', () => {
      const input = `TAP version 13
not ok 1 ENOENT: no such file or directory, open '/path/to/file.txt'
  ---
    operator: fail
    at: test.js:20:7
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors[0].message).toContain('ENOENT');
      expect(result.errors[0].message).toContain('no such file or directory');
    });

    it('should detect timeout errors', () => {
      const input = `TAP version 13
not ok 1 Test timed out after 50ms
  ---
    operator: fail
    at: test.js:25:8
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors[0].message).toContain('timed out');
    });
  });

  describe('Location Extraction', () => {
    it('should extract file path from at: field with file:// protocol', () => {
      const input = `TAP version 13
not ok 1 error
  ---
    at: Test.<anonymous> (file:///Users/path/to/test.js:42:10)
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors[0].file).toBe('/Users/path/to/test.js');
      expect(result.errors[0].line).toBe(42);
    });

    it('should extract file path from at: field without protocol', () => {
      const input = `TAP version 13
not ok 1 error
  ---
    at: test.js:15:5
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors[0].file).toBe('test.js');
      expect(result.errors[0].line).toBe(15);
    });

    it('should extract relative paths', () => {
      const input = `TAP version 13
not ok 1 error
  ---
    at: Test.<anonymous> (./src/tests/unit.js:100:20)
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors[0].file).toBe('./src/tests/unit.js');
      expect(result.errors[0].line).toBe(100);
    });
  });

  describe('Test Hierarchy Preservation', () => {
    it('should preserve test names from comments', () => {
      const input = `TAP version 13
# Suite › Nested › Deep test
not ok 1 assertion failed
  ---
    at: test.js:10:5
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors[0].context).toContain('Suite › Nested › Deep test');
    });

    it('should handle tests without comments', () => {
      const input = `TAP version 13
not ok 1 standalone failure
  ---
    at: test.js:20:5
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors[0].message).toBe('standalone failure');
    });
  });

  describe('Edge Cases', () => {
    it('should handle output with no failures', () => {
      const input = `TAP version 13
ok 1 all tests pass
ok 2 everything works
`;

      const result = extractTAPErrors(input);

      expect(result.errors).toHaveLength(0);
      expect(result.summary).toBe('0 test(s) failed');
    });

    it('should handle missing at: field', () => {
      const input = `TAP version 13
not ok 1 error without location
  ---
    operator: fail
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('error without location');
      expect(result.errors[0].file).toBeUndefined();
    });

    it('should handle malformed YAML blocks', () => {
      const input = `TAP version 13
not ok 1 malformed diagnostic
  some random text
  that is not YAML
`;

      const result = extractTAPErrors(input);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('malformed diagnostic');
    });

    it('should handle output without TAP version header', () => {
      const input = `
not ok 1 missing header
  ---
    at: test.js:10:5
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('Guidance Generation', () => {
    it('should provide guidance for assertion failures', () => {
      const input = `TAP version 13
not ok 1 should be equal
  ---
    operator: equal
    expected: 5
    actual: 3
    at: test.js:10:5
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors[0].guidance).toContain('assertion');
    });

    it('should provide guidance for timeout errors', () => {
      const input = `TAP version 13
not ok 1 Test timed out after 100ms
  ---
    at: test.js:20:5
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.errors[0].guidance).toContain('timeout');
    });
  });

  describe('Quality Metadata', () => {
    it('should provide extraction quality metadata', () => {
      const input = `TAP version 13
not ok 1 test failure
  ---
    at: test.js:10:5
  ...
`;

      const result = extractTAPErrors(input);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.confidence).toBeGreaterThan(0);
      expect(result.metadata.completeness).toBeGreaterThan(0);
      expect(result.metadata.issues).toBeInstanceOf(Array);
    });

    it('should report high confidence for well-formed TAP output', () => {
      const input = `TAP version 13
# Test › Comprehensive
not ok 1 assertion failure
  ---
    operator: equal
    expected: 10
    actual: 5
    at: Test.<anonymous> (file:///path/to/test.js:42:10)
    stack: |-
      Error: assertion failure
          at Test.assert (/path/to/tape.js:100:20)
          at Test.<anonymous> (file:///path/to/test.js:42:10)
  ...
`;

      const result = extractTAPErrors(input);
      expect(result.metadata.confidence).toBeGreaterThanOrEqual(90);
      expect(result.metadata.completeness).toBeGreaterThanOrEqual(90);
    });
  });

  describe('Comprehensive Sample', () => {
    it('should extract all failures from comprehensive-failures-001.txt sample', () => {
      const samplePath = join(__dirname, 'samples', 'tap', 'comprehensive-failures-001.txt');
      const input = readFileSync(samplePath, 'utf8');

      const result = extractTAPErrors(input);

      // Should extract all "not ok" lines
      expect(result.errors.length).toBeGreaterThanOrEqual(10);
      expect(result.errors.length).toBeLessThanOrEqual(15);

      // Quality should be high
      expect(result.metadata.confidence).toBeGreaterThanOrEqual(80);
      expect(result.metadata.completeness).toBeGreaterThanOrEqual(80);

      // All extracted errors should have messages
      result.errors.forEach(error => {
        expect(error.message).toBeTruthy();
      });
    });
  });
});
