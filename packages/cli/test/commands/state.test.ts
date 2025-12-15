import type { ValidationResult } from '@vibe-validate/core';
import { getGitTreeHash } from '@vibe-validate/git';
import type { HistoryNote } from '@vibe-validate/history';
import { hasHistoryForTree, readHistoryNote } from '@vibe-validate/history';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { stateCommand } from '../../src/commands/state.js';
import { setupCommanderTest, type CommanderTestEnv } from '../helpers/commander-test-setup.js';


// Mock dependencies
vi.mock('@vibe-validate/git', () => ({
  getGitTreeHash: vi.fn(),
}));

vi.mock('@vibe-validate/history', () => ({
  hasHistoryForTree: vi.fn(),
  readHistoryNote: vi.fn(),
}));

describe('state command', () => {
  let env: CommanderTestEnv;
  const mockTreeHash = 'abc123def456';

  beforeEach(() => {
    env = setupCommanderTest();

    // Default mock implementations
    vi.mocked(getGitTreeHash).mockResolvedValue(mockTreeHash);
    vi.mocked(hasHistoryForTree).mockResolvedValue(false);
    vi.mocked(readHistoryNote).mockResolvedValue(null);
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

      try {
        await env.program.parseAsync(['state'], { from: 'user' });
      } catch (err: unknown) {
        // Commander throws when exitOverride is set
        // We expect exit code 0 for missing state
        if (err && typeof error === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

      // YAML output should include tree hash for debugging
      const allLogCalls = vi.mocked(console.log).mock.calls.map(call => call.join(' '));
      expect(allLogCalls.some(call => call.includes('exists: false'))).toBe(true);
      expect(allLogCalls.some(call => call.includes(`treeHash: ${mockTreeHash}`))).toBe(true);
    });

    it('should handle missing state with tree hash (verbose output)', async () => {
      vi.mocked(hasHistoryForTree).mockResolvedValue(false);

      stateCommand(env.program);

      try {
        await env.program.parseAsync(['state', '--verbose'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof error === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

      // Verbose output includes explanatory text AND tree hash
      const allLogCalls = vi.mocked(console.log).mock.calls.map(call => call.join(' '));
      expect(allLogCalls.some(call => call.includes('exists: false'))).toBe(true);
      expect(allLogCalls.some(call => call.includes(`treeHash: ${mockTreeHash}`))).toBe(true);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No validation or run cache found'));
    });

    it('should handle empty history note with tree hash', async () => {
      vi.mocked(hasHistoryForTree).mockResolvedValue(true);
      vi.mocked(readHistoryNote).mockResolvedValue({
        treeHash: mockTreeHash,
        runs: [],
      });

      stateCommand(env.program);

      try {
        await env.program.parseAsync(['state'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof error === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

      // Should include tree hash even when no runs
      const allLogCalls = vi.mocked(console.log).mock.calls.map(call => call.join(' '));
      expect(allLogCalls.some(call => call.includes('exists: false'))).toBe(true);
      expect(allLogCalls.some(call => call.includes(`treeHash: ${mockTreeHash}`))).toBe(true);
    });
  });

  describe('passed validation state', () => {
    beforeEach(() => {
      const mockResult: ValidationResult = {
        passed: true,
        timestamp: '2025-10-16T12:00:00.000Z',
        treeHash: mockTreeHash,
        phases: [],
      };

      const mockHistoryNote: HistoryNote = {
        treeHash: mockTreeHash,
        runs: [
          {
            branch: 'main',
            timestamp: '2025-10-16T12:00:00.000Z',
            result: mockResult,
          },
        ],
      };

      vi.mocked(hasHistoryForTree).mockResolvedValue(true);
      vi.mocked(readHistoryNote).mockResolvedValue(mockHistoryNote);
    });

    it('should display passed state (minimal output)', async () => {
      stateCommand(env.program);

      try {
        await env.program.parseAsync(['state'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof error === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

      // Minimal YAML output
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('passed: true'));
    });

    it('should display passed state (verbose output)', async () => {
      stateCommand(env.program);

      try {
        await env.program.parseAsync(['state', '--verbose'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof error === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

      // Verbose output includes status indicator and explanatory text
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('PASSED'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Safe to commit'));
    });
  });

  describe('failed validation state', () => {
    beforeEach(() => {
      const mockResult: ValidationResult = {
        passed: false,
        timestamp: '2025-10-16T12:00:00.000Z',
        treeHash: mockTreeHash,
        failedStep: 'TypeScript Type Check',
        phases: [],
      };

      const mockHistoryNote: HistoryNote = {
        treeHash: mockTreeHash,
        runs: [
          {
            branch: 'main',
            timestamp: '2025-10-16T12:00:00.000Z',
            result: mockResult,
          },
        ],
      };

      vi.mocked(hasHistoryForTree).mockResolvedValue(true);
      vi.mocked(readHistoryNote).mockResolvedValue(mockHistoryNote);
    });

    it('should display failed state (minimal output)', async () => {
      stateCommand(env.program);

      try {
        await env.program.parseAsync(['state'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof error === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

      // Minimal YAML output
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('passed: false'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('TypeScript Type Check'));
    });

    it('should display failed state (verbose output)', async () => {
      stateCommand(env.program);

      try {
        await env.program.parseAsync(['state', '--verbose'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof error === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

      // Verbose output includes status indicator and explanatory text
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('TypeScript Type Check'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next Steps'));
    });

    it('should display long error output without truncation (verbose mode)', async () => {
      const mockResult: ValidationResult = {
        passed: false,
        timestamp: '2025-10-16T12:00:00.000Z',
        treeHash: mockTreeHash,
        failedStep: 'Build',
        phases: [],
      };

      const mockHistoryNote: HistoryNote = {
        treeHash: mockTreeHash,
        runs: [
          {
            branch: 'main',
            timestamp: '2025-10-16T12:00:00.000Z',
            result: mockResult,
          },
        ],
      };

      vi.mocked(readHistoryNote).mockResolvedValue(mockHistoryNote);

      stateCommand(env.program);

      try {
        await env.program.parseAsync(['state', '--verbose'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof error === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

      // Verbose mode shows full output (no truncation)
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Build'));
    });
  });

  describe('error handling', () => {
    it('should handle non-git repository with error message', async () => {
      vi.mocked(getGitTreeHash).mockRejectedValue(new Error('not a git repository'));

      stateCommand(env.program);

      try {
        await env.program.parseAsync(['state'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof error === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

      // Should include structured error message
      const allLogCalls = vi.mocked(console.log).mock.calls.map(call => call.join(' '));
      expect(allLogCalls.some(call => call.includes('exists: false'))).toBe(true);
      expect(allLogCalls.some(call => call.includes('error: Not in git repository'))).toBe(true);
    });

    it('should handle non-git repository (verbose)', async () => {
      vi.mocked(getGitTreeHash).mockRejectedValue(new Error('not a git repository'));

      stateCommand(env.program);

      try {
        await env.program.parseAsync(['state', '--verbose'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof error === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

      // Should include structured error + explanatory text
      const allLogCalls = vi.mocked(console.log).mock.calls.map(call => call.join(' '));
      expect(allLogCalls.some(call => call.includes('exists: false'))).toBe(true);
      expect(allLogCalls.some(call => call.includes('error: Not in git repository'))).toBe(true);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Not in a git repository'));
    });

    it('should handle git errors', async () => {
      vi.mocked(getGitTreeHash).mockRejectedValue(new Error('some git error'));

      stateCommand(env.program);

      try {
        await env.program.parseAsync(['state'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof error === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(1);
        }
      }

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read validation state'),
        expect.anything()
      );
    });
  });

  describe('multiple runs', () => {
    it('should return most recent run', async () => {
      const olderResult: ValidationResult = {
        passed: false,
        timestamp: '2025-10-16T10:00:00.000Z',
        treeHash: mockTreeHash,
        failedStep: 'Old failure',
        phases: [],
      };

      const newerResult: ValidationResult = {
        passed: true,
        timestamp: '2025-10-16T12:00:00.000Z',
        treeHash: mockTreeHash,
        phases: [],
      };

      const mockHistoryNote: HistoryNote = {
        treeHash: mockTreeHash,
        runs: [
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
        ],
      };

      vi.mocked(hasHistoryForTree).mockResolvedValue(true);
      vi.mocked(readHistoryNote).mockResolvedValue(mockHistoryNote);

      stateCommand(env.program);

      try {
        await env.program.parseAsync(['state'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof error === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

      // Should show the newer result (passed: true)
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('passed: true'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Old failure'));
    });
  });
});
