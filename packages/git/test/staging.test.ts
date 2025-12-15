/**
 * Tests for git staging detection
 *
 * CRITICAL: Partially staged files (some changes staged, others unstaged)
 * are incompatible with validation - we validate the full working tree
 * but git commits only the staged portion. This must be detected and blocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as gitExecutor from '../src/git-executor.js';
import { getPartiallyStagedFiles } from '../src/staging.js';

// Mock git-executor
vi.mock('../src/git-executor.js', () => ({
  executeGitCommand: vi.fn(),
}));

/**
 * Helper to mock git diff output for staged and unstaged files
 */
function mockGitDiff(stagedFiles: string, unstagedFiles: string): void {
  vi.mocked(gitExecutor.executeGitCommand)
    .mockReturnValueOnce({
      success: true,
      stdout: stagedFiles,
      stderr: '',
      exitCode: 0,
    })
    .mockReturnValueOnce({
      success: true,
      stdout: unstagedFiles,
      stderr: '',
      exitCode: 0,
    });
}

describe('getPartiallyStagedFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when no files are staged', () => {
    vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
    expect(getPartiallyStagedFiles()).toEqual([]);
    expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(['diff', '--name-only', '--cached'], expect.any(Object));
  });

  it('should return empty array when all staged files are fully staged', () => {
    mockGitDiff('file1.ts\nfile2.ts\n', 'file3.ts\n');
    expect(getPartiallyStagedFiles()).toEqual([]);
  });

  it('should detect single file with partially staged changes', () => {
    mockGitDiff('file1.ts\n', 'file1.ts\n');
    expect(getPartiallyStagedFiles()).toEqual(['file1.ts']);
  });

  it('should detect multiple files with partially staged changes', () => {
    mockGitDiff('file1.ts\nfile2.ts\nfile3.ts\n', 'file1.ts\nfile3.ts\n');
    expect(getPartiallyStagedFiles()).toEqual(['file1.ts', 'file3.ts']);
  });

  it('should handle files with spaces in names', () => {
    mockGitDiff('file with spaces.ts\n', 'file with spaces.ts\n');
    expect(getPartiallyStagedFiles()).toEqual(['file with spaces.ts']);
  });

  it('should handle mixed scenario - some fully staged, some partially staged, some only unstaged', () => {
    // file1: fully staged, file2/file4: partially staged, file3: only unstaged
    mockGitDiff('file1.ts\nfile2.ts\nfile4.ts\n', 'file2.ts\nfile3.ts\nfile4.ts\n');
    expect(getPartiallyStagedFiles()).toEqual(['file2.ts', 'file4.ts']);
  });

  it('should return empty array on git command error', () => {
    vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({
      success: false,
      stdout: '',
      stderr: 'Not a git repository',
      exitCode: 128,
    });
    expect(getPartiallyStagedFiles()).toEqual([]);
  });

  it('should handle empty lines in git output', () => {
    mockGitDiff('file1.ts\n\n\nfile2.ts\n\n', 'file1.ts\n\n');
    expect(getPartiallyStagedFiles()).toEqual(['file1.ts']);
  });

  it('should handle paths with directories', () => {
    mockGitDiff('src/components/Button.tsx\npackages/core/src/runner.ts\n', 'src/components/Button.tsx\n');
    expect(getPartiallyStagedFiles()).toEqual(['src/components/Button.tsx']);
  });
});
