/**
 * Tests for BranchSyncChecker
 *
 * Tests the safe branch sync checking functionality that never auto-merges.
 * Updated to test command injection prevention via spawn-based execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BranchSyncChecker, checkBranchSync, type SyncCheckResult, type GitExecutor } from '../src/branch-sync.js';

/**
 * Setup mock git executor with a sequence of responses
 * @param responses Array of responses for each git command
 * @returns Configured mock executor
 */
function setupMockExecutor(responses: Array<{ stdout: string; stderr: string } | Error>) {
  const mock = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) {
      mock.mockRejectedValueOnce(response);
    } else {
      mock.mockResolvedValueOnce(response);
    }
  }
  return mock as unknown as GitExecutor;
}

/**
 * Create a standard sync check sequence for successful sync
 * @param branchName Current branch name (default: 'feature/test')
 * @param behindBy Number of commits behind (default: 0)
 * @returns Array of mock responses
 */
function createSyncCheckResponses(branchName = 'feature/test', behindBy = 0) {
  return [
    { stdout: `${branchName}\n`, stderr: '' },  // rev-parse --abbrev-ref HEAD
    { stdout: 'abc123\n', stderr: '' },          // rev-parse --verify origin/main
    { stdout: '', stderr: '' },                  // fetch --quiet origin main
    { stdout: `${behindBy}\n`, stderr: '' },     // rev-list --count HEAD..origin/main
  ];
}

/**
 * Create a BranchSyncChecker instance with mock executor
 * @param mockExecutor Mock git executor
 * @param remoteBranch Optional remote branch override
 * @returns Configured BranchSyncChecker
 */
function createChecker(mockExecutor: GitExecutor, remoteBranch?: string) {
  return new BranchSyncChecker({
    ...(remoteBranch && { remoteBranch }),
    gitExecutor: mockExecutor,
  });
}

/**
 * Create a SyncCheckResult object with defaults
 * @param overrides Partial result to override defaults
 * @returns Complete SyncCheckResult
 */
function createSyncResult(overrides: Partial<SyncCheckResult> = {}): SyncCheckResult {
  return {
    isUpToDate: true,
    behindBy: 0,
    currentBranch: 'feature/test',
    hasRemote: true,
    ...overrides,
  };
}

/**
 * Assert standard sync behavior expectations
 * @param result Sync check result to verify
 * @param expected Expected values
 */
function expectSyncBehavior(
  result: SyncCheckResult,
  expected: {
    isUpToDate: boolean;
    behindBy: number;
    currentBranch: string;
    hasRemote: boolean;
    error?: string;
  }
) {
  expect(result.isUpToDate).toBe(expected.isUpToDate);
  expect(result.behindBy).toBe(expected.behindBy);
  expect(result.currentBranch).toBe(expected.currentBranch);
  expect(result.hasRemote).toBe(expected.hasRemote);

  if (expected.error !== undefined) {
    if (expected.error === '') {
      expect(result.error).toBeUndefined();
    } else {
      expect(result.error).toContain(expected.error);
    }
  }
}

