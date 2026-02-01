/**
 * Shared helpers for validate command tests
 * Reduces duplication and improves maintainability
 */

import { expect } from 'vitest';

/**
 * YAML Output Assertions
 */
export function expectYamlOutput(options: {
  stream?: 'stdout' | 'stderr';
  passed?: boolean;
  treeHash?: string;
  failedStep?: string;
  containsStrings?: string[];
}): void {
  const stream = options.stream === 'stderr' ? process.stderr : process.stdout;

  expect(stream.write).toHaveBeenCalledWith('---\n');

  if (options.passed !== undefined) {
    expect(stream.write).toHaveBeenCalledWith(
      expect.stringContaining(`passed: ${options.passed}`)
    );
  }

  if (options.treeHash) {
    expect(stream.write).toHaveBeenCalledWith(
      expect.stringContaining(`treeHash: ${options.treeHash}`)
    );
  }

  if (options.failedStep) {
    expect(stream.write).toHaveBeenCalledWith(
      expect.stringContaining(`failedStep: ${options.failedStep}`)
    );
  }

  if (options.containsStrings) {
    for (const str of options.containsStrings) {
      expect(stream.write).toHaveBeenCalledWith(expect.stringContaining(str));
    }
  }
}

/**
 * Console Output Assertions
 */
export function expectConsoleLog(message: string): void {
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining(message));
}

export function expectConsoleError(message: string): void {
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining(message));
}

export function expectNoConsoleError(message: string): void {
  expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining(message));
}

export function expectConsoleWarn(message: string): void {
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(message));
}

export function expectNoConsoleWarn(message: string): void {
  expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining(message));
}

/**
 * Create flaky history note with multiple runs
 * Useful for testing flaky validation detection
 */
export function createFlakyHistoryNote(): any {
  return {
    treeHash: 'abc123def456',
    runs: [
      {
        id: 'run-1',
        timestamp: '2025-10-22T00:00:00.000Z',
        duration: 5000,
        passed: true,
        branch: 'main',
        headCommit: 'abc123',
        uncommittedChanges: false,
        result: {
          passed: true,
          timestamp: '2025-10-22T00:00:00.000Z',
          treeHash: 'abc123def456',
          phases: [],
        },
      },
      {
        id: 'run-2',
        timestamp: '2025-10-22T01:00:00.000Z',
        duration: 4500,
        passed: false,
        branch: 'main',
        headCommit: 'abc123',
        uncommittedChanges: false,
        result: {
          passed: false,
          timestamp: '2025-10-22T01:00:00.000Z',
          treeHash: 'abc123def456',
          failedStep: 'Test Step',
          phases: [],
        },
      },
      {
        id: 'run-3',
        timestamp: '2025-10-22T02:00:00.000Z',
        duration: 5200,
        passed: true,
        branch: 'main',
        headCommit: 'abc123',
        uncommittedChanges: false,
        result: {
          passed: true,
          timestamp: '2025-10-22T02:00:00.000Z',
          treeHash: 'abc123def456',
          phases: [],
        },
      },
    ],
  };
}
