import type { ValidationResult } from '@vibe-validate/core';
import { getGitTreeHash, type TreeHash } from '@vibe-validate/git';
import type { HistoryNote } from '@vibe-validate/history';
import { hasHistoryForTree, readHistoryNote, getAllRunCacheForTree } from '@vibe-validate/history';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { stateCommand } from '../../src/commands/state.js';
import * as configLoader from '../../src/utils/config-loader.js';
import { setupCommanderTest, executeCommandAndGetExitCode, type CommanderTestEnv } from '../helpers/commander-test-setup.js';
import { setupHistoryMocks } from '../helpers/mock-helpers.js';


// Mock dependencies
vi.mock('@vibe-validate/git', () => ({
  getGitTreeHash: vi.fn(),
}));

vi.mock('@vibe-validate/history', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    hasHistoryForTree: vi.fn(),
    readHistoryNote: vi.fn(),
    getAllRunCacheForTree: vi.fn(),
    getMostRecentRun: actual.getMostRecentRun, // Use actual implementation
  };
});

vi.mock('../../src/utils/config-loader.js', () => ({
  findConfigPath: vi.fn(),
}));

/**
 * Creates a mock validation result for testing
 * @param passed - Whether validation passed
 * @param timestamp - ISO timestamp string
 * @param treeHash - Git tree hash
 * @param failedStep - Optional failed step name (for failed validations)
 * @returns Mock ValidationResult object
 */
function createMockValidationResult(
  passed: boolean,
  timestamp: string,
  treeHash: string,
  failedStep?: string
): ValidationResult {
  return {
    passed,
    timestamp,
    treeHash,
    ...(failedStep && { failedStep }),
    phases: [],
  };
}

/**
 * Creates a mock history note for testing
 * @param treeHash - Git tree hash
 * @param runs - Array of validation runs with branch, timestamp, and result
 * @returns Mock HistoryNote object
 */
function createMockHistoryNote(
  treeHash: string,
  runs: Array<{ branch: string; timestamp: string; result: ValidationResult }>
): HistoryNote {
  return {
    treeHash,
    runs,
  };
}

/**
 * Asserts that console.log output contains expected strings
 * @param expectedStrings - Array of strings that should appear in console.log calls
 */
function expectConsoleLogContains(...expectedStrings: string[]): void {
  const allLogCalls = vi.mocked(console.log).mock.calls.map(call => call.join(' '));
  for (const expected of expectedStrings) {
    expect(allLogCalls.some(call => call.includes(expected))).toBe(true);
  }
}

/**
 * Asserts that console.log output does NOT contain expected strings
 * @param unexpectedStrings - Array of strings that should NOT appear in console.log calls
 */
function expectConsoleLogNotContains(...unexpectedStrings: string[]): void {
  const allLogCalls = vi.mocked(console.log).mock.calls.map(call => call.join(' '));
  for (const unexpected of unexpectedStrings) {
    expect(allLogCalls.some(call => call.includes(unexpected))).toBe(false);
  }
}

/**
 * Setup mock validation state for testing
 * @param passed - Whether validation passed
 * @param timestamp - ISO timestamp string
 * @param treeHash - Git tree hash
 * @param failedStep - Optional failed step name (for failed validations)
 */
function setupMockValidationState(
  passed: boolean,
  timestamp: string,
  treeHash: string,
  failedStep?: string
): void {
  const mockResult = createMockValidationResult(passed, timestamp, treeHash, failedStep);
  const mockHistoryNote = createMockHistoryNote(treeHash, [
    {
      branch: 'main',
      timestamp,
      result: mockResult,
    },
  ]);

  vi.mocked(hasHistoryForTree).mockResolvedValue(true);
  vi.mocked(readHistoryNote).mockResolvedValue(mockHistoryNote);
}

