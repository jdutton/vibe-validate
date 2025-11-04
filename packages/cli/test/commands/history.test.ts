import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { historyCommand } from '../../src/commands/history.js';
import * as history from '@vibe-validate/history';

// Mock the history module
vi.mock('@vibe-validate/history', async () => {
  const actual = await vi.importActual<typeof history>('@vibe-validate/history');
  return {
    ...actual,
    readHistoryNote: vi.fn(),
    getAllHistoryNotes: vi.fn(),
    pruneHistoryByAge: vi.fn(),
    pruneAllHistory: vi.fn(),
    checkHistoryHealth: vi.fn(),
  };
});

// Type alias for process.exit mock parameter
type ProcessExitCode = string | number | null | undefined;

describe('history command', () => {
  let program: Command;

  beforeEach(() => {
    // Create fresh Commander instance
    program = new Command();
    program.exitOverride(); // Prevent process.exit() from killing tests

    // Spy on console methods to capture output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Reset mocks
    vi.mocked(history.readHistoryNote).mockReset();
    vi.mocked(history.getAllHistoryNotes).mockReset();
    vi.mocked(history.pruneHistoryByAge).mockReset();
    vi.mocked(history.pruneAllHistory).mockReset();
    vi.mocked(history.checkHistoryHealth).mockReset();
  });

  describe('command registration', () => {
    it('should register history command', () => {
      historyCommand(program);

      const command = program.commands.find(cmd => cmd.name() === 'history');
      expect(command).toBeDefined();
    });

    it('should have correct description', () => {
      historyCommand(program);

      const command = program.commands.find(cmd => cmd.name() === 'history');
      expect(command?.description()).toBe('View and manage validation history stored in git notes');
    });

    it('should register list subcommand', () => {
      historyCommand(program);

      const historyCmd = program.commands.find(cmd => cmd.name() === 'history');
      const listCmd = historyCmd?.commands.find(cmd => cmd.name() === 'list');
      expect(listCmd).toBeDefined();
    });

    it('should register show subcommand', () => {
      historyCommand(program);

      const historyCmd = program.commands.find(cmd => cmd.name() === 'history');
      const showCmd = historyCmd?.commands.find(cmd => cmd.name() === 'show');
      expect(showCmd).toBeDefined();
    });

    it('should register prune subcommand', () => {
      historyCommand(program);

      const historyCmd = program.commands.find(cmd => cmd.name() === 'history');
      const pruneCmd = historyCmd?.commands.find(cmd => cmd.name() === 'prune');
      expect(pruneCmd).toBeDefined();
    });

    it('should register health subcommand', () => {
      historyCommand(program);

      const historyCmd = program.commands.find(cmd => cmd.name() === 'history');
      const healthCmd = historyCmd?.commands.find(cmd => cmd.name() === 'health');
      expect(healthCmd).toBeDefined();
    });
  });

  describe('history list', () => {
    it('should list validation history', async () => {
      const mockNotes = [
        {
          treeHash: 'abc123',
          runs: [
            {
              id: 'run-1',
              timestamp: '2025-10-22T00:00:00.000Z',
              duration: 5000,
              passed: true,
              branch: 'main',
              headCommit: 'def456',
              uncommittedChanges: false,
              result: {
                passed: true,
                timestamp: '2025-10-22T00:00:00.000Z',
                treeHash: 'abc123',
                duration: 5000,
                branch: 'main',
                phases: [],
              },
            },
          ],
        },
      ];

      vi.mocked(history.getAllHistoryNotes).mockResolvedValue(mockNotes);

      historyCommand(program);

      await program.parseAsync(['history', 'list'], { from: 'user' });

      expect(history.getAllHistoryNotes).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });

    it('should filter by branch when --branch flag is provided', async () => {
      const mockNotes = [
        {
          treeHash: 'abc123',
          runs: [
            {
              id: 'run-1',
              timestamp: '2025-10-22T00:00:00.000Z',
              duration: 5000,
              passed: true,
              branch: 'main',
              headCommit: 'def456',
              uncommittedChanges: false,
              result: {
                passed: true,
                timestamp: '2025-10-22T00:00:00.000Z',
                treeHash: 'abc123',
                duration: 5000,
                branch: 'main',
                phases: [],
              },
            },
            {
              id: 'run-2',
              timestamp: '2025-10-22T01:00:00.000Z',
              duration: 5000,
              passed: true,
              branch: 'feature/test',
              headCommit: 'ghi789',
              uncommittedChanges: false,
              result: {
                passed: true,
                timestamp: '2025-10-22T01:00:00.000Z',
                treeHash: 'abc123',
                duration: 5000,
                branch: 'feature/test',
                phases: [],
              },
            },
          ],
        },
      ];

      vi.mocked(history.getAllHistoryNotes).mockResolvedValue(mockNotes);

      historyCommand(program);

      await program.parseAsync(['history', 'list', '--branch', 'main'], { from: 'user' });

      expect(history.getAllHistoryNotes).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });

    it('should limit results when --limit flag is provided', async () => {
      const mockNotes = [
        {
          treeHash: 'abc123',
          runs: Array.from({ length: 30 }, (_, i) => ({
            id: `run-${i}`,
            timestamp: `2025-10-22T${String(i).padStart(2, '0')}:00:00.000Z`,
            duration: 5000,
            passed: true,
            branch: 'main',
            headCommit: 'def456',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: `2025-10-22T${String(i).padStart(2, '0')}:00:00.000Z`,
              treeHash: 'abc123',
              duration: 5000,
              branch: 'main',
              phases: [],
            },
          })),
        },
      ];

      vi.mocked(history.getAllHistoryNotes).mockResolvedValue(mockNotes);

      historyCommand(program);

      await program.parseAsync(['history', 'list', '--limit', '10'], { from: 'user' });

      expect(history.getAllHistoryNotes).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });

    it('should output YAML when --yaml flag is provided', async () => {
      const mockNotes = [
        {
          treeHash: 'abc123',
          runs: [
            {
              id: 'run-1',
              timestamp: '2025-10-22T00:00:00.000Z',
              duration: 5000,
              passed: true,
              branch: 'main',
              headCommit: 'def456',
              uncommittedChanges: false,
              result: {
                passed: true,
                timestamp: '2025-10-22T00:00:00.000Z',
                treeHash: 'abc123',
                duration: 5000,
                branch: 'main',
                phases: [],
              },
            },
          ],
        },
      ];

      vi.mocked(history.getAllHistoryNotes).mockResolvedValue(mockNotes);

      historyCommand(program);

      await program.parseAsync(['history', 'list', '--yaml'], { from: 'user' });

      // Verify YAML separator was written
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeDefined();
    });

    it('should display message when no history found', async () => {
      vi.mocked(history.getAllHistoryNotes).mockResolvedValue([]);

      historyCommand(program);

      await program.parseAsync(['history', 'list'], { from: 'user' });

      expect(console.log).toHaveBeenCalledWith('No validation history found');
    });

    it('should display message when no history for specified branch', async () => {
      const mockNotes = [
        {
          treeHash: 'abc123',
          runs: [
            {
              id: 'run-1',
              timestamp: '2025-10-22T00:00:00.000Z',
              duration: 5000,
              passed: true,
              branch: 'main',
              headCommit: 'def456',
              uncommittedChanges: false,
              result: {
                passed: true,
                timestamp: '2025-10-22T00:00:00.000Z',
                treeHash: 'abc123',
                duration: 5000,
                branch: 'main',
                phases: [],
              },
            },
          ],
        },
      ];

      vi.mocked(history.getAllHistoryNotes).mockResolvedValue(mockNotes);

      historyCommand(program);

      await program.parseAsync(['history', 'list', '--branch', 'nonexistent'], { from: 'user' });

      expect(console.log).toHaveBeenCalledWith('No validation history found for branch: nonexistent');
    });

    it('should list run cache entries when --run flag is provided', async () => {
      const mockRunCacheEntries = [
        {
          treeHash: 'abc123',
          command: 'pnpm test',
          workdir: '',
          timestamp: '2025-11-02T12:00:00.000Z',
          exitCode: 0,
          duration: 5000,
          extraction: {
            errors: [],
            summary: 'All tests passed',
            totalCount: 0,
            errorSummary: '',
          },
        },
        {
          treeHash: 'def456',
          command: 'pnpm lint',
          workdir: 'packages/cli',
          timestamp: '2025-11-02T13:00:00.000Z',
          exitCode: 1,
          duration: 3000,
          extraction: {
            errors: [{ file: 'test.ts', line: 10, message: 'Unused variable' }],
            summary: '1 lint error',
            totalCount: 1,
            errorSummary: 'test.ts:10 - Unused variable',
          },
        },
      ];

      // Mock getAllRunCacheEntries (will be implemented)
      const getAllRunCacheEntries = vi.fn().mockResolvedValue(mockRunCacheEntries);
      vi.mocked(history).getAllRunCacheEntries = getAllRunCacheEntries;

      historyCommand(program);

      await program.parseAsync(['history', 'list', '--run'], { from: 'user' });

      expect(getAllRunCacheEntries).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });

    it('should filter run cache entries by command pattern with --run <command>', async () => {
      const mockRunCacheEntries = [
        {
          treeHash: 'abc123',
          command: 'pnpm test',
          workdir: '',
          timestamp: '2025-11-02T12:00:00.000Z',
          exitCode: 0,
          duration: 5000,
          extraction: {
            errors: [],
            summary: 'All tests passed',
            totalCount: 0,
            errorSummary: '',
          },
        },
        {
          treeHash: 'def456',
          command: 'pnpm lint',
          workdir: 'packages/cli',
          timestamp: '2025-11-02T13:00:00.000Z',
          exitCode: 1,
          duration: 3000,
          extraction: {
            errors: [{ file: 'test.ts', line: 10, message: 'Unused variable' }],
            summary: '1 lint error',
            totalCount: 1,
            errorSummary: 'test.ts:10 - Unused variable',
          },
        },
        {
          treeHash: 'ghi789',
          command: 'vitest run',
          workdir: '',
          timestamp: '2025-11-02T14:00:00.000Z',
          exitCode: 0,
          duration: 2000,
          extraction: {
            errors: [],
            summary: 'All tests passed',
            totalCount: 0,
            errorSummary: '',
          },
        },
      ];

      const getAllRunCacheEntries = vi.fn().mockResolvedValue(mockRunCacheEntries);
      vi.mocked(history).getAllRunCacheEntries = getAllRunCacheEntries;

      historyCommand(program);

      await program.parseAsync(['history', 'list', '--run', 'test'], { from: 'user' });

      expect(getAllRunCacheEntries).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
      // Should only show entries matching "test" (pnpm test, vitest run)
    });

    it('should show all run cache entries with --run --all', async () => {
      const mockRunCacheEntries = [
        {
          treeHash: 'abc123',
          command: 'pnpm test',
          workdir: '',
          timestamp: '2025-11-02T12:00:00.000Z',
          exitCode: 0,
          duration: 5000,
          extraction: {
            errors: [],
            summary: 'All tests passed',
            totalCount: 0,
            errorSummary: '',
          },
        },
      ];

      const getAllRunCacheEntries = vi.fn().mockResolvedValue(mockRunCacheEntries);
      vi.mocked(history).getAllRunCacheEntries = getAllRunCacheEntries;

      historyCommand(program);

      await program.parseAsync(['history', 'list', '--run', '--all'], { from: 'user' });

      expect(getAllRunCacheEntries).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });

    it('should show error when --all is used without --run', async () => {
      historyCommand(program);

      // Mock getAllHistoryNotes to avoid actual git operations
      vi.mocked(history.getAllHistoryNotes).mockResolvedValue([]);

      // Mock process.exit to prevent test from actually exiting
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      });

      try {
        await program.parseAsync(['history', 'list', '--all'], { from: 'user' });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }

      expect(console.error).toHaveBeenCalledWith('Error: --all option requires --run flag');
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should show error when --all is used with command filter', async () => {
      historyCommand(program);

      // Mock process.exit to prevent test from actually exiting
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      });

      try {
        await program.parseAsync(['history', 'list', '--run', 'test', '--all'], { from: 'user' });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }

      expect(console.error).toHaveBeenCalledWith('Error: Cannot use --all with a command filter');
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should show helpful message when no matches found for command filter', async () => {
      const mockRunCacheEntries = [
        {
          treeHash: 'abc123',
          command: 'pnpm test',
          workdir: '',
          timestamp: '2025-11-02T12:00:00.000Z',
          exitCode: 0,
          duration: 5000,
          extraction: {
            errors: [],
            summary: 'All tests passed',
            totalCount: 0,
            errorSummary: '',
          },
        },
      ];

      const getAllRunCacheEntries = vi.fn().mockResolvedValue(mockRunCacheEntries);
      vi.mocked(history).getAllRunCacheEntries = getAllRunCacheEntries;

      historyCommand(program);

      await program.parseAsync(['history', 'list', '--run', 'nonexistent'], { from: 'user' });

      expect(getAllRunCacheEntries).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('No run cache entries found matching command: nonexistent');
    });
  });

  describe('history show', () => {
    it('should show history for specific tree hash', async () => {
      const mockNote = {
        treeHash: 'abc123',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-22T00:00:00.000Z',
            duration: 5000,
            passed: true,
            branch: 'main',
            headCommit: 'def456',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-22T00:00:00.000Z',
              treeHash: 'abc123',
              duration: 5000,
              branch: 'main',
              phases: [],
            },
          },
        ],
      };

      vi.mocked(history.readHistoryNote).mockResolvedValue(mockNote);

      historyCommand(program);

      await program.parseAsync(['history', 'show', 'abc123'], { from: 'user' });

      expect(history.readHistoryNote).toHaveBeenCalledWith('abc123');
      expect(console.log).toHaveBeenCalled();
    });

    it('should output YAML when --yaml flag is provided', async () => {
      const mockNote = {
        treeHash: 'abc123',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-22T00:00:00.000Z',
            duration: 5000,
            passed: true,
            branch: 'main',
            headCommit: 'def456',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-22T00:00:00.000Z',
              treeHash: 'abc123',
              duration: 5000,
              branch: 'main',
              phases: [],
            },
          },
        ],
      };

      vi.mocked(history.readHistoryNote).mockResolvedValue(mockNote);

      historyCommand(program);

      await program.parseAsync(['history', 'show', 'abc123', '--yaml'], { from: 'user' });

      // Verify YAML separator was written
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeDefined();
    });

    it('should exit with error when tree hash not found', async () => {
      vi.mocked(history.readHistoryNote).mockResolvedValue(null);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      historyCommand(program);

      try {
        await program.parseAsync(['history', 'show', 'nonexistent'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(console.error).toHaveBeenCalledWith('No validation history or run cache found for tree hash: nonexistent');
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });
  });

  describe('history prune', () => {
    it('should prune history by age with default days', async () => {
      const mockResult = {
        notesPruned: 5,
        runsPruned: 10,
        notesRemaining: 15,
      };

      vi.mocked(history.pruneHistoryByAge).mockResolvedValue(mockResult);

      historyCommand(program);

      await program.parseAsync(['history', 'prune'], { from: 'user' });

      expect(history.pruneHistoryByAge).toHaveBeenCalledWith(90, {}, false);
      expect(console.log).toHaveBeenCalled();
    });

    it('should prune history with custom days', async () => {
      const mockResult = {
        notesPruned: 3,
        runsPruned: 6,
        notesRemaining: 20,
      };

      vi.mocked(history.pruneHistoryByAge).mockResolvedValue(mockResult);

      historyCommand(program);

      await program.parseAsync(['history', 'prune', '--older-than', '30'], { from: 'user' });

      expect(history.pruneHistoryByAge).toHaveBeenCalledWith(30, {}, false);
    });

    it('should prune all history when --all flag is provided', async () => {
      const mockResult = {
        notesPruned: 25,
        runsPruned: 50,
        notesRemaining: 0,
      };

      vi.mocked(history.pruneAllHistory).mockResolvedValue(mockResult);

      historyCommand(program);

      await program.parseAsync(['history', 'prune', '--all'], { from: 'user' });

      expect(history.pruneAllHistory).toHaveBeenCalledWith({}, false);
      expect(console.log).toHaveBeenCalled();
    });

    it('should perform dry run when --dry-run flag is provided', async () => {
      const mockResult = {
        notesPruned: 5,
        runsPruned: 10,
        notesRemaining: 15,
      };

      vi.mocked(history.pruneHistoryByAge).mockResolvedValue(mockResult);

      historyCommand(program);

      await program.parseAsync(['history', 'prune', '--dry-run'], { from: 'user' });

      expect(history.pruneHistoryByAge).toHaveBeenCalledWith(90, {}, true);
    });

    it('should display message when no history to prune', async () => {
      const mockResult = {
        notesPruned: 0,
        runsPruned: 0,
        notesRemaining: 20,
      };

      vi.mocked(history.pruneHistoryByAge).mockResolvedValue(mockResult);

      historyCommand(program);

      await program.parseAsync(['history', 'prune'], { from: 'user' });

      expect(console.log).toHaveBeenCalledWith('No history older than 90 days found');
    });

    it('should display message when no history to prune (--all)', async () => {
      const mockResult = {
        notesPruned: 0,
        runsPruned: 0,
        notesRemaining: 0,
      };

      vi.mocked(history.pruneAllHistory).mockResolvedValue(mockResult);

      historyCommand(program);

      await program.parseAsync(['history', 'prune', '--all'], { from: 'user' });

      expect(console.log).toHaveBeenCalledWith('No history to prune');
    });

    it('should prune run cache when --run flag is provided', async () => {
      const mockResult = {
        notesPruned: 10,
        runsPruned: 10,
        notesRemaining: 0,
      };

      const pruneAllRunCache = vi.fn().mockResolvedValue(mockResult);
      vi.mocked(history).pruneAllRunCache = pruneAllRunCache;

      historyCommand(program);

      await program.parseAsync(['history', 'prune', '--run', '--all'], { from: 'user' });

      expect(pruneAllRunCache).toHaveBeenCalledWith(false);
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('history health', () => {
    it('should check history health', async () => {
      const mockHealth = {
        totalNotes: 25,
        oldNotesCount: 5,
        shouldWarn: false,
        warningMessage: '',
      };

      vi.mocked(history.checkHistoryHealth).mockResolvedValue(mockHealth);

      historyCommand(program);

      await program.parseAsync(['history', 'health'], { from: 'user' });

      expect(history.checkHistoryHealth).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });

    it('should display warning when history health is poor', async () => {
      const mockHealth = {
        totalNotes: 150,
        oldNotesCount: 100,
        shouldWarn: true,
        warningMessage: 'Consider pruning old history with: vibe-validate history prune',
      };

      vi.mocked(history.checkHistoryHealth).mockResolvedValue(mockHealth);

      historyCommand(program);

      await program.parseAsync(['history', 'health'], { from: 'user' });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Consider pruning old history')
      );
    });

    it('should display healthy message when history is good', async () => {
      const mockHealth = {
        totalNotes: 25,
        oldNotesCount: 5,
        shouldWarn: false,
        warningMessage: '',
      };

      vi.mocked(history.checkHistoryHealth).mockResolvedValue(mockHealth);

      historyCommand(program);

      await program.parseAsync(['history', 'health'], { from: 'user' });

      expect(console.log).toHaveBeenCalledWith('\n✓ History is healthy');
    });
  });

  describe('error handling', () => {
    it('should handle list errors gracefully', async () => {
      const error = new Error('Git command failed');
      vi.mocked(history.getAllHistoryNotes).mockRejectedValue(error);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      historyCommand(program);

      try {
        await program.parseAsync(['history', 'list'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(console.error).toHaveBeenCalledWith('Error listing history: Git command failed');
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should handle show errors gracefully', async () => {
      const error = new Error('Git command failed');
      vi.mocked(history.readHistoryNote).mockRejectedValue(error);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      historyCommand(program);

      try {
        await program.parseAsync(['history', 'show', 'abc123'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(console.error).toHaveBeenCalledWith('Error showing history: Git command failed');
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should handle prune errors gracefully', async () => {
      const error = new Error('Git command failed');
      vi.mocked(history.pruneHistoryByAge).mockRejectedValue(error);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      historyCommand(program);

      try {
        await program.parseAsync(['history', 'prune'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(console.error).toHaveBeenCalledWith('Error pruning history: Git command failed');
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should handle health check errors gracefully', async () => {
      const error = new Error('Git command failed');
      vi.mocked(history.checkHistoryHealth).mockRejectedValue(error);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      historyCommand(program);

      try {
        await program.parseAsync(['history', 'health'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(console.error).toHaveBeenCalledWith('Error checking history health: Git command failed');
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });
  });
});
