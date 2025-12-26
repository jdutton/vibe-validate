/**
 * Tests for deterministic git tree hash calculation
 *
 * CRITICAL: Git tree hash must be deterministic (content-based, no timestamps)
 * to ensure validation state caching works correctly across runs.
 */

import { copyFileSync, existsSync, unlinkSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as gitExecutor from '../src/git-executor.js';
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
}));

const mockCopyFileSync = copyFileSync as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockUnlinkSync = unlinkSync as ReturnType<typeof vi.fn>;

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
    expect((writeTreeCall?.[1] as any).env).toHaveProperty('GIT_INDEX_FILE');

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
});
