/**
 * Tests for BranchSyncChecker
 *
 * Tests the safe branch sync checking functionality that never auto-merges.
 * Updated to test command injection prevention via spawn-based execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BranchSyncChecker, checkBranchSync, type SyncCheckResult, type GitExecutor } from '../src/branch-sync.js';

describe('BranchSyncChecker', () => {
  let mockGitExecutor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGitExecutor = vi.fn();
  });

  describe('checkSync', () => {
    it('should return up-to-date status when branch is synced', async () => {
      // Mock git commands using array-based arguments (prevents injection)
      mockGitExecutor
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })  // ['rev-parse', '--abbrev-ref', 'HEAD']
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })         // ['rev-parse', '--verify', 'origin/main']
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // ['fetch', '--quiet', 'origin', 'main']
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' });             // ['rev-list', '--count', 'HEAD..origin/main']

      const checker = new BranchSyncChecker({ gitExecutor: mockGitExecutor as GitExecutor });
      const result = await checker.checkSync();

      expect(result.isUpToDate).toBe(true);
      expect(result.behindBy).toBe(0);
      expect(result.currentBranch).toBe('feature/test');
      expect(result.hasRemote).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return behind status when branch needs merge', async () => {
      mockGitExecutor
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '5\n', stderr: '' });  // 5 commits behind

      const checker = new BranchSyncChecker({ gitExecutor: mockGitExecutor as GitExecutor });
      const result = await checker.checkSync();

      expect(result.isUpToDate).toBe(false);
      expect(result.behindBy).toBe(5);
      expect(result.currentBranch).toBe('feature/test');
      expect(result.hasRemote).toBe(true);
    });

    it('should handle missing remote branch gracefully', async () => {
      mockGitExecutor
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockRejectedValueOnce(new Error('fatal: Needed a single revision'));  // Remote branch doesn't exist

      const checker = new BranchSyncChecker({ gitExecutor: mockGitExecutor as GitExecutor });
      const result = await checker.checkSync();

      expect(result.isUpToDate).toBe(true);
      expect(result.behindBy).toBe(0);
      expect(result.hasRemote).toBe(false);
      expect(result.error).toContain('No remote branch');
    });

    it('should handle git errors gracefully', async () => {
      mockGitExecutor.mockRejectedValueOnce(new Error('fatal: not a git repository'));

      const checker = new BranchSyncChecker({ gitExecutor: mockGitExecutor as GitExecutor });
      const result = await checker.checkSync();

      expect(result.isUpToDate).toBe(false);
      expect(result.behindBy).toBe(-1);
      expect(result.currentBranch).toBe('unknown');
      expect(result.hasRemote).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should support custom remote branch', async () => {
      mockGitExecutor
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' });

      const checker = new BranchSyncChecker({
        remoteBranch: 'origin/develop',
        gitExecutor: mockGitExecutor as GitExecutor
      });
      const result = await checker.checkSync();

      expect(result.isUpToDate).toBe(true);
      // Verify origin/develop was used (via array arguments)
      expect(mockGitExecutor).toHaveBeenCalledWith(['rev-parse', '--verify', 'origin/develop']);
    });

    it('should trim whitespace from branch names', async () => {
      mockGitExecutor
        .mockResolvedValueOnce({ stdout: '  feature/test  \n\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' });

      const checker = new BranchSyncChecker({ gitExecutor: mockGitExecutor as GitExecutor });
      const result = await checker.checkSync();

      expect(result.currentBranch).toBe('feature/test');
    });

    it('should handle non-numeric commit counts', async () => {
      mockGitExecutor
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'invalid\n', stderr: '' });  // Invalid count

      const checker = new BranchSyncChecker({ gitExecutor: mockGitExecutor as GitExecutor });
      const result = await checker.checkSync();

      expect(result.behindBy).toBe(0);
    });

    it('should handle fetch failures', async () => {
      mockGitExecutor
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockRejectedValueOnce(new Error('network error'));  // git fetch fails

      const checker = new BranchSyncChecker({ gitExecutor: mockGitExecutor as GitExecutor });
      const result = await checker.checkSync();

      expect(result.error).toContain('Failed to fetch');
    });

    it('should prevent command injection via array-based arguments', async () => {
      // This test verifies that malicious branch names cannot inject commands
      const maliciousBranch = 'origin/main; rm -rf /';

      mockGitExecutor
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' });

      const checker = new BranchSyncChecker({
        remoteBranch: maliciousBranch,
        gitExecutor: mockGitExecutor as GitExecutor
      });
      await checker.checkSync();

      // Verify that the branch name is passed as an array argument (safe)
      // NOT as a shell string (vulnerable)
      // The key is that each argument is separate - the shell cannot interpret "; rm -rf /"
      expect(mockGitExecutor).toHaveBeenCalledWith(['rev-parse', '--verify', maliciousBranch]);

      // When the branch is split by '/', both parts are still separate arguments
      // The shell will receive: ['fetch', '--quiet', 'origin', 'main; rm -rf ']
      // NOT: 'fetch --quiet origin main; rm -rf /' (which would execute rm -rf)
      expect(mockGitExecutor).toHaveBeenCalledWith(['fetch', '--quiet', 'origin', 'main; rm -rf ']);
    });
  });

  describe('getExitCode', () => {
    it('should return 0 when up to date', () => {
      const checker = new BranchSyncChecker({ gitExecutor: mockGitExecutor as GitExecutor });
      const result: SyncCheckResult = {
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
      };

      expect(checker.getExitCode(result)).toBe(0);
    });

    it('should return 1 when behind', () => {
      const checker = new BranchSyncChecker({ gitExecutor: mockGitExecutor as GitExecutor });
      const result: SyncCheckResult = {
        isUpToDate: false,
        behindBy: 5,
        currentBranch: 'feature/test',
        hasRemote: true,
      };

      expect(checker.getExitCode(result)).toBe(1);
    });

    it('should return 0 when no remote exists', () => {
      const checker = new BranchSyncChecker({ gitExecutor: mockGitExecutor as GitExecutor });
      const result: SyncCheckResult = {
        isUpToDate: false,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: false,
      };

      expect(checker.getExitCode(result)).toBe(0);
    });

    it('should return 2 on error', () => {
      const checker = new BranchSyncChecker({ gitExecutor: mockGitExecutor as GitExecutor });
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
      mockGitExecutor
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' });

      const result = await checkBranchSync({ gitExecutor: mockGitExecutor as GitExecutor });

      expect(result.isUpToDate).toBe(true);
      expect(result.currentBranch).toBe('main');
    });

    it('should support custom options', async () => {
      mockGitExecutor
        .mockResolvedValueOnce({ stdout: 'feature/test\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' });

      const result = await checkBranchSync({
        remoteBranch: 'origin/develop',
        gitExecutor: mockGitExecutor as GitExecutor
      });

      expect(result.isUpToDate).toBe(true);
      expect(mockGitExecutor).toHaveBeenCalledWith(['rev-parse', '--verify', 'origin/develop']);
    });
  });
});
