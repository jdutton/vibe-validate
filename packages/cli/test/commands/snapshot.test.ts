import { getGitTreeHash } from '@vibe-validate/git';
import type { HistoryNote } from '@vibe-validate/history';
import { hasHistoryForTree, readHistoryNote } from '@vibe-validate/history';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { snapshotCommand } from '../../src/commands/snapshot.js';
import { setupCommanderTest, type CommanderTestEnv } from '../helpers/commander-test-setup.js';


// Mock dependencies
vi.mock('@vibe-validate/git', () => ({
  getGitTreeHash: vi.fn(),
}));

vi.mock('@vibe-validate/history', () => ({
  hasHistoryForTree: vi.fn(),
  readHistoryNote: vi.fn(),
}));

// Helper to get all console.log output as strings
function getLogOutput(): string[] {
  return vi.mocked(console.log).mock.calls.map(call => call.join(' '));
}

// Helper to create mock history note
function createMockHistory(passed: boolean): HistoryNote {
  return {
    runs: [
      {
        result: {
          passed,
          timestamp: '2025-12-05T10:30:15.000Z',
          treeHash: 'abc123def456789012345678901234567890abcd',
          summary: passed ? 'Validation passed' : 'Validation failed',
          phases: [],
        },
      },
    ],
  };
}

