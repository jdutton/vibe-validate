/**
 * Tests for PostPRMergeCleanup
 *
 * Tests the comprehensive post-PR merge cleanup workflow that safely
 * deletes merged branches and syncs the main branch.
 */

import { spawnSync } from 'node:child_process';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PostPRMergeCleanup, cleanupMergedBranches } from '../src/post-merge-cleanup.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

const mockSpawnSync = spawnSync as ReturnType<typeof vi.fn>;

/**
 * Helper to create spawnSync success result
 */
const createSpawnResult = (stdout: string, status = 0) => ({
  status,
  stdout,
  stderr: '',
  error: undefined,
});

/**
 * Helper to create spawnSync error result
 */
const createSpawnError = (message: string) => ({
  status: 1,
  stdout: '',
  stderr: message,
  error: new Error(message),
});

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

      mockSpawnSync
        // Step 1: Get current branch
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        // Step 2: Switch to main
        .mockReturnValueOnce(createSpawnResult(''))
        // Step 3: Fetch main
        .mockReturnValueOnce(createSpawnResult(''))
        // Step 3: Merge main
        .mockReturnValueOnce(createSpawnResult(''))
        // Step 4: Fetch remote info
        .mockReturnValueOnce(createSpawnResult(''))
        // Step 5: List branches
        .mockReturnValueOnce(createSpawnResult('feature/test\nfeature/old\n'))
        // Step 5: Check merged branches (1st check)
        .mockReturnValueOnce(createSpawnResult('feature/test\nmain\n'))
        // Step 5: Delete branch
        .mockReturnValueOnce(createSpawnResult(''))
        // Step 5: Check merged branches (2nd check)
        .mockReturnValueOnce(createSpawnResult('feature/old\nmain\n'))
        // Step 5: Delete branch
        .mockReturnValueOnce(createSpawnResult(''))
        // Step 6: Prune remote
        .mockReturnValueOnce(createSpawnResult(''));

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

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))  // checkout develop
        .mockReturnValueOnce(createSpawnResult(''))  // fetch develop
        .mockReturnValueOnce(createSpawnResult(''))  // merge develop
        .mockReturnValueOnce(createSpawnResult(''))  // fetch remote
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult('feature/test\ndevelop\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      // Verify checkout develop was called with array args
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        ['checkout', 'develop'],
        expect.any(Object)
      );
    });

    it('should handle custom remote name', async () => {
      const cleanup = new PostPRMergeCleanup({ remoteName: 'upstream' });

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))  // fetch upstream main
        .mockReturnValueOnce(createSpawnResult(''))  // merge upstream/main
        .mockReturnValueOnce(createSpawnResult(''))  // fetch upstream
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      // Verify fetch upstream was called with array args
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        ['fetch', 'upstream', 'main'],
        expect.any(Object)
      );
    });

    it('should handle dry-run mode without deleting branches', async () => {
      const cleanup = new PostPRMergeCleanup({ dryRun: true });

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult('feature/test\nmain\n'))
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.branchesDeleted).toContain('feature/test');
      // Verify no delete commands were issued - check for branch -d in args
      const deleteCommands = mockSpawnSync.mock.calls.filter(
        ([_cmd, args]) => Array.isArray(args) && args.includes('-d')
      );
      expect(deleteCommands).toHaveLength(0);
    });

    it('should skip unmerged branches', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult('feature/merged\nfeature/unmerged\n'))
        // feature/merged is merged
        .mockReturnValueOnce(createSpawnResult('feature/merged\nmain\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        // feature/unmerged is NOT merged
        .mockReturnValueOnce(createSpawnResult('main\n'))
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.branchesDeleted).toContain('feature/merged');
      expect(result.branchesDeleted).not.toContain('feature/unmerged');
    });

    it('should handle errors during branch switching', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnError('checkout failed'));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to switch to main branch');
    });

    it('should handle errors during sync', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnError('fetch failed'));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to sync main branch');
    });

    it('should handle errors when getting current branch', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockSpawnSync.mockReturnValueOnce(createSpawnError('not a git repo'));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get current branch');
    });

    it('should force delete branches if regular delete fails', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult('feature/test\nmain\n'))
        // Regular delete fails
        .mockReturnValueOnce(createSpawnError('branch not fully merged'))
        // Force delete succeeds
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.branchesDeleted).toContain('feature/test');
      // Verify force delete was called with array args
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        ['branch', '-D', 'feature/test'],
        expect.any(Object)
      );
    });

    it('should skip branch if both delete attempts fail', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult('feature/test\nmain\n'))
        // Regular delete fails
        .mockReturnValueOnce(createSpawnError('delete failed'))
        // Force delete also fails
        .mockReturnValueOnce(createSpawnError('force delete failed'))
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.branchesDeleted).not.toContain('feature/test');
    });

    it('should handle empty branch list', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('main\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))  // Empty branch list
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.branchesDeleted).toHaveLength(0);
    });

    it('should filter out main branch from deletion list', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        // Return main in the branch list (should be filtered)
        .mockReturnValueOnce(createSpawnResult('main\nfeature/test\n'))
        .mockReturnValueOnce(createSpawnResult('feature/test\nmain\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      // Main should not be in deleted branches
      expect(result.branchesDeleted).not.toContain('main');
    });

    it('should handle prune errors gracefully', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        // Prune fails - should not affect overall success
        .mockReturnValueOnce(createSpawnError('prune failed'));

      const result = await cleanup.runCleanup();

      // Should still succeed even if prune fails
      expect(result.success).toBe(true);
    });

    it('should handle branch name with special characters', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult('feature/test-123\n'))
        .mockReturnValueOnce(createSpawnResult('feature/test-123\nmain\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      expect(result.branchesDeleted).toContain('feature/test-123');
      // Verify branch name was passed as array arg (no quoting needed)
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        ['branch', '-d', 'feature/test-123'],
        expect.any(Object)
      );
    });

    it('should trim branch names properly', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('  feature/test  \n\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanup.runCleanup();

      expect(result.currentBranch).toBe('feature/test');
    });

    it('should handle merge status check errors', async () => {
      const cleanup = new PostPRMergeCleanup();

      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        // Merge status check fails - should skip branch
        .mockReturnValueOnce(createSpawnError('merge check failed'))
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanup.runCleanup();

      expect(result.success).toBe(true);
      // Branch should not be deleted if merge status is unclear
      expect(result.branchesDeleted).not.toContain('feature/test');
    });
  });

  describe('cleanupMergedBranches', () => {
    it('should provide convenience function for cleanup', async () => {
      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanupMergedBranches();

      expect(result.success).toBe(true);
      expect(result.currentBranch).toBe('feature/test');
    });

    it('should support custom options', async () => {
      mockSpawnSync
        .mockReturnValueOnce(createSpawnResult('feature/test\n'))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''))
        .mockReturnValueOnce(createSpawnResult(''));

      const result = await cleanupMergedBranches({
        mainBranch: 'develop',
        remoteName: 'upstream',
        dryRun: true,
      });

      expect(result.success).toBe(true);
      // Verify custom main branch was used with array args
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        ['checkout', 'develop'],
        expect.any(Object)
      );
    });
  });
});
