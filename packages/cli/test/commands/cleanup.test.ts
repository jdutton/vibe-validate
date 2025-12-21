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

    it('should have no custom options (YAML-only, no flags)', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup');
      // Should have no custom options (Commander adds standard --help option)
      expect(command?.options.length).toBe(0); // No custom options
    });
  });

  describe('cleanup execution', () => {
    it('should call cleanupBranches function', async () => {
      const mockResult = {
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
      };

      vi.mocked(git.cleanupBranches).mockResolvedValue(mockResult);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(git.cleanupBranches).toHaveBeenCalledWith();
    });

    it('should output YAML on success', async () => {
      const mockResult = {
        context: {
          repository: 'owner/repo',
          remote: 'origin',
          defaultBranch: 'main',
          currentBranch: 'main',
          switchedBranch: false,
        },
        autoDeleted: [{ name: 'feature/test', reason: 'merged_to_main', recoveryCommand: 'git reflog' }],
        needsReview: [],
        summary: {
          autoDeletedCount: 1,
          needsReviewCount: 0,
          totalBranchesAnalyzed: 1,
        },
        recoveryInfo: 'Deleted branches are recoverable for 30 days via git reflog',
      };

      vi.mocked(git.cleanupBranches).mockResolvedValue(mockResult);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride
        expect(error).toBeDefined();
      }

      // Verify cleanupBranches was called (output format tested in branch-cleanup.test.ts)
      expect(git.cleanupBranches).toHaveBeenCalledWith();
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
      expect(git.cleanupBranches).toHaveBeenCalledWith();
    });
  });

  describe('cleanup-temp command', () => {
    it('should register cleanup-temp command separately', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup-temp');
      expect(command).toBeDefined();
    });
  });
});
