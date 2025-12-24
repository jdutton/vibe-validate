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

/**
 * Configuration for setting up merge scenario mocks
 */
interface MergeScenarioConfig {
  /** Current branch name (default: 'feature/test') */
  currentBranch?: string;
  /** List of branches to return (default: []) */
  branches?: string[];
  /** Map of branch name to list of merged branches (default: all merged) */
  mergedStatus?: Record<string, string[]>;
  /** Whether checkout should fail */
  checkoutFails?: boolean;
  /** Whether fetch should fail */
  fetchFails?: boolean;
  /** Whether merge should fail */
  mergeFails?: boolean;
  /** Whether branch deletion should fail on first attempt */
  deleteFails?: boolean;
  /** Whether force deletion should fail */
  forceDeleteFails?: boolean;
  /** Whether prune should fail */
  pruneFails?: boolean;
  /** Whether merge status check should fail */
  mergeCheckFails?: boolean;
  /** Whether getting current branch should fail */
  getCurrentBranchFails?: boolean;
}

/**
 * Sets up mock spawnSync calls for a merge scenario
 *
 * Simulates the standard workflow:
 * 1. Get current branch
 * 2. Switch to main (checkout)
 * 3. Fetch and merge main
 * 4. Fetch remote info
 * 5. List branches and check merge status for each
 * 6. Delete merged branches
 * 7. Prune remote
 *
 * @param config - Configuration for the scenario
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Test helper with acceptable complexity
const createMergeScenario = (config: MergeScenarioConfig = {}) => {
  const {
    currentBranch = 'feature/test',
    branches = [],
    mergedStatus = {},
    checkoutFails = false,
    fetchFails = false,
    mergeFails = false,
    deleteFails = false,
    forceDeleteFails = false,
    pruneFails = false,
    mergeCheckFails = false,
    getCurrentBranchFails = false,
  } = config;

  const mocks = [];

  // Step 1: Get current branch
  if (getCurrentBranchFails) {
    mocks.push(createSpawnError('not a git repo'));
    return mocks;
  }
  mocks.push(createSpawnResult(`${currentBranch}\n`));

  // Step 2: Switch to main
  if (checkoutFails) {
    mocks.push(createSpawnError('checkout failed'));
    return mocks;
  }
  mocks.push(createSpawnResult(''));

  // Step 3: Fetch main
  if (fetchFails) {
    mocks.push(createSpawnError('fetch failed'));
    return mocks;
  }
  mocks.push(createSpawnResult(''));

  // Step 3: Merge main
  if (mergeFails) {
    mocks.push(createSpawnError('merge failed'));
    return mocks;
  }
  // Step 4: Fetch remote info and list branches
  mocks.push(
    createSpawnResult(''), // Fetch remote
    createSpawnResult(''), // Fetch remote info
    createSpawnResult(branches.join('\n') + (branches.length > 0 ? '\n' : '')) // List branches
  );

  // Step 5: For each branch, check if merged and delete
  for (const branch of branches) {
    // Check merge status
    if (mergeCheckFails) {
      mocks.push(createSpawnError('merge check failed'));
      continue;
    }

    const merged = mergedStatus[branch] || [branch, 'main'];
    mocks.push(createSpawnResult(merged.join('\n') + '\n'));

    // If branch is merged (appears in its own merge check), delete it
    if (merged.includes(branch)) {
      if (deleteFails) {
        mocks.push(createSpawnError('branch not fully merged'));
        // Force delete attempt
        if (forceDeleteFails) {
          mocks.push(createSpawnError('force delete failed'));
        } else {
          mocks.push(createSpawnResult(''));
        }
      } else {
        mocks.push(createSpawnResult(''));
      }
    }
  }

  // Step 6: Prune remote
  if (pruneFails) {
    mocks.push(createSpawnError('prune failed'));
  } else {
    mocks.push(createSpawnResult(''));
  }

  return mocks;
};

/**
 * Sets up a standard post-merge test environment
 *
 * @param config - Optional configuration for the merge scenario
 * @returns Tuple of [cleanup instance, mock sequence]
 */
const setupPostMergeTest = (config: MergeScenarioConfig = {}) => {
  const mocks = createMergeScenario(config);
  for (const mock of mocks) {
    mockSpawnSync.mockReturnValueOnce(mock);
  }
  const cleanup = new PostPRMergeCleanup();
  return { cleanup, mockCount: mocks.length };
};

