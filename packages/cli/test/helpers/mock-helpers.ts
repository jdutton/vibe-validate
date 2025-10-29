/**
 * Mock Helpers - Shared utilities for creating mocks in tests
 *
 * Eliminates duplication of mock setup patterns across test files.
 */

import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Command } from 'commander';
import { vi } from 'vitest';

/**
 * Create a mock ChildProcess for spawn testing
 *
 * Matches the exact behavior from run.test.ts:
 * - Uses process.nextTick for async emission
 * - Emits 'end' events on stdout/stderr
 * - Emits 'close' event with exit code
 *
 * @param stdoutData - Standard output data
 * @param stderrData - Standard error data
 * @param exitCode - Process exit code
 * @returns Mock ChildProcess instance
 */
export function createMockChildProcess(
  stdoutData: string,
  stderrData: string,
  exitCode: number
): ChildProcess {
  const mockProcess = new EventEmitter() as any;
  mockProcess.stdout = new EventEmitter();
  mockProcess.stderr = new EventEmitter();

  // Emit data and close events asynchronously
  process.nextTick(() => {
    if (stdoutData) {
      mockProcess.stdout.emit('data', Buffer.from(stdoutData));
    }
    if (stderrData) {
      mockProcess.stderr.emit('data', Buffer.from(stderrData));
    }
    mockProcess.stdout.emit('end');
    mockProcess.stderr.emit('end');
    mockProcess.emit('close', exitCode);
  });

  return mockProcess;
}

/**
 * Setup standard mock environment for command tests
 *
 * @returns Cleanup function to restore mocks
 */
export function setupCommandTestMocks(): () => void {
  // Mock console methods
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  // Mock process.exit
  const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as any);

  // Return cleanup function
  return () => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    processExitSpy.mockRestore();
  };
}

/**
 * Execute Commander program and capture output
 *
 * @param program - Commander program instance
 * @param args - Command arguments
 * @returns Captured stdout
 */
export async function executeCommandAndCaptureOutput(
  program: Command,
  args: string[]
): Promise<string> {
  try {
    await program.parseAsync(args, { from: 'user' });
  } catch (error: unknown) { // NOSONAR - Commander.js throws on exitOverride, caught to capture output
    // Expected - program.exit() throws (Commander's exitOverride throws on exit)
    expect(error).toBeDefined();
  }

  const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
    .map(call => call[0])
    .join('');

  return stdoutCalls;
}
