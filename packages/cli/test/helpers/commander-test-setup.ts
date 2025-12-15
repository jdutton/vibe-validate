/**
 * Commander Test Setup Utilities
 *
 * Shared test setup for Commander.js-based command tests.
 * Reduces duplication across 10+ command test files.
 *
 * @package @vibe-validate/cli
 */

import { Command } from 'commander';
import { vi } from 'vitest';

/**
 * Commander test environment
 * Returned by setupCommanderTest() for use in tests
 */
export interface CommanderTestEnv {
  /** Fresh Commander instance with exitOverride enabled */
  program: Command;
  /** Restore all mocks and spies */
  cleanup: () => void;
}

/**
 * Setup Commander test environment
 *
 * Creates a fresh Commander instance with:
 * - exitOverride() enabled (prevents process.exit from killing tests)
 * - console.log and console.error mocked
 * - process.exit mocked to throw instead of exiting
 *
 * Call this in beforeEach() and use the cleanup function in afterEach().
 *
 * @returns CommanderTestEnv with program instance and cleanup function
 *
 * @example
 * ```typescript
 * describe('my command', () => {
 *   let env: CommanderTestEnv;
 *
 *   beforeEach(() => {
 *     env = setupCommanderTest();
 *   });
 *
 *   afterEach(() => {
 *     env.cleanup();
 *   });
 *
 *   it('should work', () => {
 *     myCommand(env.program);
 *     // ... test assertions
 *   });
 * });
 * ```
 */
export function setupCommanderTest(): CommanderTestEnv {
  // Create fresh Commander instance
  const program = new Command();
  program.exitOverride(); // Prevent process.exit() from killing tests

  // Spy on console methods to capture output
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  // Mock process.exit to prevent it from actually exiting during tests
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
    throw new Error(`process.exit(${code})`);
  }) as any;

  return {
    program,
    cleanup: () => {
      vi.restoreAllMocks();
    },
  };
}

/**
 * Setup Commander test with console output capture
 *
 * Same as setupCommanderTest(), but also captures console output
 * for assertions.
 *
 * @returns CommanderTestEnv with program, cleanup, and captured output
 *
 * @example
 * ```typescript
 * describe('my command', () => {
 *   let env: CommanderTestEnvWithCapture;
 *
 *   beforeEach(() => {
 *     env = setupCommanderTestWithCapture();
 *   });
 *
 *   afterEach(() => {
 *     env.cleanup();
 *   });
 *
 *   it('should log output', () => {
 *     myCommand(env.program);
 *     expect(env.capturedLog).toContain('Success');
 *   });
 * });
 * ```
 */
export interface CommanderTestEnvWithCapture extends CommanderTestEnv {
  /** Captured console.log calls */
  capturedLog: string[];
  /** Captured console.error calls */
  capturedError: string[];
  /** Captured process.stdout.write calls */
  capturedStdout: string[];
  /** Captured process.stderr.write calls */
  capturedStderr: string[];
}

export function setupCommanderTestWithCapture(): CommanderTestEnvWithCapture {
  const capturedLog: string[] = [];
  const capturedError: string[] = [];
  const capturedStdout: string[] = [];
  const capturedStderr: string[] = [];

  // Create fresh Commander instance
  const program = new Command();
  program.exitOverride(); // Prevent process.exit() from killing tests

  // Spy on console methods and capture output
  vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    capturedLog.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    capturedError.push(args.join(' '));
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    capturedStdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
    capturedStderr.push(String(chunk));
    return true;
  });

  // Mock process.exit
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
    throw new Error(`process.exit(${code})`);
  }) as any;

  return {
    program,
    capturedLog,
    capturedError,
    capturedStdout,
    capturedStderr,
    cleanup: () => {
      vi.restoreAllMocks();
    },
  };
}