/**
 * Assert expected cleanup behavior
 *
 * @param result - The cleanup result to assert against
 * @param expectations - Expected values
 */
const expectCleanupBehavior = (
  result: Awaited<ReturnType<PostPRMergeCleanup['runCleanup']>>,
  expectations: {
    success: boolean;
    currentBranch?: string;
    mainSynced?: boolean;
    branchesDeleted?: string[];
    branchesNotDeleted?: string[];
    errorContains?: string;
  }
) => {
  expect(result.success).toBe(expectations.success);

  if (expectations.currentBranch !== undefined) {
    expect(result.currentBranch).toBe(expectations.currentBranch);
  }

  if (expectations.mainSynced !== undefined) {
    expect(result.mainSynced).toBe(expectations.mainSynced);
  }

  if (expectations.branchesDeleted) {
    for (const branch of expectations.branchesDeleted) {
      expect(result.branchesDeleted).toContain(branch);
    }
  }

  if (expectations.branchesNotDeleted) {
    for (const branch of expectations.branchesNotDeleted) {
      expect(result.branchesDeleted).not.toContain(branch);
    }
  }

  if (expectations.errorContains !== undefined) {
    expect(result.error).toContain(expectations.errorContains);
  }
};

describe('PostPRMergeCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runCleanup', () => {
    it('should complete full cleanup workflow successfully', async () => {
      const { cleanup } = setupPostMergeTest({
        currentBranch: 'feature/test',
        branches: ['feature/test', 'feature/old'],
      });

      const result = await cleanup.runCleanup();

      expectCleanupBehavior(result, {
        success: true,
        currentBranch: 'feature/test',
        mainSynced: true,
        branchesDeleted: ['feature/test', 'feature/old'],
      });
      expect(result.error).toBeUndefined();
    });

    it('should handle custom main branch name', async () => {
      const cleanup = new PostPRMergeCleanup({ mainBranch: 'develop' });
      const mocks = createMergeScenario({
        branches: ['feature/test'],
      });
      for (const mock of mocks) {
        mockSpawnSync.mockReturnValueOnce(mock);
      }

      const result = await cleanup.runCleanup();

      expectCleanupBehavior(result, {
        success: true,
      });
      // Verify checkout develop was called with array args
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        ['checkout', 'develop'],
        expect.any(Object)
      );
    });

    it('should handle custom remote name', async () => {
      const cleanup = new PostPRMergeCleanup({ remoteName: 'upstream' });
      const mocks = createMergeScenario({ branches: [] });
      for (const mock of mocks) mockSpawnSync.mockReturnValueOnce(mock);

      const result = await cleanup.runCleanup();

      expectCleanupBehavior(result, {
        success: true,
      });
      // Verify fetch upstream was called with array args
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        ['fetch', 'upstream', 'main'],
        expect.any(Object)
      );
    });

    it('should handle dry-run mode without deleting branches', async () => {
      const cleanup = new PostPRMergeCleanup({ dryRun: true });
      const mocks = createMergeScenario({
        branches: ['feature/test'],
      });
      for (const mock of mocks) mockSpawnSync.mockReturnValueOnce(mock);

      const result = await cleanup.runCleanup();

      expectCleanupBehavior(result, {
        success: true,
        branchesDeleted: ['feature/test'],
      });
      // Verify no delete commands were issued - check for branch -d in args
      const deleteCommands = mockSpawnSync.mock.calls.filter(
        ([_cmd, args]) => Array.isArray(args) && args.includes('-d')
      );
      expect(deleteCommands).toHaveLength(0);
    });

    it('should skip unmerged branches', async () => {
      const { cleanup } = setupPostMergeTest({
        branches: ['feature/merged', 'feature/unmerged'],
        mergedStatus: {
          'feature/merged': ['feature/merged', 'main'],
          'feature/unmerged': ['main'], // Not merged
        },
      });

      const result = await cleanup.runCleanup();

      expect(result).toBeDefined();
      expectCleanupBehavior(result, {
        success: true,
        branchesDeleted: ['feature/merged'],
        branchesNotDeleted: ['feature/unmerged'],
      });
    });

    it('should handle errors during branch switching', async () => {
      const { cleanup } = setupPostMergeTest({
        checkoutFails: true,
      });

      const result = await cleanup.runCleanup();

      expect(result).toBeDefined();
      expectCleanupBehavior(result, {
        success: false,
        errorContains: 'Failed to switch to main branch',
      });
    });

    it('should handle errors during sync', async () => {
      const { cleanup } = setupPostMergeTest({
        fetchFails: true,
      });

      const result = await cleanup.runCleanup();

      expect(result).toBeDefined();
      expectCleanupBehavior(result, {
        success: false,
        errorContains: 'Failed to sync main branch',
      });
    });

    it('should handle errors when getting current branch', async () => {
      const { cleanup } = setupPostMergeTest({
        getCurrentBranchFails: true,
      });

      const result = await cleanup.runCleanup();

      expect(result).toBeDefined();
      expectCleanupBehavior(result, {
        success: false,
        errorContains: 'Failed to get current branch',
      });
    });

    it('should force delete branches if regular delete fails', async () => {
      const { cleanup } = setupPostMergeTest({
        branches: ['feature/test'],
        deleteFails: true,
        forceDeleteFails: false,
      });

      const result = await cleanup.runCleanup();

      expectCleanupBehavior(result, {
        success: true,
        branchesDeleted: ['feature/test'],
      });
      // Verify force delete was called with array args
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        ['branch', '-D', 'feature/test'],
        expect.any(Object)
      );
    });

    it('should skip branch if both delete attempts fail', async () => {
      const { cleanup } = setupPostMergeTest({
        branches: ['feature/test'],
        deleteFails: true,
        forceDeleteFails: true,
      });

      const result = await cleanup.runCleanup();

      expect(result).toBeDefined();
      expectCleanupBehavior(result, {
        success: true,
        branchesNotDeleted: ['feature/test'],
      });
    });

    it('should handle empty branch list', async () => {
      const { cleanup } = setupPostMergeTest({
        currentBranch: 'main',
        branches: [],
      });

      const result = await cleanup.runCleanup();

      expectCleanupBehavior(result, {
        success: true,
      });
      expect(result.branchesDeleted).toHaveLength(0);
    });

    it('should filter out main branch from deletion list', async () => {
      const { cleanup } = setupPostMergeTest({
        branches: ['main', 'feature/test'],
      });

      const result = await cleanup.runCleanup();

      expect(result).toBeDefined();
      expectCleanupBehavior(result, {
        success: true,
        branchesNotDeleted: ['main'],
      });
    });

    it('should handle prune errors gracefully', async () => {
      const { cleanup } = setupPostMergeTest({
        branches: [],
        pruneFails: true,
      });

      const result = await cleanup.runCleanup();

      // Should still succeed even if prune fails
      expect(result).toBeDefined();
      expectCleanupBehavior(result, {
        success: true,
      });
    });

    it('should handle branch name with special characters', async () => {
      const { cleanup } = setupPostMergeTest({
        branches: ['feature/test-123'],
      });

      const result = await cleanup.runCleanup();

      expectCleanupBehavior(result, {
        success: true,
        branchesDeleted: ['feature/test-123'],
      });
      // Verify branch name was passed as array arg (no quoting needed)
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        ['branch', '-d', 'feature/test-123'],
        expect.any(Object)
      );
    });

    it('should trim branch names properly', async () => {
      // Mock directly for this edge case test
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
      const { cleanup } = setupPostMergeTest({
        branches: ['feature/test'],
        mergeCheckFails: true,
      });

      const result = await cleanup.runCleanup();

      expect(result).toBeDefined();
      expectCleanupBehavior(result, {
        success: true,
        branchesNotDeleted: ['feature/test'],
      });
    });
  });

  describe('cleanupMergedBranches', () => {
    it('should provide convenience function for cleanup', async () => {
      const mocks = createMergeScenario({ branches: [] });
      for (const mock of mocks) mockSpawnSync.mockReturnValueOnce(mock);

      const result = await cleanupMergedBranches();

      expect(result).toBeDefined();
      expectCleanupBehavior(result, {
        success: true,
        currentBranch: 'feature/test',
      });
    });

    it('should support custom options', async () => {
      const mocks = createMergeScenario({ branches: [] });
      for (const mock of mocks) mockSpawnSync.mockReturnValueOnce(mock);

      const result = await cleanupMergedBranches({
        mainBranch: 'develop',
        remoteName: 'upstream',
        dryRun: true,
      });

      expectCleanupBehavior(result, {
        success: true,
      });
      // Verify custom main branch was used with array args
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        ['checkout', 'develop'],
        expect.any(Object)
      );
    });
  });
});
