/**
 * Tests for checking if current branch is behind its remote tracking branch
 *
 * CRITICAL: If someone else pushes to origin/fix-issue-X while you're working
 * on local fix-issue-X, you need to pull before committing to avoid conflicts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { isCurrentBranchBehindTracking } from '../src/tracking-branch.js';

// Mock execSync
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = execSync as ReturnType<typeof vi.fn>;

describe('isCurrentBranchBehindTracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when branch has no upstream tracking branch', () => {
    // Mock: git rev-parse --abbrev-ref --symbolic-full-name @{u}
    mockExecSync.mockImplementationOnce(() => {
      const error = new Error('fatal: no upstream configured for branch') as Error & { status: number };
      error.status = 128;
      throw error;
    });

    const result = isCurrentBranchBehindTracking();

    expect(result).toBeNull();
    expect(mockExecSync).toHaveBeenCalledWith(
      'git rev-parse --abbrev-ref --symbolic-full-name @{u}',
      expect.any(Object)
    );
  });

  it('should return 0 when branch is up to date with tracking branch', () => {
    // Mock: git rev-parse --abbrev-ref --symbolic-full-name @{u}
    mockExecSync.mockReturnValueOnce('origin/fix-issue-X\n');

    // Mock: git rev-list --count HEAD..@{u}
    mockExecSync.mockReturnValueOnce('0\n');

    const result = isCurrentBranchBehindTracking();

    expect(result).toBe(0);
    expect(mockExecSync).toHaveBeenNthCalledWith(
      1,
      'git rev-parse --abbrev-ref --symbolic-full-name @{u}',
      expect.any(Object)
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      'git rev-list --count HEAD..@{u}',
      expect.any(Object)
    );
  });

  it('should return commit count when branch is behind tracking branch', () => {
    // Mock: git rev-parse --abbrev-ref --symbolic-full-name @{u}
    mockExecSync.mockReturnValueOnce('origin/fix-issue-X\n');

    // Mock: git rev-list --count HEAD..@{u}
    mockExecSync.mockReturnValueOnce('3\n'); // Behind by 3 commits

    const result = isCurrentBranchBehindTracking();

    expect(result).toBe(3);
  });

  it('should handle main branch with tracking', () => {
    // Mock: git rev-parse --abbrev-ref --symbolic-full-name @{u}
    mockExecSync.mockReturnValueOnce('origin/main\n');

    // Mock: git rev-list --count HEAD..@{u}
    mockExecSync.mockReturnValueOnce('0\n');

    const result = isCurrentBranchBehindTracking();

    expect(result).toBe(0);
  });

  it('should return null on git command error (not "no upstream" error)', () => {
    // Mock: git rev-parse throws unexpected error
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('Not a git repository');
    });

    const result = isCurrentBranchBehindTracking();

    expect(result).toBeNull();
  });

  it('should handle whitespace in git output', () => {
    // Mock: git rev-parse with extra whitespace
    mockExecSync.mockReturnValueOnce('  origin/fix-issue-X  \n\n');

    // Mock: git rev-list with extra whitespace
    mockExecSync.mockReturnValueOnce('  2  \n');

    const result = isCurrentBranchBehindTracking();

    expect(result).toBe(2);
  });

  it('should return 0 for invalid commit count (defensive)', () => {
    // Mock: git rev-parse
    mockExecSync.mockReturnValueOnce('origin/fix-issue-X\n');

    // Mock: git rev-list returns non-numeric value (should never happen)
    mockExecSync.mockReturnValueOnce('invalid\n');

    const result = isCurrentBranchBehindTracking();

    expect(result).toBe(0);
  });
});
