/**
 * Commander Test Setup Utilities
 *
 * Shared test setup for Commander.js-based command tests.
 * Reduces duplication across 10+ command test files.
 *
 * @package @vibe-validate/cli
 */

import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
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
    throw new Error(`process.exit(${code ?? 0})`);
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
    throw new Error(`process.exit(${code ?? 0})`);
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

/**
 * Execute a Commander command and capture exit code
 *
 * Handles both Commander exitOverride errors and process.exit() mocks.
 * Useful for testing commands that call process.exit() on success or failure.
 *
 * @param program - Commander program instance
 * @param args - Command arguments (e.g., ['state'], ['state', '--verbose'])
 * @returns Exit code (0 for success, 1+ for error)
 *
 * @example
 * ```typescript
 * const exitCode = await executeCommandAndGetExitCode(env.program, ['state']);
 * expect(exitCode).toBe(0);
 * ```
 */
export async function executeCommandAndGetExitCode(
  program: Command,
  args: string[]
): Promise<number> {
  try {
    await program.parseAsync(args, { from: 'user' });
    return 0;
  } catch (err: unknown) {
    // Commander exitOverride throws CommanderError with exitCode
    if (err && typeof err === 'object' && 'exitCode' in err) {
      return (err as { exitCode: number }).exitCode;
    }
    // process.exit throws Error with message "process.exit(code)"
    if (err instanceof Error && err.message.startsWith('process.exit(')) {
      const match = /process\.exit\((\d+)\)/.exec(err.message);
      if (match) {
        return Number.parseInt(match[1], 10);
      }
      // Handle process.exit(undefined), process.exit(null), etc. - default to 0
      return 0;
    }
    // Unexpected error
    return 1;
  }
}

/**
 * Temp directory test environment
 * Returned by setupTempDirTest() for use in tests that need a temporary working directory
 */
export interface TempDirTestEnv {
  /** Path to temporary test directory */
  testDir: string;
  /** Original working directory (to restore in cleanup) */
  originalCwd: string;
  /** Cleanup function - restores cwd and removes temp directory */
  cleanup: () => void;
}

/**
 * Setup temporary directory for testing commands that need file system isolation
 *
 * Creates a temporary directory, changes to it, and provides cleanup.
 * Use this for tests that create config files, read from disk, etc.
 *
 * @param testNamePrefix - Prefix for temp directory name (e.g., 'vibe-validate-config-test')
 * @returns TempDirTestEnv with testDir path and cleanup function
 *
 * @example
 * ```typescript
 * describe('my command', () => {
 *   let tempEnv: TempDirTestEnv;
 *
 *   beforeEach(() => {
 *     tempEnv = setupTempDirTest('my-command-test');
 *   });
 *
 *   afterEach(() => {
 *     tempEnv.cleanup();
 *   });
 * });
 * ```
 */
export function setupTempDirTest(testNamePrefix: string): TempDirTestEnv {
  // Create temp directory for test files (Windows-safe: no 8.3 short names)
  const targetDir = join(normalizedTmpdir(), `${testNamePrefix}-${Date.now()}`);
  const testDir = mkdirSyncReal(targetDir, { recursive: true });

  // Save original cwd and change to test directory
  const originalCwd = process.cwd();
  process.chdir(testDir);

  return {
    testDir,
    originalCwd,
    cleanup: () => {
      // Restore cwd
      process.chdir(originalCwd);

      // Clean up test files
      if (existsSync(testDir)) {
        try {
          rmSync(testDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    },
  };
}

/**
 * Get a command by name from a Commander program
 *
 * Helper to reduce duplication when checking command registration.
 *
 * @param program - Commander program instance
 * @param commandName - Name of command to find
 * @returns Command instance or undefined if not found
 *
 * @example
 * ```typescript
 * const configCmd = getCommandByName(env.program, 'config');
 * expect(configCmd).toBeDefined();
 * expect(configCmd?.description()).toBe('...');
 * ```
 */
export function getCommandByName(program: Command, commandName: string): Command | undefined {
  return program.commands.find(cmd => cmd.name() === commandName);
}

/**
 * Check if a command has a specific option flag
 *
 * Helper to reduce duplication when checking option registration.
 *
 * @param program - Commander program instance
 * @param commandName - Name of command
 * @param optionFlags - Option flags to check (e.g., '-v, --verbose')
 * @returns True if option exists, false otherwise
 *
 * @example
 * ```typescript
 * expect(hasOption(env.program, 'config', '--validate')).toBe(true);
 * expect(hasOption(env.program, 'config', '-v, --verbose')).toBe(true);
 * ```
 */
export function hasOption(program: Command, commandName: string, optionFlags: string): boolean {
  const command = getCommandByName(program, commandName);
  return command?.options.some(opt => opt.flags === optionFlags) ?? false;
}
