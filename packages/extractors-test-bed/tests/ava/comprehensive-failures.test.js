/**
 * Ava Comprehensive Failure Test Suite
 *
 * INTENTIONAL FAILURES for testing Ava error extractors
 *
 * STRATEGY: 80% real vibe-validate code, 20% simple edge cases
 *
 * This suite demonstrates all 10 failure categories using actual
 * vibe-validate packages to create realistic errors with complex stack traces.
 */

import test from 'ava';
import { readFileSync } from 'fs';

// ============================================================================
// REAL VIBE-VALIDATE USAGE (80%)
// ============================================================================

test('Extractors › Assertion Errors › should extract TypeScript errors correctly', async (t) => {
  // FAILURE TYPE 1: Assertion Error
  // INTENTIONAL FAILURE: Test extractor against known output, expect wrong count
  const { extractTypeScriptErrors } = await import('@vibe-validate/extractors');

  const tsOutput = 'src/runner.ts(45,10): error TS2345: Type mismatch.';
  const result = extractTypeScriptErrors(tsOutput);

  // Expected: 1 error, but we assert 5 (INTENTIONAL FAILURE)
  t.is(result.errors.length, 5, 'should have 5 errors');
});

test('Extractors › Assertion Errors › should parse ESLint errors from real output', async (t) => {
  // FAILURE TYPE 1: Assertion Error (continued)
  // INTENTIONAL FAILURE: Wrong expected summary
  const { extractESLintErrors } = await import('@vibe-validate/extractors');

  const eslintOutput = 'src/foo.ts\n  45:10  error  Unused variable  no-unused-vars';
  const result = extractESLintErrors(eslintOutput);

  t.is(result.summary, '0 error(s)', 'should have 0 errors'); // Actually: "1 error(s)"
});

test('Config › Type Errors › should fail when passing invalid config type', async (t) => {
  // FAILURE TYPE 2: TypeScript Type Errors
  // INTENTIONAL FAILURE: TypeScript type error - passing wrong type
  const { loadConfigFromFile } = await import('@vibe-validate/config');

  // Pass invalid path type (runtime type error)
  const config = await loadConfigFromFile(12345);
  t.truthy(config, 'config should be defined');
});

test('Core › Runtime Type Errors › should fail when calling method on undefined', async (t) => {
  // FAILURE TYPE 4: Runtime TypeError
  // INTENTIONAL FAILURE: Runtime TypeError
  const { autoDetectAndExtract } = await import('@vibe-validate/extractors');

  // Pass undefined as output (runtime TypeError)
  const result = autoDetectAndExtract('test', undefined);
  t.true(result.cleanOutput.length > 0, 'should have clean output');
});

test('Core › File System › should fail when reading non-existent file', (t) => {
  // FAILURE TYPE 3: Runtime Error (ENOENT)
  // INTENTIONAL FAILURE: Try to read non-existent file
  const content = readFileSync('/this/path/does/not/exist.txt', 'utf8');
  t.true(content.length > 0, 'should have content');
});

test('Git › Timeout simulation › should timeout waiting for git command', async (t) => {
  // FAILURE TYPE 5: Timeout
  // INTENTIONAL FAILURE: Simulate timeout with long-running operation

  // Use Ava's built-in timeout mechanism
  t.timeout(50); // 50ms timeout

  // Simulate a long-running operation
  await new Promise(resolve => setTimeout(resolve, 1000)); // Takes 1 second (will timeout at 50ms)

  t.pass('operation completed');
});

test('Extractors › Import Error › should fail when importing non-existent module', async (t) => {
  // FAILURE TYPE 8: Import Error
  // INTENTIONAL FAILURE: Import non-existent module
  const nonExistent = await import('./this-module-does-not-exist.js');
  t.truthy(nonExistent, 'module should be imported');
});

// ============================================================================
// SIMPLE EDGE CASES (20%)
// ============================================================================

test('Edge Cases › Nested describe blocks › Level 1 › Level 2 › should handle deep nesting', (t) => {
  // FAILURE TYPE 10: Nested Describe Blocks
  // INTENTIONAL FAILURE: Simple assertion
  t.is(2 + 2, 5, '2+2 should equal 5');
});

test('Edge Cases › Multiple assertions › should fail on second assertion', (t) => {
  // FAILURE TYPE 9: Multiple Failures
  // INTENTIONAL FAILURE: Multiple assertions, second one fails
  t.is(1 + 1, 2, 'first assertion passes');
  t.is(2 + 2, 5, 'second assertion fails'); // FAILS
  t.is(3 + 3, 7, 'third assertion fails'); // FAILS
});

test('Edge Cases › Async rejections › should handle promise rejection', async (t) => {
  // FAILURE TYPE 7: Async Rejection
  // INTENTIONAL FAILURE: Unhandled promise rejection
  await Promise.reject(new Error('Intentional async rejection'));
  t.pass('should not reach here');
});

test('Edge Cases › Null pointer › should fail when accessing property on null', (t) => {
  // FAILURE TYPE 4: Runtime TypeError (additional)
  // INTENTIONAL FAILURE: Null pointer
  const obj = null;
  const value = obj.someProperty; // NOSONAR - Intentional null access for error extractor testing
  t.truthy(value, 'value should exist');
});
