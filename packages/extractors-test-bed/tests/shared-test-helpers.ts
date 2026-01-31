/**
 * Shared Test Helpers for Comprehensive Failure Tests
 *
 * Common test cases and setup functions shared between Jest and Vitest
 * comprehensive failure test suites.
 */

import type { Calculator } from '../src/calculator.js';

/**
 * Register edge case tests that are common between Jest and Vitest
 * These are intentional failures for testing error extractors
 */
export function registerEdgeCaseTests(
  describe: (name: string, fn: () => void) => void,
  it: (name: string, fn: () => void | Promise<void>, timeout?: number) => void,
  expect: (value: unknown) => unknown,
  beforeEach: (fn: () => void) => void,
  Calculator: new () => Calculator
): void {
  /* eslint-disable sonarjs/no-nested-functions -- Helper function creates nested test structure for test helpers */
  describe('Edge Cases (Simple Code)', () => {
    let calc: Calculator;

    beforeEach(() => {
      calc = new Calculator();
    });

    // FAILURE TYPE 1: Basic Assertion Error
    describe('Calculator › Assertions', () => {
      it('should add numbers correctly', () => {
        // INTENTIONAL FAILURE: Bug in Calculator.add()
        const result = calc.add(6, 7);
        expect(result).toBe(13); // Expected: 13, Actual: 14
      });
    });

    // FAILURE TYPE 3: Runtime Error (ENOENT)
    describe('File System › ENOENT', () => {
      it('should read config file', async () => {
        // INTENTIONAL FAILURE: File doesn't exist
        const fs = await import('node:fs/promises');
        const config = await fs.readFile('/this/file/does/not/exist.json', 'utf8');
        expect(config).toBeDefined();
      });
    });

    // FAILURE TYPE 5: Timeout
    describe('Performance › Timeout', () => {
      it('should complete within timeout', async () => {
        // INTENTIONAL FAILURE: Test times out
        await new Promise(resolve => setTimeout(resolve, 100000));
      }, 10); // 10ms timeout
    });

    // FAILURE TYPE 2: Simple Type Error
    describe('Calculator › Type Errors', () => {
      it('should return version as string', () => {
        // INTENTIONAL FAILURE: Returns number, not string
        const version = calc.getVersion();
        expect(typeof version).toBe('string');
      });
    });
  });
  /* eslint-enable sonarjs/no-nested-functions */
}

/**
 * Register Config Type Errors tests
 */
export function registerConfigTypeErrorsTests(
  describe: (name: string, fn: () => void) => void,
  it: (name: string, fn: () => void | Promise<void>) => void,
  expect: (value: unknown) => unknown,
  defineConfigFn: (config: unknown) => unknown,
  extractVitestErrorsFn: (output: unknown) => unknown
): void {
  // FAILURE TYPE 2: TypeScript Type Errors
  describe('Config › Type Errors', () => {
    it('should fail when passing invalid config type', async () => {
      // INTENTIONAL FAILURE: TypeScript type error - passing wrong type

      // @ts-expect-error - INTENTIONAL TYPE ERROR
      const config = defineConfigFn({
        steps: 'not an array', // Should be ValidationStep[]
        invalidKey: 123,
      });

      expect(config).toBeDefined();
    });

    it('should fail when extractors receive wrong input type', async () => {
      // INTENTIONAL FAILURE: Pass number instead of string to extractor

      // @ts-expect-error - INTENTIONAL TYPE ERROR
      const result = extractVitestErrorsFn(12345); // Should be string

      expect(result).toBeDefined();
    });
  });
}

/**
 * Register integration failure tests for extractors
 * These are the main vibe-validate integration tests
 */
export function registerExtractorIntegrationTests(
  describe: (name: string, fn: () => void) => void,
  it: (name: string, fn: () => void | Promise<void>) => void,
  expect: (value: unknown) => unknown,
  extractESLintErrors: (output: string) => { summary: string },
  extractVitestErrors: (output: string) => unknown,
  autoDetectAndExtract: (output: string) => { errorSummary: string }
): void {
  describe('Extractors › Assertion Errors', () => {
    it('should parse ESLint errors from real output', () => {
      // INTENTIONAL FAILURE: Wrong expected summary
      const eslintOutput = 'src/foo.ts\n  45:10  error  Unused variable  no-unused-vars';
      const result = extractESLintErrors(eslintOutput);

      expect(result.summary).toBe('0 error(s)'); // Actually: "1 error(s)"
    });
  });

  // FAILURE TYPE 4: Runtime TypeError
  describe('Core › Runtime Type Errors', () => {
    it('should fail when calling method on undefined', async () => {
      // INTENTIONAL FAILURE: Runtime TypeError

      // Pass undefined as output (runtime TypeError)
      const result = autoDetectAndExtract(undefined as unknown as string);

      expect(result.errorSummary.length).toBeGreaterThan(0);
    });
  });

  // FAILURE TYPE 6: Snapshot Mismatch
  describe('Extractors › Snapshot Testing', () => {
    it('should match extractor output snapshot', () => {
      // INTENTIONAL FAILURE: Snapshot will change due to dynamic data
      const vitestOutput = `
❌ packages/core/test/runner.test.ts > ValidationRunner > should fail
  AssertionError: expected 2 to equal 3
    at Object.<anonymous> (packages/core/test/runner.test.ts:45:12)
      `;

      const result = extractVitestErrors(vitestOutput);

      // Snapshot will fail because errors array contains dynamic data
      expect(result).toMatchSnapshot();
    });
  });

  // FAILURE TYPE 7: Async Rejection
  describe('Core › Async Errors', () => {
    it('should handle async function that rejects', async () => {
      // INTENTIONAL FAILURE: Unhandled promise rejection

      // Simulate async operation that rejects (like failed validation)
      const asyncValidation = async () => {
        throw new Error('Validation failed: Config schema mismatch');
      };

      // Don't await or catch - will cause unhandled rejection
      void asyncValidation();

      // This assertion will run before the rejection happens
      expect(true).toBe(true);
    });
  });

  // FAILURE TYPE 9: Multiple Failures
  describe('Extractors › Multiple Errors', () => {
    it('should handle multiple assertion failures', async () => {
      // INTENTIONAL FAILURE: Multiple assertions fail
      const tsResult = { errors: [], totalCount: 0, summary: '0' };
      const eslintResult = { totalCount: 0 };

      // Both will fail
      expect(tsResult.errors.length).toBe(100); // Actually 0
      expect(eslintResult.totalCount).toBe(200); // Actually 0
      expect(tsResult.summary).toContain('999 errors'); // Wrong
    });
  });
}

/**
 * Register deep nesting test case
 */
export function registerDeepNestingTest(
  describe: (name: string, fn: () => void) => void,
  it: (name: string, fn: () => void | Promise<void>) => void,
  testFn: () => void | Promise<void>
): void {
  // FAILURE TYPE 10: Nested Describe Blocks (Deep Hierarchy)
  describe('Deep Nesting', () => {
    describe('Level 1', () => {
      describe('Level 2', () => {
        // eslint-disable-next-line sonarjs/no-nested-functions -- Intentional deep nesting to test error extractor handling
        describe('Level 3', () => {

          it('should test deeply nested vibe-validate usage', testFn);
        });
      });
    });
  });
}
