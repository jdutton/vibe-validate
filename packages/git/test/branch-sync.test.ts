/**
 * Tests for BranchSyncChecker
 *
 * Tests the safe branch sync checking functionality that never auto-merges.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BranchSyncChecker, checkBranchSync, type SyncCheckResult, type ExecAsyncFunction } from '../src/branch-sync.js';

describe('BranchSyncChecker', () => {
  let mockExecAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecAsync = vi.fn();
  });

  describe('checkSync', () => {
    it('should return up-to-date status when branch is synced', async () => {
      // Mock git commands to return promises
      mockExecAsync
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })  // git rev-parse --abbrev-ref HEAD
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })         // git rev-parse --verify origin/main
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // git fetch
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' });             // git rev-list --count

      const checker = new BranchSyncChecker({ execAsync: mockExecAsync as ExecAsyncFunction });
      const result = await checker.checkSync();

      expect(result.isUpToDate).toBe(true);
      expect(result.behindBy).toBe(0);
      expect(result.currentBranch).toBe('feature/test');
      expect(result.hasRemote).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return behind status when branch needs merge', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '5\n', stderr: '' });  // 5 commits behind

      const checker = new BranchSyncChecker({ execAsync: mockExecAsync as ExecAsyncFunction });
      const result = await checker.checkSync();

      expect(result.isUpToDate).toBe(false);
      expect(result.behindBy).toBe(5);
      expect(result.currentBranch).toBe('feature/test');
      expect(result.hasRemote).toBe(true);
    });

    it('should handle missing remote branch gracefully', async () => {
      const checker = new BranchSyncChecker({ execAsync: mockExecAsync as ExecAsyncFunction });

      mockExecAsync
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockRejectedValueOnce(new Error('fatal: Needed a single revision'));  // Remote branch doesn't exist

      const result = await checker.checkSync();

      expect(result.isUpToDate).toBe(true);
      expect(result.behindBy).toBe(0);
      expect(result.hasRemote).toBe(false);
      expect(result.error).toContain('No remote branch');
    });

    it('should handle git errors gracefully', async () => {
      const checker = new BranchSyncChecker({ execAsync: mockExecAsync as ExecAsyncFunction });

      mockExecAsync.mockRejectedValueOnce(new Error('fatal: not a git repository'));

      const result = await checker.checkSync();

      expect(result.isUpToDate).toBe(false);
      expect(result.behindBy).toBe(-1);
      expect(result.currentBranch).toBe('unknown');
      expect(result.hasRemote).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should support custom remote branch', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' });

      const checker = new BranchSyncChecker({
        remoteBranch: 'origin/develop',
        execAsync: mockExecAsync as ExecAsyncFunction
      });
      const result = await checker.checkSync();

      expect(result.isUpToDate).toBe(true);
      // Verify origin/develop was used
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('origin/develop'),
        expect.any(Object)
      );
    });

    it('should trim whitespace from branch names', async () => {
      const checker = new BranchSyncChecker({ execAsync: mockExecAsync as ExecAsyncFunction });

      mockExecAsync
        .mockResolvedValueOnce({ stdout: '  feature/test  \n\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' });

      const result = await checker.checkSync();

      expect(result.currentBranch).toBe('feature/test');
    });

    it('should handle non-numeric commit counts', async () => {
      const checker = new BranchSyncChecker({ execAsync: mockExecAsync as ExecAsyncFunction });

      mockExecAsync
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'invalid\n', stderr: '' });  // Invalid count

      const result = await checker.checkSync();

      expect(result.behindBy).toBe(0);
    });

    it('should handle fetch failures', async () => {
      const checker = new BranchSyncChecker({ execAsync: mockExecAsync as ExecAsyncFunction });

      mockExecAsync
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockRejectedValueOnce(new Error('network error'));  // git fetch fails

      const result = await checker.checkSync();

      expect(result.error).toContain('Failed to fetch');
    });
  });

  describe('getExitCode', () => {
    it('should return 0 when up to date', () => {
      const checker = new BranchSyncChecker({ execAsync: mockExecAsync as ExecAsyncFunction });
      const result: SyncCheckResult = {
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
      };

      expect(checker.getExitCode(result)).toBe(0);
    });

    it('should return 1 when behind', () => {
      const checker = new BranchSyncChecker({ execAsync: mockExecAsync as ExecAsyncFunction });
      const result: SyncCheckResult = {
        isUpToDate: false,
        behindBy: 5,
        currentBranch: 'feature/test',
        hasRemote: true,
      };

      expect(checker.getExitCode(result)).toBe(1);
    });

    it('should return 0 when no remote exists', () => {
      const checker = new BranchSyncChecker({ execAsync: mockExecAsync as ExecAsyncFunction });
      const result: SyncCheckResult = {
        isUpToDate: false,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: false,
      };

      expect(checker.getExitCode(result)).toBe(0);
    });

    it('should return 2 on error', () => {
      const checker = new BranchSyncChecker({ execAsync: mockExecAsync as ExecAsyncFunction });
      const result: SyncCheckResult = {
        isUpToDate: false,
        behindBy: -1,
        currentBranch: 'unknown',
        hasRemote: false,
        error: 'git error',
      };

      expect(checker.getExitCode(result)).toBe(2);
    });
  });

  describe('checkBranchSync', () => {
    it('should provide convenience function for sync checking', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' });

      const result = await checkBranchSync({ execAsync: mockExecAsync as ExecAsyncFunction });

      expect(result.isUpToDate).toBe(true);
      expect(result.currentBranch).toBe('main');
    });

    it('should support custom options', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' });

      const result = await checkBranchSync({
        remoteBranch: 'origin/develop',
        execAsync: mockExecAsync as ExecAsyncFunction
      });

      expect(result.isUpToDate).toBe(true);
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('origin/develop'),
        expect.any(Object)
      );
    });
  });
});
