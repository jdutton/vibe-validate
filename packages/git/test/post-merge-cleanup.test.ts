/**
 * Tests for PostPRMergeCleanup
 *
 * Tests the comprehensive post-PR merge cleanup workflow that safely
 * deletes merged branches and syncs the main branch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { PostPRMergeCleanup, cleanupMergedBranches, type CleanupResult } from '../src/post-merge-cleanup.js';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = execSync as ReturnType<typeof vi.fn>;

describe('PostPRMergeCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runCleanup', () => {
    it('should complete full cleanup workflow successfully', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync
        // Step 1: Get current branch
        .mockReturnValueOnce('feature/test\n')
        // Step 2: Switch to main
        .mockReturnValueOnce('')
        // Step 3: Fetch main
        .mockReturnValueOnce('')
        // Step 3: Merge main
        .mockReturnValueOnce('')
        // Step 4: Fetch remote info
        .mockReturnValueOnce('')
        // Step 5: List branches
        .mockReturnValueOnce('feature/test\nfeature/old\n')
        // Step 5: Check merged branches (1st check)
        .mockReturnValueOnce('feature/test\nmain\n')
        // Step 5: Delete branch
        .mockReturnValueOnce('')
        // Step 5: Check merged branches (2nd check)
        .mockReturnValueOnce('feature/old\nmain\n')
        // Step 5: Delete branch
        .mockReturnValueOnce('')
        // Step 6: Prune remote
        .mockReturnValueOnce('');

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.currentBranch).toBe('feature/test');
      expect(result.mainSynced).toBe(true);
      expect(result.branchesDeleted).toContain('feature/test');
      expect(result.branchesDeleted).toContain('feature/old');
      expect(result.error).toBeUndefined();
    });

    it('should handle custom main branch name', async () => {
      const cleanup = new PostPRMergeCleanup({ mainBranch: 'develop' });

      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')  // checkout develop
        .mockReturnValueOnce('')  // fetch develop
        .mockReturnValueOnce('')  // merge develop
        .mockReturnValueOnce('')  // fetch remote
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('feature/test\ndevelop\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      // Verify checkout develop was called
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('checkout develop'),
        expect.any(Object)
      );
    });

    it('should handle custom remote name', async () => {
      const cleanup = new PostPRMergeCleanup({ remoteName: 'upstream' });

      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')  // fetch upstream main
        .mockReturnValueOnce('')  // merge upstream/main
        .mockReturnValueOnce('')  // fetch upstream
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      // Verify fetch upstream was called
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('fetch upstream'),
        expect.any(Object)
      );
    });

    it('should handle dry-run mode without deleting branches', async () => {
      const cleanup = new PostPRMergeCleanup({ dryRun: true });

      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('feature/test\nmain\n')
        .mockReturnValueOnce('');

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.branchesDeleted).toContain('feature/test');
      // Verify no delete commands were issued
      const deleteCommands = mockExecSync.mock.calls.filter(
        ([cmd]) => typeof cmd === 'string' && cmd.includes('branch -d')
      );
      expect(deleteCommands).toHaveLength(0);
    });

    it('should skip unmerged branches', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('feature/merged\nfeature/unmerged\n')
        // feature/merged is merged
        .mockReturnValueOnce('feature/merged\nmain\n')
        .mockReturnValueOnce('')
        // feature/unmerged is NOT merged
        .mockReturnValueOnce('main\n')
        .mockReturnValueOnce('');

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.branchesDeleted).toContain('feature/merged');
      expect(result.branchesDeleted).not.toContain('feature/unmerged');
    });

    it('should handle errors during branch switching', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockImplementationOnce(() => {
          throw new Error('checkout failed');
        });

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to switch to main branch');
    });

    it('should handle errors during sync', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')
        .mockImplementationOnce(() => {
          throw new Error('fetch failed');
        });

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to sync main branch');
    });

    it('should handle errors when getting current branch', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync.mockImplementationOnce(() => {
        throw new Error('not a git repo');
      });

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get current branch');
    });

    it('should force delete branches if regular delete fails', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('feature/test\nmain\n')
        // Regular delete fails
        .mockImplementationOnce(() => {
          throw new Error('branch not fully merged');
        })
        // Force delete succeeds
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.branchesDeleted).toContain('feature/test');
      // Verify force delete was called
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('branch -D'),
        expect.any(Object)
      );
    });

    it('should skip branch if both delete attempts fail', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('feature/test\nmain\n')
        // Regular delete fails
        .mockImplementationOnce(() => {
          throw new Error('delete failed');
        })
        // Force delete also fails
        .mockImplementationOnce(() => {
          throw new Error('force delete failed');
        })
        .mockReturnValueOnce('');

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.branchesDeleted).not.toContain('feature/test');
    });

    it('should handle empty branch list', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync
        .mockReturnValueOnce('main\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')  // Empty branch list
        .mockReturnValueOnce('');

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.branchesDeleted).toHaveLength(0);
    });

    it('should filter out main branch from deletion list', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        // Return main in the branch list (should be filtered)
        .mockReturnValueOnce('main\nfeature/test\n')
        .mockReturnValueOnce('feature/test\nmain\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      // Main should not be in deleted branches
      expect(result.branchesDeleted).not.toContain('main');
    });

    it('should handle prune errors gracefully', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        // Prune fails - should not affect overall success
        .mockImplementationOnce(() => {
          throw new Error('prune failed');
        });

      const result = await cleanup.runCleanup();

      // Should still succeed even if prune fails
      expect(result.success).toBe(true);
    });

    it('should handle branch name with special characters', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('feature/test-123\n')
        .mockReturnValueOnce('feature/test-123\nmain\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.branchesDeleted).toContain('feature/test-123');
      // Verify branch name was properly quoted
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('"feature/test-123"'),
        expect.any(Object)
      );
    });

    it('should trim branch names properly', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync
        .mockReturnValueOnce('  feature/test  \n\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await cleanup.runCleanup();

      expect(result.currentBranch).toBe('feature/test');
    });

    it('should handle merge status check errors', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('feature/test\n')
        // Merge status check fails - should skip branch
        .mockImplementationOnce(() => {
          throw new Error('merge check failed');
        })
        .mockReturnValueOnce('');

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      // Branch should not be deleted if merge status is unclear
      expect(result.branchesDeleted).not.toContain('feature/test');
    });
  });

  describe('cleanupMergedBranches', () => {
    it('should provide convenience function for cleanup', async () => {
      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await cleanupMergedBranches();

      expect(result.success).toBe(true);
      expect(result.currentBranch).toBe('feature/test');
    });

    it('should support custom options', async () => {
      mockExecSync
        .mockReturnValueOnce('feature/test\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await cleanupMergedBranches({
        mainBranch: 'develop',
        remoteName: 'upstream',
        dryRun: true,
      });

      expect(result.success).toBe(true);
      // Verify custom main branch was used
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('checkout develop'),
        expect.any(Object)
      );
    });
  });
});