describe('BranchSyncChecker', () => {
  let mockGitExecutor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGitExecutor = vi.fn();
  });

  describe('checkSync', () => {
    it('should return up-to-date status when branch is synced', async () => {
      const executor = setupMockExecutor(createSyncCheckResponses());
      const checker = createChecker(executor);
      const result = await checker.checkSync();

      expectSyncBehavior(result, {
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
        error: '',
      });
    });

    it('should return behind status when branch needs merge', async () => {
      const executor = setupMockExecutor(createSyncCheckResponses('feature/test', 5));
      const checker = createChecker(executor);
      const result = await checker.checkSync();

      expectSyncBehavior(result, {
        isUpToDate: false,
        behindBy: 5,
        currentBranch: 'feature/test',
        hasRemote: true,
      });
    });

    it('should handle missing remote branch gracefully', async () => {
      const executor = setupMockExecutor([
        { stdout: 'feature/test\n', stderr: '' },
        new Error('fatal: Needed a single revision'),
      ]);
      const checker = createChecker(executor);
      const result = await checker.checkSync();

      expectSyncBehavior(result, {
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: false,
        error: 'No remote branch',
      });
    });

    it('should handle git errors gracefully', async () => {
      const executor = setupMockExecutor([
        new Error('fatal: not a git repository'),
      ]);
      const checker = createChecker(executor);
      const result = await checker.checkSync();

      expect(result.isUpToDate).toBe(false);
      expect(result.behindBy).toBe(-1);
      expect(result.currentBranch).toBe('unknown');
      expect(result.hasRemote).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should support custom remote branch', async () => {
      const executor = setupMockExecutor(createSyncCheckResponses());
      const checker = createChecker(executor, 'origin/develop');
      const result = await checker.checkSync();

      expect(result.isUpToDate).toBe(true);
      // Verify origin/develop was used (via array arguments)
      expect(executor).toHaveBeenCalledWith(['rev-parse', '--verify', 'origin/develop']);
    });

    it('should trim whitespace from branch names', async () => {
      const executor = setupMockExecutor([
        { stdout: '  feature/test  \n\n', stderr: '' },
        { stdout: 'abc123\n', stderr: '' },
        { stdout: '', stderr: '' },
        { stdout: '0\n', stderr: '' },
      ]);
      const checker = createChecker(executor);
      const result = await checker.checkSync();

      expect(result.currentBranch).toBe('feature/test');
    });

    it('should handle non-numeric commit counts', async () => {
      const executor = setupMockExecutor([
        { stdout: 'feature/test\n', stderr: '' },
        { stdout: 'abc123\n', stderr: '' },
        { stdout: '', stderr: '' },
        { stdout: 'invalid\n', stderr: '' },
      ]);
      const checker = createChecker(executor);
      const result = await checker.checkSync();

      expect(result.behindBy).toBe(0);
    });

    it('should handle fetch failures', async () => {
      const executor = setupMockExecutor([
        { stdout: 'feature/test\n', stderr: '' },
        { stdout: 'abc123\n', stderr: '' },
        new Error('network error'),
      ]);
      const checker = createChecker(executor);
      const result = await checker.checkSync();

      expect(result.error).toContain('Failed to fetch');
    });

    it('should prevent command injection via array-based arguments', async () => {
      // This test verifies that malicious branch names cannot inject commands
      const maliciousBranch = 'origin/main; rm -rf /';
      const executor = setupMockExecutor(createSyncCheckResponses());
      const checker = createChecker(executor, maliciousBranch);

      await checker.checkSync();

      // Verify that the branch name is passed as an array argument (safe)
      // NOT as a shell string (vulnerable)
      // The key is that each argument is separate - the shell cannot interpret "; rm -rf /"
      expect(executor).toHaveBeenCalledWith(['rev-parse', '--verify', maliciousBranch]);

      // When the branch is split by '/', both parts are still separate arguments
      // The shell will receive: ['fetch', '--quiet', 'origin', 'main; rm -rf ']
      // NOT: 'fetch --quiet origin main; rm -rf /' (which would execute rm -rf)
      expect(executor).toHaveBeenCalledWith(['fetch', '--quiet', 'origin', 'main; rm -rf ']);
    });
  });

  describe('getExitCode', () => {
    it('should return 0 when up to date', () => {
      const checker = createChecker(mockGitExecutor as GitExecutor);
      const result = createSyncResult();

      expect(checker.getExitCode(result)).toBe(0);
    });

    it('should return 1 when behind', () => {
      const checker = createChecker(mockGitExecutor as GitExecutor);
      const result = createSyncResult({
        isUpToDate: false,
        behindBy: 5,
      });

      expect(checker.getExitCode(result)).toBe(1);
    });

    it('should return 0 when no remote exists', () => {
      const checker = createChecker(mockGitExecutor as GitExecutor);
      const result = createSyncResult({
        isUpToDate: false,
        hasRemote: false,
      });

      expect(checker.getExitCode(result)).toBe(0);
    });

    it('should return 2 on error', () => {
      const checker = createChecker(mockGitExecutor as GitExecutor);
      const result = createSyncResult({
        isUpToDate: false,
        behindBy: -1,
        currentBranch: 'unknown',
        hasRemote: false,
        error: 'git error',
      });

      expect(checker.getExitCode(result)).toBe(2);
    });
  });

  describe('checkBranchSync', () => {
    it('should provide convenience function for sync checking', async () => {
      const executor = setupMockExecutor(createSyncCheckResponses('main', 0));
      const result = await checkBranchSync({ gitExecutor: executor });

      expect(result.isUpToDate).toBe(true);
      expect(result.currentBranch).toBe('main');
    });

    it('should support custom options', async () => {
      const executor = setupMockExecutor(createSyncCheckResponses());
      const result = await checkBranchSync({
        remoteBranch: 'origin/develop',
        gitExecutor: executor,
      });

      expect(result.isUpToDate).toBe(true);
      expect(executor).toHaveBeenCalledWith(['rev-parse', '--verify', 'origin/develop']);
    });
  });
});
