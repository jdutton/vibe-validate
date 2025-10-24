/**
 * Tests for deterministic git tree hash calculation
 *
 * CRITICAL: Git tree hash must be deterministic (content-based, no timestamps)
 * to ensure validation state caching works correctly across runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { getGitTreeHash } from '../src/tree-hash.js';

// Mock execSync
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = execSync as ReturnType<typeof vi.fn>;

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
    mockExecSync.mockReturnValueOnce('');  // cp index to temp
    mockExecSync.mockReturnValueOnce('');  // git add --intent-to-add (with temp index)
    mockExecSync.mockReturnValueOnce('abc123def456\n');  // git write-tree (with temp index)
    mockExecSync.mockReturnValueOnce('');  // rm temp index

    const hash = await getGitTreeHash();

    expect(hash).toBe('abc123def456');
    expect(mockExecSync).toHaveBeenCalledTimes(6);

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
      expect.stringContaining('cp'),
      expect.any(Object)
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      4,
      'git add --all',
      expect.objectContaining({
        env: expect.objectContaining({
          GIT_INDEX_FILE: expect.stringContaining('vibe-validate-temp-index')
        })
      })
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      5,
      'git write-tree',
      expect.objectContaining({
        env: expect.objectContaining({
          GIT_INDEX_FILE: expect.stringContaining('vibe-validate-temp-index')
        })
      })
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining('rm -f'),
      expect.any(Object)
    );
  });

  it('should return same hash for identical content', async () => {
    // Simulate running twice with same content
    mockExecSync
      .mockReturnValueOnce('')  // git rev-parse --is-inside-work-tree (1st run)
      .mockReturnValueOnce('.git')  // git rev-parse --git-dir (1st run)
      .mockReturnValueOnce('')  // cp (1st run)
      .mockReturnValueOnce('')  // git add (1st run)
      .mockReturnValueOnce('sameHash123\n')  // git write-tree (1st run)
      .mockReturnValueOnce('')  // rm (1st run)
      .mockReturnValueOnce('')  // git rev-parse --is-inside-work-tree (2nd run)
      .mockReturnValueOnce('.git')  // git rev-parse --git-dir (2nd run)
      .mockReturnValueOnce('')  // cp (2nd run)
      .mockReturnValueOnce('')  // git add (2nd run)
      .mockReturnValueOnce('sameHash123\n')  // git write-tree (2nd run)
      .mockReturnValueOnce('');  // rm (2nd run)

    const hash1 = await getGitTreeHash();
    const hash2 = await getGitTreeHash();

    expect(hash1).toBe('sameHash123');
    expect(hash2).toBe('sameHash123');
    expect(hash1).toBe(hash2);
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

    // Verify temp index is created (cp command)
    const cpCall = mockExecSync.mock.calls.find(
      ([cmd]) => typeof cmd === 'string' && cmd.includes('cp')
    );
    expect(cpCall).toBeDefined();
    expect(cpCall?.[0]).toContain('vibe-validate-temp-index');

    // Verify GIT_INDEX_FILE is used for git operations
    const writeTreeCall = mockExecSync.mock.calls.find(
      ([cmd]) => cmd === 'git write-tree'
    );
    expect(writeTreeCall?.[1]).toHaveProperty('env');
    expect((writeTreeCall?.[1] as any).env).toHaveProperty('GIT_INDEX_FILE');

    // Verify temp index is cleaned up (rm command)
    const rmCall = mockExecSync.mock.calls.find(
      ([cmd]) => typeof cmd === 'string' && cmd.includes('rm -f')
    );
    expect(rmCall).toBeDefined();
    expect(rmCall?.[0]).toContain('vibe-validate-temp-index');
  });

  it('should trim whitespace from hash', async () => {
    mockExecSync
      .mockReturnValueOnce('')  // git rev-parse --is-inside-work-tree
      .mockReturnValueOnce('.git')  // git rev-parse --git-dir
      .mockReturnValueOnce('')  // cp
      .mockReturnValueOnce('')  // git add
      .mockReturnValueOnce('  abc123  \n\n')  // git write-tree
      .mockReturnValueOnce('');  // rm

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
      .mockReturnValueOnce('')  // cp
      .mockReturnValueOnce('')  // git add
      .mockReturnValueOnce('4b825dc642cb6eb9a060e54bf8d69288fbee4904\n')  // git write-tree (empty tree)
      .mockReturnValueOnce('');  // rm

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
      .mockReturnValueOnce('')  // cp
      .mockReturnValueOnce('')  // git add
      .mockImplementationOnce(() => {  // git write-tree throws
        throw new Error('write-tree failed');
      })
      .mockReturnValueOnce('');  // rm (should still be called in finally block)

    await expect(getGitTreeHash()).rejects.toThrow();

    // Verify cleanup happened despite error
    const rmCall = mockExecSync.mock.calls.find(
      ([cmd]) => typeof cmd === 'string' && cmd.includes('rm -f')
    );
    expect(rmCall).toBeDefined();
  });
});