describe('snapshot command', () => {
  let env: CommanderTestEnv;
  const mockTreeHash = 'abc123def456789012345678901234567890abcd';
  const mockTreeHashResult = {
    hash: mockTreeHash
  };

  // Helper to run snapshot command and extract exit code
  async function runSnapshotCommand(args: string[] = ['snapshot']): Promise<number> {
    try {
      await env.program.parseAsync(args, { from: 'user' });
      return 0;
    } catch (err: unknown) {
      // Extract exit code from process.exit mock error
      if (err instanceof Error && err.message.startsWith('process.exit')) {
        const match = /process\.exit\((\d+)\)/.exec(err.message);
        return match ? Number.parseInt(match[1], 10) : 1;
      }
      if (err && typeof err === 'object' && 'exitCode' in err) {
        return (err as { exitCode: number }).exitCode;
      }
      throw err;
    }
  }

  beforeEach(() => {
    env = setupCommanderTest();

    // Default mock implementations
    vi.mocked(getGitTreeHash).mockResolvedValue(mockTreeHashResult);
    vi.mocked(hasHistoryForTree).mockResolvedValue(false);
    vi.mocked(readHistoryNote).mockResolvedValue(null);
  });

  afterEach(() => {
    env.cleanup();
    vi.restoreAllMocks();
  });

  describe('command registration', () => {
    it('should register snapshot command with correct name', () => {
      snapshotCommand(env.program);

      const commands = env.program.commands;
      const snapshotCmd = commands.find(cmd => cmd.name() === 'snapshot');

      expect(snapshotCmd).toBeDefined();
      expect(snapshotCmd?.description()).toBe('Show current worktree snapshot and recovery instructions');
    });

    it('should register --verbose option', () => {
      snapshotCommand(env.program);

      const snapshotCmd = env.program.commands.find(cmd => cmd.name() === 'snapshot');
      const options = snapshotCmd?.options;

      expect(options?.some(opt => opt.flags === '-v, --verbose')).toBe(true);
    });
  });

  describe('snapshot display', () => {
    it('should display snapshot hash', async () => {
      snapshotCommand(env.program);
      const exitCode = await runSnapshotCommand();
      expect(exitCode).toBe(0);
      expect(getLogOutput().some(call => call.includes(mockTreeHash))).toBe(true);
    });

    it('should show "Validation Status: Not yet validated" when no history', async () => {
      snapshotCommand(env.program);
      const exitCode = await runSnapshotCommand();
      expect(exitCode).toBe(0);
      expect(getLogOutput().some(call => call.includes('Validation Status:') && call.includes('Not yet validated'))).toBe(true);
    });

    it('should show recovery instructions', async () => {
      snapshotCommand(env.program);
      const exitCode = await runSnapshotCommand();
      expect(exitCode).toBe(0);

      const output = getLogOutput();
      expect(output.some(call => call.includes('Recovery Instructions'))).toBe(true);
      expect(output.some(call => call.includes('git ls-tree'))).toBe(true);
      expect(output.some(call => call.includes('git show'))).toBe(true);
      expect(output.some(call => call.includes('git read-tree'))).toBe(true);
    });
  });

  describe('validation status display', () => {
    it('should show "Validation Status: ✅ Passed" when validation passed', async () => {
      vi.mocked(hasHistoryForTree).mockResolvedValue(true);
      vi.mocked(readHistoryNote).mockResolvedValue(createMockHistory(true));

      snapshotCommand(env.program);
      const exitCode = await runSnapshotCommand();
      expect(exitCode).toBe(0);

      const output = getLogOutput();
      expect(output.some(call => call.includes('Validation Status:') && call.includes('Passed'))).toBe(true);
      expect(output.some(call => call.includes('Last validated:'))).toBe(true);
    });

    it('should show "Validation Status: ❌ Failed" and suggest running state when validation failed', async () => {
      vi.mocked(hasHistoryForTree).mockResolvedValue(true);
      vi.mocked(readHistoryNote).mockResolvedValue(createMockHistory(false));

      snapshotCommand(env.program);
      const exitCode = await runSnapshotCommand();
      expect(exitCode).toBe(0);

      const output = getLogOutput();
      expect(output.some(call => call.includes('Validation Status:') && call.includes('Failed'))).toBe(true);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('state'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('detailed error information'));
    });

    it('should use program name in state suggestion', async () => {
      vi.mocked(hasHistoryForTree).mockResolvedValue(true);
      vi.mocked(readHistoryNote).mockResolvedValue(createMockHistory(false));

      env.program.name('vv');
      snapshotCommand(env.program);
      const exitCode = await runSnapshotCommand();
      expect(exitCode).toBe(0);
      expect(getLogOutput().some(call => call.includes("'vv state'"))).toBe(true);
    });
  });

  describe('verbose mode', () => {
    it('should show additional information in verbose mode', async () => {
      snapshotCommand(env.program);
      const exitCode = await runSnapshotCommand(['snapshot', '--verbose']);
      expect(exitCode).toBe(0);

      const output = getLogOutput();
      expect(output.some(call => call.includes('Additional Information'))).toBe(true);
      expect(output.some(call => call.includes('What is a snapshot?'))).toBe(true);
      expect(output.some(call => call.includes('When are snapshots created?'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle getGitTreeHash errors gracefully', async () => {
      vi.mocked(getGitTreeHash).mockRejectedValue(new Error('Git tree hash failed'));
      snapshotCommand(env.program);

      const exitCode = await runSnapshotCommand();
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get snapshot'),
        expect.any(Error)
      );
    });

    it('should handle readHistoryNote errors gracefully', async () => {
      vi.mocked(hasHistoryForTree).mockResolvedValue(true);
      vi.mocked(readHistoryNote).mockRejectedValue(new Error('Failed to read history'));
      snapshotCommand(env.program);

      const exitCode = await runSnapshotCommand();
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get snapshot'),
        expect.any(Error)
      );
    });
  });

  describe('exit codes', () => {
    it('should exit with code 0 on success', async () => {
      snapshotCommand(env.program);
      const exitCode = await runSnapshotCommand();
      expect(exitCode).toBe(0);
    });

    it('should exit with code 1 on error', async () => {
      vi.mocked(getGitTreeHash).mockRejectedValue(new Error('Git tree hash failed'));
      snapshotCommand(env.program);

      const exitCode = await runSnapshotCommand();
      expect(exitCode).toBe(1);
    });
  });
});
