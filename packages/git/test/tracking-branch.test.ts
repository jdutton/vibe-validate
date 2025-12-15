/**
 * Tests for checking if current branch is behind its remote tracking branch
 *
 * CRITICAL: If someone else pushes to origin/fix-issue-X while you're working
 * on local fix-issue-X, you need to pull before committing to avoid conflicts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as gitExecutor from '../src/git-executor.js';
import { isCurrentBranchBehindTracking } from '../src/tracking-branch.js';

// Mock git-executor
vi.mock('../src/git-executor.js', () => ({
  executeGitCommand: vi.fn(),
}));

describe('isCurrentBranchBehindTracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when branch has no upstream tracking branch', () => {
    // Mock: git rev-parse --abbrev-ref --symbolic-full-name @{u}
    vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({
      success: false,
      stdout: '',
      stderr: 'fatal: no upstream configured for branch',
      exitCode: 128,
    });

    const result = isCurrentBranchBehindTracking();

    expect(result).toBeNull();
    expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      expect.any(Object)
    );
  });

  it('should return 0 when branch is up to date with tracking branch', () => {
    // Mock: git rev-parse --abbrev-ref --symbolic-full-name @{u}
    vi.mocked(gitExecutor.executeGitCommand)
      .mockReturnValueOnce({
        success: true,
        stdout: 'origin/fix-issue-X\n',
        stderr: '',
        exitCode: 0,
      })
      .mockReturnValueOnce({
        success: true,
        stdout: '0\n',
        stderr: '',
        exitCode: 0,
      });

    const result = isCurrentBranchBehindTracking();

    expect(result).toBe(0);
    expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(
      1,
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      expect.any(Object)
    );
    expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(
      2,
      ['rev-list', '--count', 'HEAD..@{u}'],
      expect.any(Object)
    );
  });

  it('should return commit count when branch is behind tracking branch', () => {
    // Mock: git rev-parse --abbrev-ref --symbolic-full-name @{u}
    vi.mocked(gitExecutor.executeGitCommand)
      .mockReturnValueOnce({
        success: true,
        stdout: 'origin/fix-issue-X\n',
        stderr: '',
        exitCode: 0,
      })
      .mockReturnValueOnce({
        success: true,
        stdout: '3\n',
        stderr: '',
        exitCode: 0,
      });

    const result = isCurrentBranchBehindTracking();

    expect(result).toBe(3);
  });

  it('should handle main branch with tracking', () => {
    // Mock: git rev-parse --abbrev-ref --symbolic-full-name @{u}
    vi.mocked(gitExecutor.executeGitCommand)
      .mockReturnValueOnce({
        success: true,
        stdout: 'origin/main\n',
        stderr: '',
        exitCode: 0,
      })
      .mockReturnValueOnce({
        success: true,
        stdout: '0\n',
        stderr: '',
        exitCode: 0,
      });

    const result = isCurrentBranchBehindTracking();

    expect(result).toBe(0);
  });

  it('should return null on git command error (not "no upstream" error)', () => {
    // Mock: git rev-parse throws unexpected error
    vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({
      success: false,
      stdout: '',
      stderr: 'Not a git repository',
      exitCode: 128,
    });

    const result = isCurrentBranchBehindTracking();

    expect(result).toBeNull();
  });

  it('should handle whitespace in git output', () => {
    // Mock: git rev-parse with extra whitespace
    vi.mocked(gitExecutor.executeGitCommand)
      .mockReturnValueOnce({
        success: true,
        stdout: '  origin/fix-issue-X  \n\n',
        stderr: '',
        exitCode: 0,
      })
      .mockReturnValueOnce({
        success: true,
        stdout: '  2  \n',
        stderr: '',
        exitCode: 0,
      });

    const result = isCurrentBranchBehindTracking();

    expect(result).toBe(2);
  });

  it('should return 0 for invalid commit count (defensive)', () => {
    // Mock: git rev-parse
    vi.mocked(gitExecutor.executeGitCommand)
      .mockReturnValueOnce({
        success: true,
        stdout: 'origin/fix-issue-X\n',
        stderr: '',
        exitCode: 0,
      })
      .mockReturnValueOnce({
        success: true,
        stdout: 'invalid\n',
        stderr: '',
        exitCode: 0,
      });

    const result = isCurrentBranchBehindTracking();

    expect(result).toBe(0);
  });
});
