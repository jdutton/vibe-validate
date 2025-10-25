/**
 * JUnit XML Error Extractor Tests
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';
import { extractJUnitErrors } from '../src/junit-extractor.js';

describe('extractJUnitErrors', () => {
  describe('Basic Extraction', () => {
    it('should extract single test failure from JUnit XML', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="1" failures="1" errors="0" time="0.002">
    <testsuite name="test/calculator.test.ts" tests="1" failures="1" errors="0" skipped="0" time="0.002">
        <testcase classname="test/calculator.test.ts" name="Calculator &gt; should add numbers" time="0.001">
            <failure message="expected 4 to be 5 // Object.is equality" type="AssertionError">
AssertionError: expected 4 to be 5 // Object.is equality

- Expected
+ Received

- 5
+ 4

 ❯ test/calculator.test.ts:10:21
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);

      expect(result.summary).toBe('1 test(s) failed');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        file: 'test/calculator.test.ts',
        line: 10,
        message: 'expected 4 to be 5 // Object.is equality'
      });
      // Context should contain test hierarchy (edge case - will refine)
      expect(result.errors[0].context).toBeTruthy();
    });

    it('should extract multiple test failures', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="2" errors="0" time="0.006">
    <testsuite name="test/math.test.ts" tests="3" failures="2" errors="0" skipped="0" time="0.006">
        <testcase classname="test/math.test.ts" name="Math &gt; should multiply" time="0.002">
            <failure message="expected 6 to be 8 // Object.is equality" type="AssertionError">
AssertionError: expected 6 to be 8 // Object.is equality
 ❯ test/math.test.ts:15:20
            </failure>
        </testcase>
        <testcase classname="test/math.test.ts" name="Math &gt; should divide" time="0.001">
        </testcase>
        <testcase classname="test/math.test.ts" name="Math &gt; should subtract" time="0.003">
            <failure message="expected -1 to be 0 // Object.is equality" type="AssertionError">
AssertionError: expected -1 to be 0 // Object.is equality
 ❯ test/math.test.ts:25:22
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);

      expect(result.summary).toBe('2 test(s) failed');
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].file).toBe('test/math.test.ts');
      expect(result.errors[1].file).toBe('test/math.test.ts');
    });
  });

  describe('Error Type Detection', () => {
    it('should detect AssertionError', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="test.ts">
        <testcase name="test">
            <failure message="assertion failed" type="AssertionError">
 ❯ test.ts:10:20
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.errors[0].message).toContain('assertion failed');
    });

    it('should detect TypeError', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="test.ts">
        <testcase name="test">
            <failure message="Cannot read properties of null" type="TypeError">
TypeError: Cannot read properties of null (reading 'foo')
 ❯ test.ts:38:18
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.errors[0].message).toContain('Cannot read properties of null');
    });

    it('should detect ENOENT errors', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="test.ts">
        <testcase name="test">
            <failure message="ENOENT: no such file or directory" type="Error">
Error: ENOENT: no such file or directory, open '/nonexistent/file.txt'
 ❯ test.ts:30:7
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.errors[0].message).toContain('ENOENT');
    });

    it('should detect timeout errors', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="test.ts">
        <testcase name="test">
            <failure message="Test timed out in 100ms." type="Error">
Error: Test timed out in 100ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test.ts:43:5
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.errors[0].message).toContain('Test timed out');
    });
  });

  describe('Location Extraction', () => {
    it('should extract file:line format', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="src/utils.test.ts">
        <testcase classname="src/utils.test.ts" name="test">
            <failure message="error" type="Error">
 ❯ src/utils.test.ts:42:15
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.errors[0].file).toBe('src/utils.test.ts');
      expect(result.errors[0].line).toBe(42);
    });

    it('should handle file:line:column format', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="test.ts">
        <testcase classname="test.ts" name="test">
            <failure message="error" type="Error">
 ❯ packages/core/test/runner.test.ts:128:30
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.errors[0].file).toBe('packages/core/test/runner.test.ts');
      expect(result.errors[0].line).toBe(128);
    });
  });

  describe('Test Hierarchy', () => {
    it('should preserve test hierarchy in context', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="test.ts">
        <testcase name="Suite &gt; Nested &gt; Deep &gt; test name">
            <failure message="error" type="Error">
 ❯ test.ts:10:20
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.errors[0].context).toContain('Suite > Nested > Deep > test name');
    });

    it('should decode HTML entities in test names', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="test.ts">
        <testcase name="Test with &quot;quotes&quot; &amp; symbols &gt; nested">
            <failure message="error" type="Error">
 ❯ test.ts:10:20
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.errors[0].context).toContain('"quotes"');
      expect(result.errors[0].context).toContain('& symbols >');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty JUnit XML', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites></testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.summary).toBe('0 test(s) failed');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle all passing tests', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites tests="5" failures="0">
    <testsuite name="test.ts" tests="5" failures="0">
        <testcase name="test 1" time="0.001"></testcase>
        <testcase name="test 2" time="0.001"></testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.summary).toBe('0 test(s) failed');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle invalid XML gracefully', () => {
      const input = 'Not valid XML';

      const result = extractJUnitErrors(input);
      expect(result.summary).toContain('Unable to parse JUnit XML');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle missing location in failure', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="test.ts">
        <testcase classname="test.ts" name="test">
            <failure message="error without location" type="Error">
Error: Something went wrong
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.errors[0].file).toBe('test.ts');
      // Edge case: location parsing when no ❯ marker - accepts 0 or undefined for now
      expect([0, undefined]).toContain(result.errors[0].line);
      expect(result.errors[0].message).toContain('error without location');
    });
  });

  describe('Guidance Generation', () => {
    it('should provide assertion error guidance', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="test.ts">
        <testcase name="test">
            <failure message="expected 4 to be 5" type="AssertionError">
 ❯ test.ts:10:20
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.guidance).toContain('assertion');
    });

    it('should provide timeout guidance', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="test.ts">
        <testcase name="test">
            <failure message="Test timed out" type="Error">
 ❯ test.ts:10:20
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.guidance).toContain('timeout');
    });
  });

  describe('Quality Metadata', () => {
    it('should include extraction metadata', () => {
      const input = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="test.ts">
        <testcase name="test">
            <failure message="error" type="Error">
 ❯ test.ts:10:20
            </failure>
        </testcase>
    </testsuite>
</testsuites>`;

      const result = extractJUnitErrors(input);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.confidence).toBeGreaterThan(0);
      expect(result.metadata?.completeness).toBeGreaterThan(0);
    });
  });
});
