import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { extractPlaywrightErrors } from '../src/playwright-extractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Playwright Extractor', () => {
  const sampleDir = join(__dirname, 'samples', 'playwright');

  describe('Basic Extraction', () => {
    it('should extract single failure', () => {
      const output = `
Running 1 test using 1 worker

  ✘   1 tests/example.spec.ts:10:5 › should fail (100ms)


  1) tests/example.spec.ts:10:5 › should fail

    Error: expect(received).toBe(expected)

    Expected: "foo"
    Received: "bar"

      10 |     test('should fail', async () => {
      11 |       const value = 'bar';
    > 12 |       expect(value).toBe('foo');
         |                     ^
      13 |     });

      at tests/example.spec.ts:12:21

  1 failed
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        file: 'tests/example.spec.ts',
        line: 12,
        column: 21,
        message: expect.stringContaining('expect(received).toBe(expected)'),
      });
      expect(result.errors[0].guidance).toContain('assertion');
    });

    it('should extract multiple failures', () => {
      const output = `
Running 3 tests using 1 worker

  ✘   1 tests/example.spec.ts:10:5 › first failure (100ms)
  ✘   2 tests/example.spec.ts:20:5 › second failure (150ms)
  ✘   3 tests/example.spec.ts:30:5 › third failure (200ms)


  1) tests/example.spec.ts:10:5 › first failure

    Error: First error

      at tests/example.spec.ts:12:21

  2) tests/example.spec.ts:20:5 › second failure

    Error: Second error

      at tests/example.spec.ts:22:21

  3) tests/example.spec.ts:30:5 › third failure

    Error: Third error

      at tests/example.spec.ts:32:21

  3 failed
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors).toHaveLength(3);
      expect(result.errors[0].message).toContain('First error');
      expect(result.errors[1].message).toContain('Second error');
      expect(result.errors[2].message).toContain('Third error');
    });

    it('should return empty array when no failures', () => {
      const output = `
Running 5 tests using 2 workers

  ✓  tests/example.spec.ts:10:5 › test passes (100ms)

  5 passed (1.2s)
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors).toHaveLength(0);
      expect(result.metadata.completeness).toBe(100);
    });
  });

  describe('Error Type Detection', () => {
    it('should detect assertion errors', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › assertion test

    Error: expect(received).toBe(expected)

      at tests/test.spec.ts:12:21
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors[0].guidance).toContain('assertion');
    });

    it('should detect timeout errors', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › timeout test

    Test timeout of 30000ms exceeded.

    Error: page.click: Test timeout of 30000ms exceeded.

      at tests/test.spec.ts:12:18
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors[0].guidance).toContain('timeout');
    });

    it('should detect element not found errors', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › element not found

    Error: page.click: Test timeout of 30000ms exceeded.
    Call log:
      - waiting for locator('#nonexistent')

      at tests/test.spec.ts:12:18
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors[0].guidance).toContain('element');
    });

    it('should detect visibility errors', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › visibility test

    Error: expect(locator).toBeVisible() failed

    Locator:  locator('#hidden')
    Expected: visible
    Received: hidden

      at tests/test.spec.ts:12:52
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors[0].guidance).toContain('assertion');
      expect(result.errors[0].message).toContain('toBeVisible');
    });

    it('should detect navigation errors', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › navigation error

    Error: page.goto: net::ERR_FILE_NOT_FOUND at file:///nonexistent.html

      at tests/test.spec.ts:12:18
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors[0].guidance).toContain('navigate');
    });
  });

  describe('Location Extraction', () => {
    it('should extract file, line, and column from stack trace', () => {
      const output = `
  1) tests/deep/nested/test.spec.ts:42:7 › failure

    Error: Test error

      at tests/deep/nested/test.spec.ts:45:23
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors[0]).toMatchObject({
        file: 'tests/deep/nested/test.spec.ts',
        line: 45,
        column: 23,
      });
    });

    it('should handle absolute paths in error location', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › failure

    Error: Test error

      at /Users/jeff/project/tests/test.spec.ts:12:21
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors[0].file).toMatch(/test\.spec\.ts$/);
      expect(result.errors[0].line).toBe(12);
      expect(result.errors[0].column).toBe(21);
    });
  });

  describe('Test Hierarchy', () => {
    it('should preserve test hierarchy from summary line', () => {
      const output = `
  ✘   1 tests/test.spec.ts:10:5 › Outer Describe › Inner Describe › test name (100ms)

  1) tests/test.spec.ts:10:5 › Outer Describe › Inner Describe › test name

    Error: Test failed

      at tests/test.spec.ts:12:21
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors[0].message).toContain('Outer Describe › Inner Describe › test name');
    });

    it('should handle deeply nested describe blocks', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › Level 1 › Level 2 › Level 3 › Level 4 › test

    Error: Deep test

      at tests/test.spec.ts:12:21
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors[0].message).toContain('Level 1 › Level 2 › Level 3 › Level 4 › test');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty output', () => {
      const result = extractPlaywrightErrors('');

      expect(result.errors).toHaveLength(0);
      expect(result.metadata.completeness).toBe(100);
    });

    it('should handle output with no test results', () => {
      const output = 'Some random output without test results';

      const result = extractPlaywrightErrors(output);

      expect(result.errors).toHaveLength(0);
    });

    it('should handle malformed failure entries', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › incomplete failure

    Error: Some error but no stack trace

  2) Another incomplete entry
`;

      const result = extractPlaywrightErrors(output);

      // Should extract the first one (has proper format)
      expect(result.errors.length).toBe(1);
      // Should have tracked the missing stack trace as an issue
      expect(result.metadata.issues.length).toBeGreaterThan(0);
      expect(result.metadata.issues[0]).toContain('No stack trace');
    });

    it('should handle ANSI color codes in error messages', () => {
      // NOTE: ANSI stripping is now done centrally in smart-extractor.ts
      // Individual extractors receive pre-stripped input from smart-extractor
      // This test verifies extractor doesn't break when ANSI codes are present
      const output = `
  1) tests/test.spec.ts:10:5 › test

    Error: \x1b[2mexpect(\x1b[22m\x1b[31mreceived\x1b[39m\x1b[2m).\x1b[22mtoBe\x1b[2m(\x1b[22m\x1b[32mexpected\x1b[39m\x1b[2m)\x1b[22m

      at tests/test.spec.ts:12:21
`;

      const result = extractPlaywrightErrors(output);

      // Should still extract the error even with ANSI codes present
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('expect');
    });
  });

  describe('Guidance Generation', () => {
    it('should provide guidance for assertion errors', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › assertion

    Error: expect(received).toBe(expected)

    Expected: "foo"
    Received: "bar"

      at tests/test.spec.ts:12:21
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors[0].guidance).toBeDefined();
      expect(result.errors[0].guidance).toContain('assertion');
    });

    it('should provide guidance for timeout errors', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › timeout

    Test timeout of 30000ms exceeded.

      at tests/test.spec.ts:12:18
`;

      const result = extractPlaywrightErrors(output);

      expect(result.errors[0].guidance).toContain('timeout');
    });
  });

  describe('Quality Metadata', () => {
    it('should report confidence level', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › test

    Error: Test error

      at tests/test.spec.ts:12:21
`;

      const result = extractPlaywrightErrors(output);

      expect(result.metadata.confidence).toBeGreaterThan(0);
      expect(result.metadata.confidence).toBeLessThanOrEqual(100);
    });

    it('should report completeness based on extracted data', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › complete test

    Error: Full error with location

      at tests/test.spec.ts:12:21

  2) tests/test.spec.ts:20:5 › incomplete test

    Error: No location info
