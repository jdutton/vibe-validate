/**
 * Vitest Comprehensive Failure Test Suite
 *
 * INTENTIONAL FAILURES for testing error extractors
 *
 * STRATEGY: 80% real vibe-validate code, 20% simple edge cases
 *
 * This suite demonstrates all 10 failure categories using actual
 * vibe-validate packages to create realistic errors with complex stack traces.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { Calculator } from '../../src/calculator.js';

// Helper: Test body for deeply nested test (reduces nesting for max-nested-callbacks)
async function testDeeplyNestedStripAnsi() {
  const { stripAnsiCodes } = await import('@vibe-validate/extractors');
  const input = '\x1b[31mError\x1b[0m';
  const result = stripAnsiCodes(input);
  // Wrong expectation (intentional failure)
  expect(result).toBe('Error with ANSI codes still present');
}

// ============================================================================
// REAL VIBE-VALIDATE USAGE (80%)
// ============================================================================

describe('Vibe-Validate Integration Failures', () => {

  // FAILURE TYPE 1: Assertion Error
  describe('Extractors › Assertion Errors', () => {
    it('should extract TypeScript errors correctly', async () => {
      // INTENTIONAL FAILURE: Test extractor against known output, expect wrong count
      const { extractTypeScriptErrors } = await import('@vibe-validate/extractors');

      const tsOutput = 'src/runner.ts(45,10): error TS2345: Type mismatch.';
      const result = extractTypeScriptErrors(tsOutput);

      // Expected: 1 error, but we assert 5 (INTENTIONAL FAILURE)
      expect(result.errors.length).toBe(5);
    });

    it('should parse ESLint errors from real output', async () => {
      // INTENTIONAL FAILURE: Wrong expected summary
      const { extractESLintErrors } = await import('@vibe-validate/extractors');

      const eslintOutput = 'src/foo.ts\n  45:10  error  Unused variable  no-unused-vars';
      const result = extractESLintErrors(eslintOutput);

      expect(result.summary).toBe('0 error(s)'); // Actually: "1 error(s)"
    });
  });

  // FAILURE TYPE 2: TypeScript Type Errors
  describe('Config › Type Errors', () => {
    it('should fail when passing invalid config type', async () => {
      // INTENTIONAL FAILURE: TypeScript type error - passing wrong type
      const { defineConfig } = await import('@vibe-validate/config');

      // @ts-expect-error - INTENTIONAL TYPE ERROR
      const config = defineConfig({
        steps: 'not an array', // Should be ValidationStep[]
        invalidKey: 123,
      });

      expect(config).toBeDefined();
    });

    it('should fail when extractors receive wrong input type', async () => {
      // INTENTIONAL FAILURE: Pass number instead of string to extractor
      const { extractVitestErrors } = await import('@vibe-validate/extractors');

      // @ts-expect-error - INTENTIONAL TYPE ERROR
      const result = extractVitestErrors(12345); // Should be string

      expect(result).toBeDefined();
    });
  });

  // FAILURE TYPE 4: Runtime TypeError
  describe('Core › Runtime Type Errors', () => {
    it('should fail when calling method on undefined', async () => {
      // INTENTIONAL FAILURE: Runtime TypeError
      const { autoDetectAndExtract } = await import('@vibe-validate/extractors');

      // Pass undefined as output (runtime TypeError)
      const result = autoDetectAndExtract(undefined as any);

      expect(result.errorSummary.length).toBeGreaterThan(0);
    });
  });

  // FAILURE TYPE 6: Snapshot Mismatch
  describe('Extractors › Snapshot Testing', () => {
    it('should match extractor output snapshot', async () => {
      // INTENTIONAL FAILURE: Snapshot will change due to dynamic data
      const { extractVitestErrors } = await import('@vibe-validate/extractors');

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
      asyncValidation();

      // This assertion will run before the rejection happens
      expect(true).toBe(true);
    });
  });

  // FAILURE TYPE 8: Import Error
  describe('Packages › Import Errors', () => {
    it('should fail when importing non-existent export', async () => {
      // INTENTIONAL FAILURE: Import error - function doesn't exist

      // @ts-expect-error - INTENTIONAL IMPORT ERROR
      const { nonExistentFunction } = await import('@vibe-validate/core');

      nonExistentFunction();
      expect(nonExistentFunction).toBeDefined(); // Unreachable - function call will throw
    });

    it('should fail when importing from wrong package', async () => {
      // INTENTIONAL FAILURE: Wrong package path

      // This package doesn't exist
      const { something } = await import('@vibe-validate/nonexistent-package');

      expect(something).toBeDefined();
    });
  });

  // FAILURE TYPE 9: Multiple Failures
  describe('Extractors › Multiple Errors', () => {
    it('should handle multiple assertion failures', async () => {
      // INTENTIONAL FAILURE: Multiple assertions fail
      const { extractTypeScriptErrors, extractESLintErrors } = await import('@vibe-validate/extractors');

      const tsResult = extractTypeScriptErrors('');
      const eslintResult = extractESLintErrors('');

      // Both will fail
      expect(tsResult.errors.length).toBe(100); // Actually 0
      expect(eslintResult.totalCount).toBe(200); // Actually 1
      expect(tsResult.summary).toContain('999 errors'); // Wrong
    });
  });

  // FAILURE TYPE 10: Nested Describe Blocks (Deep Hierarchy)
  describe('Deep Nesting', () => {
    describe('Level 1', () => {
      describe('Level 2', () => {
        describe('Level 3', () => { // NOSONAR - Intentional deep nesting to test error extractor handling of nested test structures
          // eslint-disable-next-line max-nested-callbacks -- Intentional deep nesting to test extractor behavior
          it('should test deeply nested vibe-validate usage', async () => {
            // INTENTIONAL FAILURE: Deep in hierarchy
            await testDeeplyNestedStripAnsi();
          });
        });
      });
    });
  });
});

// ============================================================================
// SIMPLE EDGE CASES (20%)
// ============================================================================

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
      expect(true).toBe(true); // Unreachable - test will timeout before this
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
