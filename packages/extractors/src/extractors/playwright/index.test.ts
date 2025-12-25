/**
 * Playwright Error Extractor Plugin Tests
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';

import {
  expectDetection,
  expectPluginMetadata,
} from '../../test/helpers/extractor-test-helpers.js';

import playwrightPlugin from './index.js';

describe('playwright extractor plugin', () => {
  describe('detect', () => {
    it('should detect Playwright output with ✘ marker', () => {
      expectDetection(
        playwrightPlugin,
        `
  ✘   1 tests/example.spec.ts:10:5 › should fail (100ms)
`,
        {
          confidence: 90,
          reasonContains: 'Playwright',
        }
      );
      expect(playwrightPlugin).toBeDefined();
    });

    it('should detect Playwright output with numbered failures', () => {
      expectDetection(
        playwrightPlugin,
        `
  1) tests/example.spec.ts:10:5 › test name
`,
        {
          confidence: 90,
        }
      );
      expect(playwrightPlugin).toBeDefined();
    });

    it('should not detect non-Playwright output', () => {
      expectDetection(playwrightPlugin, 'Some random text without Playwright patterns', {
        confidence: 0,
      });
      expect(playwrightPlugin.metadata.name).toBe('playwright'); // Explicit assertion for SonarQube
    });
  });

  describe('extract', () => {
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

        const result = playwrightPlugin.extract(output);

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

        const result = playwrightPlugin.extract(output);

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

        const result = playwrightPlugin.extract(output);
        expect(result.errors).toHaveLength(0);
        expect(result.totalErrors).toBe(0);
        expect(result.summary).toBe('0 test(s) failed');
        expect(result.metadata!.completeness).toBe(100);
      });
    });

    describe('Error Type Detection', () => {
      it('should detect assertion errors', () => {
        const output = `
  1) tests/test.spec.ts:10:5 › assertion test

    Error: expect(received).toBe(expected)

      at tests/test.spec.ts:12:21
`;

        const result = playwrightPlugin.extract(output);

        expect(result.errors[0].guidance).toContain('assertion');
      });

      it('should detect timeout errors', () => {
        const output = `
  1) tests/test.spec.ts:10:5 › timeout test

    Test timeout of 30000ms exceeded.

    Error: page.click: Test timeout of 30000ms exceeded.

      at tests/test.spec.ts:12:18
`;

        const result = playwrightPlugin.extract(output);

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

        const result = playwrightPlugin.extract(output);

        expect(result.errors[0].guidance).toContain('element');
      });

      it('should detect navigation errors', () => {
        const output = `
  1) tests/test.spec.ts:10:5 › navigation error

    Error: page.goto: net::ERR_FILE_NOT_FOUND at file:///nonexistent.html

      at tests/test.spec.ts:12:18
`;

        const result = playwrightPlugin.extract(output);

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

        const result = playwrightPlugin.extract(output);

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

        const result = playwrightPlugin.extract(output);

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

        const result = playwrightPlugin.extract(output);

        expect(result.errors[0].message).toContain('Outer Describe › Inner Describe › test name');
      });
    });

    describe('Quality Metadata', () => {
      it('should report confidence level', () => {
        const output = `
  1) tests/test.spec.ts:10:5 › test

    Error: Test error

      at tests/test.spec.ts:12:21
`;

        const result = playwrightPlugin.extract(output);

        expect(result.metadata!.confidence).toBeGreaterThan(0);
        expect(result.metadata!.confidence).toBeLessThanOrEqual(100);
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

        const result = playwrightPlugin.extract(output);

        // Should extract both failures
        expect(result.errors.length).toBe(2);
        // Should report issues for missing stack traces
        expect(result.metadata!.issues).toBeDefined();
        expect(result.metadata!.issues.length).toBe(2);
        expect(result.metadata!.issues[0]).toContain('No stack trace');
      });
    });
  });

  describe('samples', () => {
    it('should have at least 2 sample test cases', () => {
      expect(playwrightPlugin.samples).toBeDefined();
      expect(playwrightPlugin.samples.length).toBeGreaterThanOrEqual(2);
    });

    it('should successfully parse all sample inputs', () => {
      for (const sample of playwrightPlugin.samples) {
        const result = playwrightPlugin.extract(sample.input!);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.length).toBe(sample.expectedErrors);
      }
    });
  });

  describe('metadata', () => {
    it('should have complete plugin metadata', () => {
      expectPluginMetadata(playwrightPlugin, {
        name: 'playwright',
        priority: 90,
        requiredHints: ['.spec.ts'],
        anyOfHints: ['✘'],
        tags: ['playwright'],
      });

      // Verify additional metadata fields not covered by helper
      expect(playwrightPlugin.metadata.version).toBe('1.0.0');
      expect(playwrightPlugin.metadata.description).toBeTruthy();
    });
  });
});
