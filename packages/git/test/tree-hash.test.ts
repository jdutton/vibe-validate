/**
 * Tests for deterministic git tree hash calculation
 *
 * CRITICAL: Git tree hash must be deterministic (content-based, no timestamps)
 * to ensure validation state caching works correctly across runs.
 */

import { copyFileSync, existsSync, unlinkSync, readdirSync, statSync, type Stats } from 'node:fs';

import * as utils from '@vibe-validate/utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as gitExecutor from '../src/git-executor.js';
import type { GitExecutionOptions } from '../src/git-executor.js';
import { getGitTreeHash } from '../src/tree-hash.js';

// Mock git-executor
vi.mock('../src/git-executor.js', () => ({
  executeGitCommand: vi.fn(),
}));

// Mock fs operations (SECURITY: We use fs instead of shell commands)
vi.mock('fs', () => ({
  copyFileSync: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

// Mock @vibe-validate/utils
vi.mock('@vibe-validate/utils', () => ({
  isProcessRunning: vi.fn(),
}));

const mockCopyFileSync = copyFileSync as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockUnlinkSync = unlinkSync as ReturnType<typeof vi.fn>;
const mockReaddirSync = readdirSync as ReturnType<typeof vi.fn>;
const mockStatSync = statSync as ReturnType<typeof vi.fn>;
const mockIsProcessRunning = utils.isProcessRunning as ReturnType<typeof vi.fn>;

/**
 * Helper to mock initial git commands (repo check, git dir, add)
 * Reduces duplication in test setup
 */
function mockInitialGitCommands() {
  return vi.mocked(gitExecutor.executeGitCommand)
    .mockReturnValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 })  // git rev-parse --is-inside-work-tree
    .mockReturnValueOnce({ success: true, stdout: '.git', stderr: '', exitCode: 0 })  // git rev-parse --git-dir
    .mockReturnValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 });  // git add
}

/**
 * Helper to mock standard git command sequence for tree hash calculation
 * Reduces duplication in test setup
 */
function mockStandardGitCommands(writeTreeOutput = 'abc123\n') {
  mockInitialGitCommands()
    .mockReturnValueOnce({ success: true, stdout: writeTreeOutput, stderr: '', exitCode: 0 });  // git write-tree
}

/**
 * Helper to create mock file stats
 * Used for testing stale temp index cleanup
 */
function createMockStats(mtimeMs: number): Partial<Stats> {
  return { mtimeMs };
}

