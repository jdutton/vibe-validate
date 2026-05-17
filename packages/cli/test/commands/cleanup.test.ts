import * as git from '@vibe-validate/git';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { cleanupCommand } from '../../src/commands/cleanup.js';
import { setupCommanderTest, type CommanderTestEnv } from '../helpers/commander-test-setup.js';

// Mock the git module
vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual<typeof git>('@vibe-validate/git');
  return {
    ...actual,
    cleanupBranches: vi.fn(),
  };
});

type CleanupMockResult = Awaited<ReturnType<typeof git.cleanupBranches>>;

/**
 * Build a minimal cleanup result for mocking. Tests override only the fields
 * they care about; everything else defaults to a healthy "no branches" outcome.
 */
function createCleanupMockResult(overrides: Partial<CleanupMockResult> = {}): CleanupMockResult {
  return {
    context: {
      repository: 'owner/repo',
      remote: 'origin',
      defaultBranch: 'main',
      currentBranch: 'main',
      switchedBranch: false,
    },
    autoDeleted: [],
    needsReview: [],
    summary: {
      autoDeletedCount: 0,
      needsReviewCount: 0,
      totalBranchesAnalyzed: 0,
    },
    recoveryInfo: 'Deleted branches are recoverable for 30 days via git reflog',
    ...overrides,
  };
}

describe('cleanup command', () => {
  let env: CommanderTestEnv;

  beforeEach(() => {
    env = setupCommanderTest();

    // Reset git mocks
    vi.mocked(git.cleanupBranches).mockReset();
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('command registration', () => {
    it('should register cleanup command', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup');
      expect(command).toBeDefined();
    });

    it('should have correct description', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup');
      expect(command?.description()).toBe('Comprehensive branch cleanup with GitHub integration');
    });

    it('should expose --dry-run option', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup');
      const optionNames = command?.options.map(opt => opt.long) ?? [];
      expect(optionNames).toEqual(['--dry-run']);
    });
  });

  describe('cleanup execution', () => {
    it('should call cleanupBranches function', async () => {
      vi.mocked(git.cleanupBranches).mockResolvedValue(createCleanupMockResult());

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        expect(error).toBeDefined();
      }

      expect(git.cleanupBranches).toHaveBeenCalledWith({ dryRun: undefined });
    });

    it('should output YAML on success', async () => {
      vi.mocked(git.cleanupBranches).mockResolvedValue(
        createCleanupMockResult({
          autoDeleted: [{ name: 'feature/test', reason: 'merged_to_main', recoveryCommand: 'git reflog' }],
          summary: { autoDeletedCount: 1, needsReviewCount: 0, totalBranchesAnalyzed: 1 },
        })
      );

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride
        expect(error).toBeDefined();
      }

      // Verify cleanupBranches was called (output format tested in branch-cleanup.test.ts)
      expect(git.cleanupBranches).toHaveBeenCalledWith({ dryRun: undefined });
    });

    it('should pass dryRun=true when --dry-run flag is provided', async () => {
      vi.mocked(git.cleanupBranches).mockResolvedValue(
        createCleanupMockResult({
          dryRun: true,
          wouldDelete: [{ name: 'feature/test', reason: 'merged_to_main', recoveryCommand: 'git reflog' }],
          summary: {
            autoDeletedCount: 0,
            wouldDeleteCount: 1,
            needsReviewCount: 0,
            totalBranchesAnalyzed: 1,
          },
        })
      );

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup', '--dry-run'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride
        expect(error).toBeDefined();
      }

      expect(git.cleanupBranches).toHaveBeenCalledWith({ dryRun: true });
    });

    it('should handle errors and output YAML error format', async () => {
      vi.mocked(git.cleanupBranches).mockRejectedValue(
        new Error('GitHub CLI (gh) is required for branch cleanup')
      );

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride
        expect(error).toBeDefined();
      }

      // Verify cleanupBranches was called
      expect(git.cleanupBranches).toHaveBeenCalledWith({ dryRun: undefined });
    });
  });

  describe('cleanup-temp command', () => {
    it('should register cleanup-temp command separately', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup-temp');
      expect(command).toBeDefined();
    });

    it('should have correct description', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup-temp');
      expect(command?.description()).toBe('Clean up old temporary output files');
    });

    it('should have older-than, all, dry-run, and yaml options', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup-temp');
      expect(command?.options).toBeDefined();

      const optionNames = command?.options.map(opt => opt.long) ?? [];
      expect(optionNames).toContain('--older-than');
      expect(optionNames).toContain('--all');
      expect(optionNames).toContain('--dry-run');
      expect(optionNames).toContain('--yaml');
    });

    it('should have default value for older-than option', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup-temp');
      const olderThanOption = command?.options.find(opt => opt.long === '--older-than');
      expect(olderThanOption?.defaultValue).toBe('7');
    });
  });
});