describe('state command', () => {
  let env: CommanderTestEnv;
  const mockTreeHash = 'abc123def456' as TreeHash;

  beforeEach(() => {
    env = setupCommanderTest();
    setupHistoryMocks(mockTreeHash);
    vi.mocked(getAllRunCacheForTree).mockResolvedValue([]);
    vi.mocked(configLoader.findConfigPath).mockReturnValue(null);
  });

  afterEach(() => {
    env.cleanup();
    vi.restoreAllMocks();
  });

  describe('command registration', () => {
    it('should register state command with correct name', () => {
      stateCommand(env.program);

      const commands = env.program.commands;
      const stateCmd = commands.find(cmd => cmd.name() === 'state');

      expect(stateCmd).toBeDefined();
      expect(stateCmd?.description()).toBe('Show current validation state from git notes (or run cache if no config)');
    });

    it('should register --verbose option', () => {
      stateCommand(env.program);

      const stateCmd = env.program.commands.find(cmd => cmd.name() === 'state');
      const options = stateCmd?.options;

      expect(options?.some(opt => opt.flags === '-v, --verbose')).toBe(true);
    });
  });

  describe('no validation state', () => {
    it('should handle missing state with tree hash (minimal output)', async () => {
      vi.mocked(hasHistoryForTree).mockResolvedValue(false);

      stateCommand(env.program);
      await executeCommandAndGetExitCode(env.program,['state']);

      expectConsoleLogContains('exists: false', `treeHash: ${mockTreeHash}`);
    });

    it('should handle missing state with tree hash (verbose output)', async () => {
      vi.mocked(hasHistoryForTree).mockResolvedValue(false);

      stateCommand(env.program);
      await executeCommandAndGetExitCode(env.program,['state', '--verbose']);

      expectConsoleLogContains('exists: false', `treeHash: ${mockTreeHash}`, 'No validation or run cache found');
    });

    it('should handle empty history note with tree hash', async () => {
      const mockHistoryNote = createMockHistoryNote(mockTreeHash, []);
      vi.mocked(hasHistoryForTree).mockResolvedValue(true);
      vi.mocked(readHistoryNote).mockResolvedValue(mockHistoryNote);

      stateCommand(env.program);
      await executeCommandAndGetExitCode(env.program,['state']);

      expectConsoleLogContains('exists: false', `treeHash: ${mockTreeHash}`);
    });
  });

  describe('passed validation state', () => {
    beforeEach(() => {
      setupMockValidationState(true, '2025-10-16T12:00:00.000Z', mockTreeHash);
    });

    it('should display passed state (minimal output)', async () => {
      stateCommand(env.program);
      await executeCommandAndGetExitCode(env.program,['state']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('passed: true'));
    });

    it('should display passed state (verbose output)', async () => {
      stateCommand(env.program);
      await executeCommandAndGetExitCode(env.program,['state', '--verbose']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('PASSED'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Safe to commit'));
    });
  });

  describe('failed validation state', () => {
    beforeEach(() => {
      setupMockValidationState(false, '2025-10-16T12:00:00.000Z', mockTreeHash, 'TypeScript Type Check');
    });

    it('should display failed state (minimal output)', async () => {
      stateCommand(env.program);
      await executeCommandAndGetExitCode(env.program,['state']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('passed: false'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('TypeScript Type Check'));
    });

    it('should display failed state (verbose output)', async () => {
      stateCommand(env.program);
      await executeCommandAndGetExitCode(env.program,['state', '--verbose']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('TypeScript Type Check'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next Steps'));
    });

    it('should display long error output without truncation (verbose mode)', async () => {
      const mockResult = createMockValidationResult(false, '2025-10-16T12:00:00.000Z', mockTreeHash, 'Build');
      const mockHistoryNote = createMockHistoryNote(mockTreeHash, [
        {
          branch: 'main',
          timestamp: '2025-10-16T12:00:00.000Z',
          result: mockResult,
        },
      ]);

      vi.mocked(readHistoryNote).mockResolvedValue(mockHistoryNote);

      stateCommand(env.program);
      await executeCommandAndGetExitCode(env.program,['state', '--verbose']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Build'));
    });
  });

  describe('error handling', () => {
    it('should handle non-git repository with error message', async () => {
      vi.mocked(getGitTreeHash).mockRejectedValue(new Error('not a git repository'));

      stateCommand(env.program);
      const exitCode = await executeCommandAndGetExitCode(env.program,['state']);

      expect(exitCode).toBe(0);
      expectConsoleLogContains('exists: false', 'error: Not in git repository');
    });

    it('should handle non-git repository (verbose)', async () => {
      vi.mocked(getGitTreeHash).mockRejectedValue(new Error('not a git repository'));

      stateCommand(env.program);
      const exitCode = await executeCommandAndGetExitCode(env.program,['state', '--verbose']);

      expect(exitCode).toBe(0);
      expectConsoleLogContains('exists: false', 'error: Not in git repository', 'Not in a git repository');
    });

    it('should handle git errors', async () => {
      vi.mocked(getGitTreeHash).mockRejectedValue(new Error('some git error'));

      stateCommand(env.program);
      const exitCode = await executeCommandAndGetExitCode(env.program,['state']);

      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read validation state'),
        expect.anything()
      );
    });
  });

  describe('multiple runs', () => {
    it('should return most recent run', async () => {
      const olderResult = createMockValidationResult(false, '2025-10-16T10:00:00.000Z', mockTreeHash, 'Old failure');
      const newerResult = createMockValidationResult(true, '2025-10-16T12:00:00.000Z', mockTreeHash);

      const mockHistoryNote = createMockHistoryNote(mockTreeHash, [
        {
          branch: 'main',
          timestamp: '2025-10-16T10:00:00.000Z',
          result: olderResult,
        },
        {
          branch: 'main',
          timestamp: '2025-10-16T12:00:00.000Z',
          result: newerResult,
        },
      ]);

      vi.mocked(hasHistoryForTree).mockResolvedValue(true);
      vi.mocked(readHistoryNote).mockResolvedValue(mockHistoryNote);

      stateCommand(env.program);
      await executeCommandAndGetExitCode(env.program,['state']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('passed: true'));
      expectConsoleLogNotContains('Old failure');
    });
  });
});
