/**
 * Test helpers for cache key encoding tests
 *
 * Provides utilities to create assertions and validate cache key properties,
 * reducing duplication across cache key tests.
 */

import { createHash } from 'node:crypto';

import { expect } from 'vitest';

import { encodeRunCacheKey } from '../../src/cache-key.js';

/**
 * Compute expected cache key for a command + workdir combination
 *
 * @example
 * ```typescript
 * expectedCacheKey('npm test', 'packages/cli')
 * // => SHA256('npm test__packages/cli').substring(0, 16)
 * ```
 */
export function expectedCacheKey(command: string, workdir: string): string {
  const input = `${command}__${workdir}`;
  return createHash('sha256').update(input).digest('hex').substring(0, 16);
}

/**
 * Test that a command+workdir produces the expected cache key
 *
 * @example
 * ```typescript
 * expectCacheKey('npm test', ''); // Validates hash is correct
 * expectCacheKey('npm test', 'packages/cli', { validateLength: true });
 * ```
 */
export function expectCacheKey(
  command: string,
  workdir: string,
  options: {
    validateLength?: boolean;
    validateFormat?: boolean;
  } = {}
): string {
  const result = encodeRunCacheKey(command, workdir);
  const expected = expectedCacheKey(command, workdir);

  expect(result).toBe(expected);

  if (options.validateLength) {
    expect(result).toHaveLength(16);
  }

  if (options.validateFormat) {
    expectValidHashFormat(result);
  }

  return result;
}

/**
 * Test that a cache key has valid hash format (16 hex chars)
 *
 * @example
 * ```typescript
 * const key = encodeRunCacheKey('npm test', '');
 * expectValidHashFormat(key);
 * ```
 */
export function expectValidHashFormat(hash: string): void {
  expect(hash).toMatch(/^[0-9a-f]{16}$/);
  expect(hash).toHaveLength(16);
}

/**
 * Test that a cache key is git-ref-safe (no special characters)
 *
 * @example
 * ```typescript
 * const key = encodeRunCacheKey('npm run test:coverage', 'pkg');
 * expectGitRefSafe(key);
 * ```
 */
export function expectGitRefSafe(hash: string): void {
  expectValidHashFormat(hash);
  expect(hash).not.toContain('%'); // No URL encoding
  expect(hash).not.toContain(':'); // No colons
  expect(hash).not.toContain('/'); // No slashes
  expect(hash).not.toContain(' '); // No spaces
}

/**
 * Test that two command variations produce the same cache key (normalization test)
 *
 * @example
 * ```typescript
 * expectSameKey('npm test', '  npm  test  ');
 * expectSameKey('npm test', 'npm\ttest');
 * ```
 */
export function expectSameKey(
  command1: string,
  command2: string,
  workdir = ''
): void {
  const result1 = encodeRunCacheKey(command1, workdir);
  const result2 = encodeRunCacheKey(command2, workdir);
  expect(result1).toBe(result2);
}

/**
 * Test that two commands produce different cache keys
 *
 * @example
 * ```typescript
 * expectDifferentKeys('npm test', 'npm build');
 * expectDifferentKeys(['npm test', ''], ['npm test', 'packages/cli']);
 * ```
 */
export function expectDifferentKeys(
  input1: string | [string, string],
  input2: string | [string, string]
): void {
  const [cmd1, workdir1] = Array.isArray(input1) ? input1 : [input1, ''];
  const [cmd2, workdir2] = Array.isArray(input2) ? input2 : [input2, ''];

  const result1 = encodeRunCacheKey(cmd1, workdir1);
  const result2 = encodeRunCacheKey(cmd2, workdir2);
  expect(result1).not.toBe(result2);
}

/**
 * Test that command normalization trims whitespace and produces expected key
 *
 * @example
 * ```typescript
 * expectTrimmed('  npm test  ', 'npm test');
 * expectTrimmed('  npm test  ', 'npm test', '  packages/cli  ', 'packages/cli');
 * ```
 */
export function expectTrimmed(
  inputCommand: string,
  expectedCommand: string,
  inputWorkdir = '',
  expectedWorkdir = ''
): void {
  const result = encodeRunCacheKey(inputCommand, inputWorkdir);
  const expected = expectedCacheKey(expectedCommand, expectedWorkdir);
  expect(result).toBe(expected);
}

/**
 * Test that a command preserves its internal spacing (complex command test)
 *
 * @example
 * ```typescript
 * expectPreservedSpacing('echo "hello  world"');
 * expectPreservedSpacing('cat  file | grep  test');
 * ```
 */
export function expectPreservedSpacing(command: string, workdir = ''): void {
  const result = encodeRunCacheKey(command, workdir);
  const expected = expectedCacheKey(command, workdir);
  expect(result).toBe(expected);
}

/**
 * Test determinism - same input produces same output across multiple calls
 *
 * @example
 * ```typescript
 * expectDeterministic('npm test', 'packages/cli');
 * ```
 */
export function expectDeterministic(command: string, workdir: string): void {
  const result1 = encodeRunCacheKey(command, workdir);
  const result2 = encodeRunCacheKey(command, workdir);
  const result3 = encodeRunCacheKey(command, workdir);

  expect(result1).toBe(result2);
  expect(result2).toBe(result3);
}
