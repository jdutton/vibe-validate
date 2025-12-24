/**
 * Test helpers for validation check tests
 *
 * Provides utilities for creating test data and assertions
 * to eliminate duplication in validation check tests.
 */

import type { PhaseResult } from '@vibe-validate/core';
import type { HistoryNote, ValidationRun } from '@vibe-validate/history';
import type { SpyInstance } from 'vitest';
import { expect } from 'vitest';

/**
 * Options for creating a validation run
 */
interface CreateRunOptions {
  id?: string;
  timestamp?: string;
  duration?: number;
  passed: boolean;
  branch?: string;
  headCommit?: string;
  uncommittedChanges?: boolean;
  phases?: PhaseResult[];
}

/**
 * Options for creating a phase result
 */
interface CreatePhaseOptions {
  name: string;
  durationSecs?: number;
  passed: boolean;
  steps?: Array<{
    name: string;
    passed: boolean;
    durationSecs?: number;
  }>;
}

/**
 * Create a validation run object for testing
 *
 * @param options - Run configuration
 * @returns ValidationRun object
 *
 * @example
 * const run = createValidationRun({
 *   passed: true,
 *   branch: 'main',
 *   phases: [createPhaseResult({ name: 'Testing', passed: true })]
 * });
 */
export function createValidationRun(options: CreateRunOptions): ValidationRun {
  const timestamp = options.timestamp ?? '2025-10-21T10:00:00Z';
  const treeHash = 'abc123def456';

  return {
    id: options.id ?? 'run-1',
    timestamp,
    duration: options.duration ?? 5000,
    passed: options.passed,
    branch: options.branch ?? 'main',
    headCommit: options.headCommit ?? 'commit123',
    uncommittedChanges: options.uncommittedChanges ?? false,
    result: {
      passed: options.passed,
      timestamp,
      treeHash,
      phases: options.phases ?? [],
    },
  };
}

/**
 * Create a phase result object for testing
 *
 * @param options - Phase configuration
 * @returns PhaseResult object
 *
 * @example
 * const phase = createPhaseResult({
 *   name: 'Testing',
 *   passed: true,
 *   steps: [
 *     { name: 'Unit Tests', passed: true, durationSecs: 2.5 }
 *   ]
 * });
 */
export function createPhaseResult(options: CreatePhaseOptions): PhaseResult {
  return {
    name: options.name,
    durationSecs: options.durationSecs ?? 2.5,
    passed: options.passed,
    steps: options.steps ?? [],
  };
}

/**
 * Create a history note object for testing
 *
 * @param runs - Array of validation runs
 * @param treeHash - Optional tree hash (defaults to 'abc123def456')
 * @returns HistoryNote object
 *
 * @example
 * const note = createHistoryNote([
 *   createValidationRun({ passed: true, timestamp: '2025-10-21T09:00:00Z' }),
 *   createValidationRun({ passed: false, timestamp: '2025-10-21T10:00:00Z' })
 * ]);
 */
export function createHistoryNote(runs: ValidationRun[], treeHash = 'abc123def456'): HistoryNote {
  return {
    treeHash,
    runs,
  };
}

/**
 * Assert that console.log was called with expected strings
 *
 * @param spy - Console log spy
 * @param expectedStrings - Array of strings that should appear in console.log calls
 *
 * @example
 * expectConsoleOutput(consoleLogSpy, [
 *   'Validation already passed',
 *   'Tree hash: abc123def456'
 * ]);
 */
export function expectConsoleOutput(
  spy: SpyInstance,
  expectedStrings: string[]
): void {
  for (const expectedString of expectedStrings) {
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(expectedString)
    );
  }
}

/**
 * Assert that process.exit was called with expected code and verify thrown error
 *
 * @param exitCode - Expected exit code
 * @returns Matcher for expect().rejects.toThrow()
 *
 * @example
 * await expect(checkValidationStatus(config)).rejects.toThrow(
 *   expectProcessExit(0)
 * );
 */
export function expectProcessExit(exitCode: number): string {
  return `process.exit(${exitCode})`;
}

/**
 * Assert YAML output structure and content
 *
 * @param spy - stdout.write spy
 * @param expectedContent - Array of strings that should appear in YAML output
 *
 * @example
 * expectYamlOutput(stdoutWriteSpy, [
 *   'passed: false',
 *   'treeHash: abc123def456'
 * ]);
 */
export function expectYamlOutput(
  spy: SpyInstance,
  expectedContent: string[]
): void {
  expect(spy).toHaveBeenCalled();

  // First call should be YAML separator
  expect(spy.mock.calls[0][0]).toBe('---\n');

  // Second call should contain YAML content
  const yamlOutput = spy.mock.calls[1][0] as string;
  for (const content of expectedContent) {
    expect(yamlOutput).toContain(content);
  }
}

/**
 * Assert that console.log was NOT called with specified strings
 * (useful for YAML mode where human-readable output should be suppressed)
 *
 * @param spy - Console log spy
 * @param unexpectedStrings - Array of strings that should NOT appear
 *
 * @example
 * expectNoConsoleOutput(consoleLogSpy, ['⚠️', '💡']);
 */
export function expectNoConsoleOutput(
  spy: SpyInstance,
  unexpectedStrings: string[]
): void {
  for (const unexpectedString of unexpectedStrings) {
    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining(unexpectedString)
    );
  }
}
