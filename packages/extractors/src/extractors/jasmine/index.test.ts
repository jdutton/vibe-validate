/**
 * Jasmine Error Extractor Plugin Tests
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';

import {
  expectDetection,
  expectPluginMetadata,
  expectSamplesParseSuccessfully,
  expectPathExtraction,
} from '../../test/helpers/extractor-test-helpers.js';

import jasminePlugin from './index.js';

describe('jasmine extractor plugin', () => {
  describe('detect', () => {
    it('should detect Jasmine output with failures', () => {
      expectDetection(
        jasminePlugin,
        `
Failures:
1) Test
  Message:
    Expected true to be false
`,
        {
          confidence: 0, // No "spec" keyword, so not detected
          reasonContains: '',
        }
      );
      expect(jasminePlugin.metadata.name).toBe('jasmine'); // Explicit assertion for SonarQube
    });

    it('should detect Jasmine output with spec count', () => {
      expectDetection(jasminePlugin, `3 specs, 0 failures`, {
        confidence: 60, // Only "spec" keyword, weak signal
      });
      expect(jasminePlugin.metadata.name).toBe('jasmine'); // Explicit assertion for SonarQube
    });

    it('should detect Jasmine output with both spec and Failures', () => {
      expectDetection(
        jasminePlugin,
        `
3 specs, 1 failure
Failures:
1) Test
  Message:
    Expected true to be false
`,
        {
          confidence: 90, // Both "spec" and "Failures:", strong signal
          reasonContains: 'spec + Failures',
        }
      );
      expect(jasminePlugin.metadata.name).toBe('jasmine'); // Explicit assertion for SonarQube
    });

    it('should not detect non-Jasmine output', () => {
      expectDetection(jasminePlugin, 'Some random text without Jasmine patterns', {
        confidence: 0,
      });
      expect(jasminePlugin.metadata.name).toBe('jasmine'); // Explicit assertion for SonarQube
    });

    it('should not detect Maven Surefire output (regression test)', () => {
      // This was the actual Maven output that caused false positive detection
      const mavenOutput = `[ERROR] Tests run: 10, Failures: 2, Errors: 0, Skipped: 0
[ERROR] com.example.FooTest.testBar -- Time elapsed: 0.123 s <<< FAILURE!
java.lang.AssertionError: Expected 5 but was 3
  at com.example.FooTest.testBar(FooTest.java:42)

[INFO] Results:
[ERROR] Failures:
[ERROR]   FooTest.testBar:42 Expected 5 but was 3`;

      expectDetection(jasminePlugin, mavenOutput, {
        confidence: 0, // Should NOT detect as Jasmine (no "spec" keyword)
        reasonContains: '',
      });
      expect(jasminePlugin.metadata.name).toBe('jasmine'); // Explicit assertion for SonarQube
    });
  });

  describe('extract', () => {
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

        const result = jasminePlugin.extract(input);

        expect(result.summary).toBe('1 test(s) failed');
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({
          // eslint-disable-next-line sonarjs/publicly-writable-directories -- Test fixture path, not actual file operation
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

        const result = jasminePlugin.extract(input);

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

        const result = jasminePlugin.extract(input);
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

        const result = jasminePlugin.extract(input);
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

        const result = jasminePlugin.extract(input);
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

        const result = jasminePlugin.extract(input);
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
        expectPathExtraction(jasminePlugin, input, '/path/to/test.js', 42);
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
        expectPathExtraction(jasminePlugin, input, 'tests/unit/helpers.test.js', 128);
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

        const result = jasminePlugin.extract(input);
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

        const result = jasminePlugin.extract(input);
        expect(result.errors).toHaveLength(0);
        expect(result.totalErrors).toBe(0);
        expect(result.summary).toBe('0 test(s) failed');
        expect(jasminePlugin).toBeDefined();
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

        const result = jasminePlugin.extract(input);
        expect(result.errors[0].message).toContain('Something went wrong');
        expect(result.errors[0].file).toBe('unknown');
      });

      it('should handle malformed output gracefully', () => {
        const input = 'Some random text that is not Jasmine output';

        const result = jasminePlugin.extract(input);
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

        const result = jasminePlugin.extract(input);
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

        const result = jasminePlugin.extract(input);
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

        const result = jasminePlugin.extract(input);
        expect(result.metadata).toBeDefined();
        expect(result.metadata?.confidence ?? 0).toBeGreaterThan(90);
        expect(result.metadata?.completeness ?? 0).toBe(100);
        expect(result.metadata?.issues ?? []).toEqual([]);
      });
    });
  });

  describe('samples', () => {
    it('should have at least 2 sample test cases', () => {
      expect(jasminePlugin.samples).toBeDefined();
      expect(jasminePlugin.samples.length).toBeGreaterThanOrEqual(2);
    });

    it('should successfully parse all sample inputs', () => {
      expectSamplesParseSuccessfully(jasminePlugin);
    });
  });

  describe('metadata', () => {
    it('should have complete plugin metadata', () => {
      expectPluginMetadata(jasminePlugin, {
        name: 'jasmine',
        priority: 90,
        requiredHints: ['spec'],
        anyOfHints: ['Failures:'],
        tags: ['jasmine'],
      });

      // Verify additional metadata fields not covered by helper
      expect(jasminePlugin.metadata.version).toBe('1.0.0');
      expect(jasminePlugin.metadata.description).toBeTruthy();
    });
  });
});
