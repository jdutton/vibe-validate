/**
 * Tests for git staging detection
 *
 * CRITICAL: Partially staged files (some changes staged, others unstaged)
 * are incompatible with validation - we validate the full working tree
 * but git commits only the staged portion. This must be detected and blocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { getPartiallyStagedFiles } from '../src/staging.js';

// Mock execSync
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = execSync as ReturnType<typeof vi.fn>;

describe('getPartiallyStagedFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when no files are staged', () => {
    // Mock: git diff --name-only --cached (staged files)
    mockExecSync.mockReturnValueOnce('');

    const result = getPartiallyStagedFiles();

    expect(result).toEqual([]);
    expect(mockExecSync).toHaveBeenCalledWith(
      'git diff --name-only --cached',
      expect.any(Object)
    );
  });

  it('should return empty array when all staged files are fully staged', () => {
    // Mock: git diff --name-only --cached (staged files)
    mockExecSync.mockReturnValueOnce('file1.ts\nfile2.ts\n');

    // Mock: git diff --name-only (unstaged files)
    mockExecSync.mockReturnValueOnce('file3.ts\n');

    const result = getPartiallyStagedFiles();

    expect(result).toEqual([]);
    expect(mockExecSync).toHaveBeenNthCalledWith(
      1,
      'git diff --name-only --cached',
      expect.any(Object)
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      'git diff --name-only',
      expect.any(Object)
    );
  });

  it('should detect single file with partially staged changes', () => {
    // Mock: git diff --name-only --cached (staged files)
    mockExecSync.mockReturnValueOnce('file1.ts\n');

    // Mock: git diff --name-only (unstaged files) - file1.ts appears here too!
    mockExecSync.mockReturnValueOnce('file1.ts\n');

    const result = getPartiallyStagedFiles();

    expect(result).toEqual(['file1.ts']);
  });

  it('should detect multiple files with partially staged changes', () => {
    // Mock: git diff --name-only --cached (staged files)
    mockExecSync.mockReturnValueOnce('file1.ts\nfile2.ts\nfile3.ts\n');

    // Mock: git diff --name-only (unstaged files) - file1 and file3 have unstaged changes
    mockExecSync.mockReturnValueOnce('file1.ts\nfile3.ts\n');

    const result = getPartiallyStagedFiles();

    expect(result).toEqual(['file1.ts', 'file3.ts']);
  });

  it('should handle files with spaces in names', () => {
    // Mock: git diff --name-only --cached (staged files)
    mockExecSync.mockReturnValueOnce('file with spaces.ts\n');

    // Mock: git diff --name-only (unstaged files)
    mockExecSync.mockReturnValueOnce('file with spaces.ts\n');

    const result = getPartiallyStagedFiles();

    expect(result).toEqual(['file with spaces.ts']);
  });

  it('should handle mixed scenario - some fully staged, some partially staged, some only unstaged', () => {
    // Scenario:
    // - file1.ts: fully staged (in cached, not in unstaged)
    // - file2.ts: partially staged (in both cached and unstaged)
    // - file3.ts: only unstaged (not in cached, in unstaged)
    // - file4.ts: partially staged (in both cached and unstaged)

    // Mock: git diff --name-only --cached (staged files)
    mockExecSync.mockReturnValueOnce('file1.ts\nfile2.ts\nfile4.ts\n');

    // Mock: git diff --name-only (unstaged files)
    mockExecSync.mockReturnValueOnce('file2.ts\nfile3.ts\nfile4.ts\n');

    const result = getPartiallyStagedFiles();

    // Only file2 and file4 should be detected (appear in both lists)
    expect(result).toEqual(['file2.ts', 'file4.ts']);
  });

  it('should return empty array on git command error', () => {
    // Mock: git diff --name-only --cached throws error
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('Not a git repository');
    });

    const result = getPartiallyStagedFiles();

    expect(result).toEqual([]);
  });

  it('should handle empty lines in git output', () => {
    // Mock: git diff --name-only --cached with extra newlines
    mockExecSync.mockReturnValueOnce('file1.ts\n\n\nfile2.ts\n\n');

    // Mock: git diff --name-only
    mockExecSync.mockReturnValueOnce('file1.ts\n\n');

    const result = getPartiallyStagedFiles();

    expect(result).toEqual(['file1.ts']);
  });

  it('should handle paths with directories', () => {
    // Mock: git diff --name-only --cached
    mockExecSync.mockReturnValueOnce('src/components/Button.tsx\npackages/core/src/runner.ts\n');

    // Mock: git diff --name-only
    mockExecSync.mockReturnValueOnce('src/components/Button.tsx\n');

    const result = getPartiallyStagedFiles();

    expect(result).toEqual(['src/components/Button.tsx']);
  });
});
