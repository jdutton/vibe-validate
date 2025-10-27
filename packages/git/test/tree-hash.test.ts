/**
 * Tests for deterministic git tree hash calculation
 *
 * CRITICAL: Git tree hash must be deterministic (content-based, no timestamps)
 * to ensure validation state caching works correctly across runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { copyFileSync, unlinkSync } from 'fs';
import { getGitTreeHash } from '../src/tree-hash.js';

// Mock execSync
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Mock fs operations (SECURITY: We use fs instead of shell commands)
vi.mock('fs', () => ({
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

const mockExecSync = execSync as ReturnType<typeof vi.fn>;
const mockCopyFileSync = copyFileSync as ReturnType<typeof vi.fn>;
const mockUnlinkSync = unlinkSync as ReturnType<typeof vi.fn>;

describe('getGitTreeHash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should calculate tree hash using git write-tree', async () => {
    // Mock git commands (return strings since encoding: 'utf8' is set)
    mockExecSync.mockReturnValueOnce('');  // git rev-parse --is-inside-work-tree
    mockExecSync.mockReturnValueOnce('.git');  // git rev-parse --git-dir
    mockExecSync.mockReturnValueOnce('');  // git add --all (with temp index)
    mockExecSync.mockReturnValueOnce('abc123def456\n');  // git write-tree (with temp index)

    const hash = await getGitTreeHash();

    expect(hash).toBe('abc123def456');

    // Verify correct git commands were called (4 times, not 6 - fs operations not via execSync)
    expect(mockExecSync).toHaveBeenCalledTimes(4);

    // Verify fs.copyFileSync was called (SECURITY: replaces cp shell command)
    expect(mockCopyFileSync).toHaveBeenCalledTimes(1);
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('index'),
      expect.stringContaining('vibe-validate-temp-index')
    );

    // Verify correct git commands were called
    expect(mockExecSync).toHaveBeenNthCalledWith(
      1,
      'git rev-parse --is-inside-work-tree',
      expect.any(Object)
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      'git rev-parse --git-dir',
      expect.any(Object)
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      3,
      'git add --all',
      expect.objectContaining({
        env: expect.objectContaining({
          GIT_INDEX_FILE: expect.stringContaining('vibe-validate-temp-index')
        })
      })
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      4,
      'git write-tree',
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
    mockExecSync
      .mockReturnValueOnce('')  // git rev-parse --is-inside-work-tree (1st run)
      .mockReturnValueOnce('.git')  // git rev-parse --git-dir (1st run)
      .mockReturnValueOnce('')  // git add (1st run)
      .mockReturnValueOnce('sameHash123\n')  // git write-tree (1st run)
      .mockReturnValueOnce('')  // git rev-parse --is-inside-work-tree (2nd run)
      .mockReturnValueOnce('.git')  // git rev-parse --git-dir (2nd run)
      .mockReturnValueOnce('')  // git add (2nd run)
      .mockReturnValueOnce('sameHash123\n');  // git write-tree (2nd run)

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
    mockExecSync.mockImplementation((cmd) => {
      if (cmd === 'git write-tree') {
        return 'abc123\n';
      }
      if (cmd === 'git rev-parse --git-dir') {
        return '.git';
      }
      return '';
    });

    await getGitTreeHash();

    // Verify temp index is created (SECURITY: fs.copyFileSync instead of cp)
    expect(mockCopyFileSync).toHaveBeenCalledTimes(1);
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('index'),
      expect.stringContaining('vibe-validate-temp-index')
    );

    // Verify GIT_INDEX_FILE is used for git operations
    const writeTreeCall = mockExecSync.mock.calls.find(
      ([cmd]) => cmd === 'git write-tree'
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
    mockExecSync
      .mockReturnValueOnce('')  // git rev-parse --is-inside-work-tree
      .mockReturnValueOnce('.git')  // git rev-parse --git-dir
      .mockReturnValueOnce('')  // git add
      .mockReturnValueOnce('  abc123  \n\n');  // git write-tree

    const hash = await getGitTreeHash();

    expect(hash).toBe('abc123');
  });

  it('should handle git errors gracefully', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('git command failed');
    });

    await expect(getGitTreeHash()).rejects.toThrow('Failed to calculate git tree hash');
  });

  it('should handle empty repository', async () => {
    mockExecSync
      .mockReturnValueOnce('')  // git rev-parse --is-inside-work-tree
      .mockReturnValueOnce('.git')  // git rev-parse --git-dir
      .mockReturnValueOnce('')  // git add
      .mockReturnValueOnce('4b825dc642cb6eb9a060e54bf8d69288fbee4904\n');  // git write-tree (empty tree)

    const hash = await getGitTreeHash();

    expect(hash).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  });

  it('should not include timestamps in hash', async () => {
    // This is a critical test - hash should be content-based only
    // We verify this by checking that git write-tree is used (not git stash create)
    mockExecSync.mockReturnValue('abc123\n');
    mockExecSync.mockReturnValueOnce('');  // git rev-parse --is-inside-work-tree
    mockExecSync.mockReturnValueOnce('.git');  // git rev-parse --git-dir

    await getGitTreeHash();

    // Ensure we never call git stash create (which includes timestamps)
    const stashCall = mockExecSync.mock.calls.find(
      ([cmd]) => typeof cmd === 'string' && cmd.includes('stash create')
    );
    expect(stashCall).toBeUndefined();

    // Ensure we DO call git write-tree (content-based, deterministic)
    const writeTreeCall = mockExecSync.mock.calls.find(
      ([cmd]) => cmd === 'git write-tree'
    );
    expect(writeTreeCall).toBeDefined();
  });

  it('should clean up temp index even if write-tree fails', async () => {
    mockExecSync
      .mockReturnValueOnce('')  // git rev-parse --is-inside-work-tree
      .mockReturnValueOnce('.git')  // git rev-parse --git-dir
      .mockReturnValueOnce('')  // git add
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