`;

      const result = extractPlaywrightErrors(output);

      expect(result.metadata.completeness).toBeGreaterThan(0);
      expect(result.metadata.completeness).toBeLessThanOrEqual(100);
    });

    it('should report issues when extraction has problems', () => {
      const output = `
  1) tests/test.spec.ts:10:5 › failure without stack trace

    Error: Some error message
    Expected: foo
    Received: bar

  2) tests/test.spec.ts:20:5 › another failure without stack

    Error: Another error
`;

      const result = extractPlaywrightErrors(output);

      // Should extract both failures
      expect(result.errors.length).toBe(2);
      // Should report issues for missing stack traces
      expect(result.metadata.issues).toBeDefined();
      expect(result.metadata.issues.length).toBe(2);
      expect(result.metadata.issues[0]).toContain('No stack trace');
    });
  });

  describe('Comprehensive Sample', () => {
    it('should extract all failures from comprehensive sample', () => {
      const samplePath = join(sampleDir, 'comprehensive-failures-001.txt');
      const output = readFileSync(samplePath, 'utf-8');

      const result = extractPlaywrightErrors(output);

      // We expect 11 failures from the comprehensive test
      expect(result.errors.length).toBeGreaterThanOrEqual(10);
      expect(result.errors.length).toBeLessThanOrEqual(12);

      // All errors should have file and line
      for (const error of result.errors) {
        expect(error.file).toBeDefined();
        expect(error.line).toBeGreaterThan(0);
      }

      // Quality metrics should be high
      expect(result.metadata.confidence).toBeGreaterThan(80);
      expect(result.metadata.completeness).toBeGreaterThan(80);
    });
  });
});