describe('getGitTreeHash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: .git/index exists (most common case)
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should calculate tree hash using git write-tree', async () => {
    // Mock git commands
    vi.mocked(gitExecutor.executeGitCommand)
      .mockReturnValueOnce({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      })  // git rev-parse --is-inside-work-tree
      .mockReturnValueOnce({
        success: true,
        stdout: '.git',
        stderr: '',
        exitCode: 0,
      })  // git rev-parse --git-dir
      .mockReturnValueOnce({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      })  // git add --all (with temp index)
      .mockReturnValueOnce({
        success: true,
        stdout: 'abc123def456\n',
        stderr: '',
        exitCode: 0,
      });  // git write-tree (with temp index)

    const hash = await getGitTreeHash();

    expect(hash).toBe('abc123def456');

    // Verify correct git commands were called (4 times, not 6 - fs operations not via executeGitCommand)
    expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(4);

    // Verify fs.copyFileSync was called (SECURITY: replaces cp shell command)
    expect(mockCopyFileSync).toHaveBeenCalledTimes(1);
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('index'),
      expect.stringContaining('vibe-validate-temp-index')
    );

    // Verify correct git commands were called
    expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(
      1,
      ['rev-parse', '--is-inside-work-tree'],
      expect.any(Object)
    );
    expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(
      2,
      ['rev-parse', '--git-dir'],
      expect.any(Object)
    );
    expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(
      3,
      ['add', '--all'],
      expect.objectContaining({
        env: expect.objectContaining({
          GIT_INDEX_FILE: expect.stringContaining('vibe-validate-temp-index')
        })
      })
    );
    expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(
      4,
      ['write-tree'],
      expect.objectContaining({
        env: expect.objectContaining({
          GIT_INDEX_FILE: expect.stringContaining('vibe-validate-temp-index')
        })
      })
    );

    // Verify fs.unlinkSync was called (SECURITY: replaces rm shell command)
    expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('vibe-validate-temp-index')
    );
  });

  it('should return same hash for identical content', async () => {
    // Simulate running twice with same content
    vi.mocked(gitExecutor.executeGitCommand)
      .mockReturnValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 })  // git rev-parse --is-inside-work-tree (1st run)
      .mockReturnValueOnce({ success: true, stdout: '.git', stderr: '', exitCode: 0 })  // git rev-parse --git-dir (1st run)
      .mockReturnValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 })  // git add (1st run)
      .mockReturnValueOnce({ success: true, stdout: 'sameHash123\n', stderr: '', exitCode: 0 })  // git write-tree (1st run)
      .mockReturnValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 })  // git rev-parse --is-inside-work-tree (2nd run)
      .mockReturnValueOnce({ success: true, stdout: '.git', stderr: '', exitCode: 0 })  // git rev-parse --git-dir (2nd run)
      .mockReturnValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 })  // git add (2nd run)
      .mockReturnValueOnce({ success: true, stdout: 'sameHash123\n', stderr: '', exitCode: 0 });  // git write-tree (2nd run)

    const hash1 = await getGitTreeHash();
    const hash2 = await getGitTreeHash();

    expect(hash1).toBe('sameHash123');
    expect(hash2).toBe('sameHash123');
    expect(hash1).toBe(hash2);

    // Verify fs operations were called twice (once per run)
    expect(mockCopyFileSync).toHaveBeenCalledTimes(2);
    expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
  });

  it('should use temporary index file to avoid corrupting real index', async () => {
    vi.mocked(gitExecutor.executeGitCommand).mockImplementation((args) => {
      if (args[0] === 'write-tree') {
        return { success: true, stdout: 'abc123\n', stderr: '', exitCode: 0 };
      }
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') {
        return { success: true, stdout: '.git', stderr: '', exitCode: 0 };
      }
      return { success: true, stdout: '', stderr: '', exitCode: 0 };
    });

    await getGitTreeHash();

    // Verify temp index is created (SECURITY: fs.copyFileSync instead of cp)
    expect(mockCopyFileSync).toHaveBeenCalledTimes(1);
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('index'),
      expect.stringContaining('vibe-validate-temp-index')
    );

    // Verify GIT_INDEX_FILE is used for git operations
    const writeTreeCall = vi.mocked(gitExecutor.executeGitCommand).mock.calls.find(
      ([args]) => args[0] === 'write-tree'
    );
    expect(writeTreeCall?.[1]).toHaveProperty('env');
    expect((writeTreeCall?.[1] as GitExecutionOptions).env).toHaveProperty('GIT_INDEX_FILE');

    // Verify temp index is cleaned up (SECURITY: fs.unlinkSync instead of rm)
    expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('vibe-validate-temp-index')
    );
  });

  it('should trim whitespace from hash', async () => {
    mockStandardGitCommands('  abc123  \n\n');

    const hash = await getGitTreeHash();

    expect(hash).toBe('abc123');
  });

  it('should handle git errors gracefully', async () => {
    vi.mocked(gitExecutor.executeGitCommand).mockImplementation(() => {
      throw new Error('git command failed');
    });

    await expect(getGitTreeHash()).rejects.toThrow('Failed to calculate git tree hash');
  });

  it('should handle empty repository', async () => {
    mockStandardGitCommands('4b825dc642cb6eb9a060e54bf8d69288fbee4904\n');

    const hash = await getGitTreeHash();

    expect(hash).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  });

  it('should not include timestamps in hash', async () => {
    // This is a critical test - hash should be content-based only
    // We verify this by checking that git write-tree is used (not git stash create)
    vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({ success: true, stdout: 'abc123\n', stderr: '', exitCode: 0 });
    vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 });  // git rev-parse --is-inside-work-tree
    vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({ success: true, stdout: '.git', stderr: '', exitCode: 0 });  // git rev-parse --git-dir

    await getGitTreeHash();

    // Ensure we never call git stash create (which includes timestamps)
    const stashCall = vi.mocked(gitExecutor.executeGitCommand).mock.calls.find(
      ([args]) => Array.isArray(args) && args.join(' ').includes('stash create')
    );
    expect(stashCall).toBeUndefined();

    // Ensure we DO call git write-tree (content-based, deterministic)
    const writeTreeCall = vi.mocked(gitExecutor.executeGitCommand).mock.calls.find(
      ([args]) => args[0] === 'write-tree'
    );
    expect(writeTreeCall).toBeDefined();
  });

  it('should clean up temp index even if write-tree fails', async () => {
    mockInitialGitCommands()
      .mockImplementationOnce(() => {  // git write-tree throws
        throw new Error('write-tree failed');
      });

    await expect(getGitTreeHash()).rejects.toThrow();

    // Verify cleanup happened despite error (SECURITY: fs.unlinkSync in finally block)
    expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('vibe-validate-temp-index')
    );
  });

  describe('PID-based temp index naming', () => {
    it('should use PID suffix in temp index filename', async () => {
      mockStandardGitCommands();
      mockReaddirSync.mockReturnValue([]);

      await getGitTreeHash();

      // Verify temp index filename includes PID
      expect(mockCopyFileSync).toHaveBeenCalledWith(
        expect.stringContaining('index'),
        expect.stringMatching(/vibe-validate-temp-index-\d+$/)
      );
      expect(mockUnlinkSync).toHaveBeenCalledWith(
        expect.stringMatching(/vibe-validate-temp-index-\d+$/)
      );
    });

    it('should create unique temp index files for different processes', async () => {
      mockStandardGitCommands();
      mockReaddirSync.mockReturnValue([]);

      const originalPid = process.pid;
      try {
        // Simulate different PIDs
        Object.defineProperty(process, 'pid', { value: 12345, writable: true });
        await getGitTreeHash();
        const firstCall = mockCopyFileSync.mock.calls[0];

        vi.clearAllMocks();
        mockStandardGitCommands();
        mockReaddirSync.mockReturnValue([]);

        Object.defineProperty(process, 'pid', { value: 67890, writable: true });
        await getGitTreeHash();
        const secondCall = mockCopyFileSync.mock.calls[0];

        // Different PIDs should create different temp index files
        expect(firstCall[1]).toContain('vibe-validate-temp-index-12345');
        expect(secondCall[1]).toContain('vibe-validate-temp-index-67890');
        expect(firstCall[1]).not.toBe(secondCall[1]);
      } finally {
        Object.defineProperty(process, 'pid', { value: originalPid, writable: true });
      }
    });
  });

  describe('cleanupStaleIndexes', () => {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000 + 1000); // 5 minutes + 1 second ago
    const fourMinutesAgo = Date.now() - (4 * 60 * 1000); // 4 minutes ago

    beforeEach(() => {
      // Default: cleanup doesn't find any files
      mockReaddirSync.mockReturnValue([]);
      // Suppress console.warn in tests (we verify it was called, don't want noise)
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('should skip recent temp index files (< 5 minutes old)', async () => {
      mockStandardGitCommands();
      mockReaddirSync.mockReturnValue([
        'vibe-validate-temp-index-12345',
        'other-file.txt'
      ]);
      mockStatSync.mockReturnValue(createMockStats(fourMinutesAgo) as Stats);
      mockIsProcessRunning.mockReturnValue(false);

      await getGitTreeHash();

      // Should not clean up files younger than 5 minutes
      expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
      expect(mockUnlinkSync).not.toHaveBeenCalledWith(
        expect.stringContaining('vibe-validate-temp-index-12345')
      );
    });

    it('should skip temp index files from running processes', async () => {
      mockStandardGitCommands();
      mockReaddirSync.mockReturnValue(['vibe-validate-temp-index-12345']);
      mockStatSync.mockReturnValue(createMockStats(fiveMinutesAgo) as Stats);
      mockIsProcessRunning.mockReturnValue(true); // Process still running

      await getGitTreeHash();

      // Should not clean up files from running processes
      expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
      expect(mockUnlinkSync).not.toHaveBeenCalledWith(
        expect.stringContaining('vibe-validate-temp-index-12345')
      );
    });

    it('should remove old temp index files from dead processes', async () => {
      mockStandardGitCommands();
      mockReaddirSync.mockReturnValue([
        'vibe-validate-temp-index-12345',
        'other-file.txt'
      ]);
      mockStatSync.mockReturnValue(createMockStats(fiveMinutesAgo) as Stats);
      mockIsProcessRunning.mockReturnValue(false); // Process not running

      await getGitTreeHash();

      // Should clean up stale file AND current process temp index
      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
      expect(mockUnlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('vibe-validate-temp-index-12345')
      );
    });

    it('should warn when cleaning up stale files', async () => {
      const warnSpy = vi.spyOn(console, 'warn');
      mockStandardGitCommands();
      mockReaddirSync.mockReturnValue(['vibe-validate-temp-index-99999']);
      mockStatSync.mockReturnValue(createMockStats(fiveMinutesAgo) as Stats);
      mockIsProcessRunning.mockReturnValue(false);

      await getGitTreeHash();

      // Should warn about cleanup (bug detection canary)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up stale temp index from PID 99999')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('s old')
      );
    });

    it('should handle legacy temp index (no PID suffix)', async () => {
      const warnSpy = vi.spyOn(console, 'warn');
      mockStandardGitCommands();
      mockReaddirSync.mockReturnValue(['vibe-validate-temp-index']);
      mockStatSync.mockReturnValue(createMockStats(fiveMinutesAgo) as Stats);

      await getGitTreeHash();

      // Should clean up legacy temp index
      expect(mockUnlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('.git/vibe-validate-temp-index')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up legacy temp index')
      );
    });

    it('should skip recent legacy temp index', async () => {
      mockStandardGitCommands();
      mockReaddirSync.mockReturnValue(['vibe-validate-temp-index']);
      mockStatSync.mockReturnValue(createMockStats(fourMinutesAgo) as Stats);

      await getGitTreeHash();

      // Should not clean up recent legacy file
      // Only current process temp index cleanup (1 call)
      expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
      // Verify it's NOT the legacy file (no PID suffix) - should be current process file (has PID)
      const unlinkedPath = mockUnlinkSync.mock.calls[0][0];
      expect(unlinkedPath).toMatch(/vibe-validate-temp-index-\d+$/);
      expect(unlinkedPath).not.toMatch(/vibe-validate-temp-index$/);
    });

    it('should fail gracefully if cleanup fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn');
      mockStandardGitCommands();
      mockReaddirSync.mockReturnValue(['vibe-validate-temp-index-12345']);
      mockStatSync.mockReturnValue(createMockStats(fiveMinutesAgo) as Stats);
      mockIsProcessRunning.mockReturnValue(false);

      // Mock unlinkSync to fail for stale file but succeed for current process
      mockUnlinkSync.mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied');
      }).mockImplementationOnce(() => {
        // Current process cleanup succeeds
      });

      // Should not throw - cleanup failures are warnings only
      await expect(getGitTreeHash()).resolves.toBeDefined();

      // Should warn about cleanup failure
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clean up stale temp index')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('EACCES: permission denied')
      );
    });

    it('should handle errors reading file stats gracefully', async () => {
      mockStandardGitCommands();
      mockReaddirSync.mockReturnValue(['vibe-validate-temp-index-12345']);
      mockStatSync.mockImplementation(() => {
        throw new Error('File vanished');
      });

      // Should not throw - stat errors are ignored (file may have been deleted)
      await expect(getGitTreeHash()).resolves.toBeDefined();
    });

    it('should handle expected errors reading directory gracefully (ENOENT)', async () => {
      mockStandardGitCommands();
      const enoentError = new Error('ENOENT: directory not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      mockReaddirSync.mockImplementation(() => {
        throw enoentError;
      });

      // Should not throw - ENOENT is expected (fail-safe)
      await expect(getGitTreeHash()).resolves.toBeDefined();
    });

    it('should handle expected errors reading directory gracefully (ENOTDIR)', async () => {
      mockStandardGitCommands();
      const enotdirError = new Error('ENOTDIR: not a directory') as NodeJS.ErrnoException;
      enotdirError.code = 'ENOTDIR';
      mockReaddirSync.mockImplementation(() => {
        throw enotdirError;
      });

      // Should not throw - ENOTDIR is expected (fail-safe)
      await expect(getGitTreeHash()).resolves.toBeDefined();
    });

    it('should warn on unexpected errors reading directory (EPERM)', async () => {
      const warnSpy = vi.spyOn(console, 'warn');
      mockStandardGitCommands();
      const epermError = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException;
      epermError.code = 'EPERM';
      mockReaddirSync.mockImplementation(() => {
        throw epermError;
      });

      // Should not throw - unexpected errors are warnings (fail-safe)
      await expect(getGitTreeHash()).resolves.toBeDefined();

      // Should warn about unexpected error (debugging aid)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unexpected error during temp index cleanup')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('EPERM: operation not permitted')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('This may indicate a bug')
      );
    });

    it('should clean up multiple stale files', async () => {
      mockStandardGitCommands();
      mockReaddirSync.mockReturnValue([
        'vibe-validate-temp-index-11111',
        'vibe-validate-temp-index-22222',
        'vibe-validate-temp-index-33333',
        'other-file.txt'
      ]);
      mockStatSync.mockReturnValue(createMockStats(fiveMinutesAgo) as Stats);
      mockIsProcessRunning.mockReturnValue(false);

      await getGitTreeHash();

      // Should clean up all 3 stale files + current process temp index
      expect(mockUnlinkSync).toHaveBeenCalledTimes(4);
      expect(mockUnlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('vibe-validate-temp-index-11111')
      );
      expect(mockUnlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('vibe-validate-temp-index-22222')
      );
      expect(mockUnlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('vibe-validate-temp-index-33333')
      );
    });

    it('should ignore non-temp-index files', async () => {
      mockStandardGitCommands();
      mockReaddirSync.mockReturnValue([
        'index',
        'HEAD',
        'config',
        'vibe-validate-something-else',
        'temp-index-12345'
      ]);

      await getGitTreeHash();

      // Should only clean up current process temp index (not other files)
      expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
      expect(mockStatSync).not.toHaveBeenCalled();
    });
  });
});
