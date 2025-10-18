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
    mockExecSync.mockReturnValueOnce('');  // git add --intent-to-add
    mockExecSync.mockReturnValueOnce('abc123def456\n');  // git write-tree
    mockExecSync.mockReturnValueOnce('');  // git reset

    const hash = await getGitTreeHash();

    expect(hash).toBe('abc123def456');
    expect(mockExecSync).toHaveBeenCalledTimes(4);

    // Verify correct git commands were called
    expect(mockExecSync).toHaveBeenNthCalledWith(
      1,
      'git rev-parse --is-inside-work-tree',
      expect.any(Object)
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      'git add --intent-to-add --all --force',
      expect.any(Object)
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      3,
      'git write-tree',
      expect.any(Object)
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      4,
      'git reset',
      expect.any(Object)
    );
  });

  it('should return same hash for identical content', async () => {
    // Simulate running twice with same content
    mockExecSync
      .mockReturnValueOnce('')  // git rev-parse (1st run)
      .mockReturnValueOnce('')  // git add (1st run)
      .mockReturnValueOnce('sameHash123\n')  // git write-tree (1st run)
      .mockReturnValueOnce('')  // git reset (1st run)
      .mockReturnValueOnce('')  // git rev-parse (2nd run)
      .mockReturnValueOnce('')  // git add (2nd run)
      .mockReturnValueOnce('sameHash123\n')  // git write-tree (2nd run)
      .mockReturnValueOnce('');  // git reset (2nd run)

    const hash1 = await getGitTreeHash();
    const hash2 = await getGitTreeHash();

    expect(hash1).toBe('sameHash123');
    expect(hash2).toBe('sameHash123');
    expect(hash1).toBe(hash2);
  });

  it('should restore index after calculating hash', async () => {
    mockExecSync.mockImplementation((cmd) => {
      if (cmd === 'git write-tree') {
        return 'abc123\n';
      }
      return '';
    });

    await getGitTreeHash();

    // Verify git reset was called to restore index
    const resetCall = mockExecSync.mock.calls.find(
      ([cmd]) => cmd === 'git reset'
    );
    expect(resetCall).toBeDefined();
  });

  it('should trim whitespace from hash', async () => {
    mockExecSync
      .mockReturnValueOnce('')  // git rev-parse
      .mockReturnValueOnce('')  // git add
      .mockReturnValueOnce('  abc123  \n\n')  // git write-tree
      .mockReturnValueOnce('');  // git reset

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
      .mockReturnValueOnce('')  // git rev-parse
      .mockReturnValueOnce('')  // git add
      .mockReturnValueOnce('4b825dc642cb6eb9a060e54bf8d69288fbee4904\n')  // git write-tree (empty tree)
      .mockReturnValueOnce('');  // git reset

    const hash = await getGitTreeHash();

    expect(hash).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  });

  it('should not include timestamps in hash', async () => {
    // This is a critical test - hash should be content-based only
    // We verify this by checking that git write-tree is used (not git stash create)
    mockExecSync.mockReturnValue('abc123\n');

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
});
