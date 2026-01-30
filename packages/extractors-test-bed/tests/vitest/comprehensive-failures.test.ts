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
import {
  registerEdgeCaseTests,
  registerDeepNestingTest,
  registerExtractorIntegrationTests,
  registerConfigTypeErrorsTests,
} from '../shared-test-helpers.js';

// Wrapper functions for dynamic imports to match helper signature
async function extractESLintErrorsWrapper(output: string) {
  const { extractESLintErrors } = await import('@vibe-validate/extractors');
  return extractESLintErrors(output);
}

async function extractVitestErrorsWrapper(output: string) {
  const { extractVitestErrors } = await import('@vibe-validate/extractors');
  return extractVitestErrors(output);
}

async function autoDetectAndExtractWrapper(output: string) {
  const { autoDetectAndExtract } = await import('@vibe-validate/extractors');
  return autoDetectAndExtract(output);
}

async function defineConfigWrapper(config: unknown) {
  const { defineConfig } = await import('@vibe-validate/config');
  return defineConfig(config);
}

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
  });

  // Use shared helper for extractor integration tests
  registerExtractorIntegrationTests(
    describe,
    it,
    expect,
    extractESLintErrorsWrapper,
    extractVitestErrorsWrapper,
    autoDetectAndExtractWrapper
  );

  // Use shared helper for Config Type Errors tests
  registerConfigTypeErrorsTests(describe, it, expect, defineConfigWrapper, extractVitestErrorsWrapper);

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

  registerDeepNestingTest(describe, it, testDeeplyNestedStripAnsi);
});

// ============================================================================
// SIMPLE EDGE CASES (20%)
// ============================================================================

registerEdgeCaseTests(describe, it, expect, beforeEach, Calculator);
