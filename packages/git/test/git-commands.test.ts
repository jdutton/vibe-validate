/**
 * Tests for Git Command Utilities
 *
 * Tests the high-level git command wrappers that build on git-executor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  isGitRepository,
  getGitDir,
  getRepositoryRoot,
  getCurrentBranch,
  getRemoteUrl,
  getHeadCommitSha,
  getHeadTreeSha,
  verifyRef,
  verifyRefOrThrow,
  hasNotesRef,
  isMergeInProgress,
  getDiffStats,
  getCommitCount,
  getNotesRefs,
} from '../src/git-commands.js';
import * as gitExecutor from '../src/git-executor.js';

// Mock git-executor
vi.mock('../src/git-executor.js', async () => {
  const actual = await vi.importActual('../src/git-executor.js');
  return {
    ...actual,
    execGitCommand: vi.fn(),
    tryGitCommand: vi.fn(),
  };
});

describe('git-commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isGitRepository', () => {
    it('should return true when inside a git repository', () => {
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = isGitRepository();

      expect(gitExecutor.tryGitCommand).toHaveBeenCalledWith(['rev-parse', '--is-inside-work-tree']);
      expect(result).toBe(true);
    });

    it('should return false when not inside a git repository', () => {
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(false);

      const result = isGitRepository();

      expect(result).toBe(false);
    });
  });

  describe('getGitDir', () => {
    it('should return the .git directory path', () => {
      const mockPath = '/path/to/repo/.git';
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue(mockPath);

      const result = getGitDir();

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['rev-parse', '--git-dir']);
      expect(result).toBe(mockPath);
    });
  });

  describe('getRepositoryRoot', () => {
    it('should return the repository root path', () => {
      const mockRoot = '/path/to/repo';
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue(mockRoot);

      const result = getRepositoryRoot();

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['rev-parse', '--show-toplevel']);
      expect(result).toBe(mockRoot);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return the current branch name', () => {
      const mockBranch = 'feature/test';
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue(mockBranch);

      const result = getCurrentBranch();

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['rev-parse', '--abbrev-ref', 'HEAD']);
      expect(result).toBe(mockBranch);
    });

    it('should handle main branch', () => {
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue('main');

      const result = getCurrentBranch();

      expect(result).toBe('main');
    });
  });

  describe('getRemoteUrl', () => {
    it('should return the URL of origin remote by default', () => {
      const mockUrl = 'git@github.com:owner/repo.git';
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue(mockUrl);

      const result = getRemoteUrl();

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['remote', 'get-url', 'origin']);
      expect(result).toBe(mockUrl);
    });

    it('should return the URL of a specified remote', () => {
      const mockUrl = 'git@github.com:owner/repo.git';
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue(mockUrl);

      const result = getRemoteUrl('upstream');

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['remote', 'get-url', 'upstream']);
      expect(result).toBe(mockUrl);
    });
  });

  describe('getHeadCommitSha', () => {
    it('should return the full SHA of HEAD', () => {
      const mockSha = 'abc123def456';
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue(mockSha);

      const result = getHeadCommitSha();

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['rev-parse', 'HEAD']);
      expect(result).toBe(mockSha);
    });
  });

  describe('getHeadTreeSha', () => {
    it('should return the tree hash of HEAD', () => {
      const mockTreeSha = 'tree123abc456';
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue(mockTreeSha);

      const result = getHeadTreeSha();

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['rev-parse', 'HEAD^{tree}']);
      expect(result).toBe(mockTreeSha);
    });
  });

  describe('verifyRef', () => {
    it('should return true when reference exists', () => {
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = verifyRef('main');

      expect(gitExecutor.tryGitCommand).toHaveBeenCalledWith(['rev-parse', '--verify', 'main']);
      expect(result).toBe(true);
    });

    it('should return false when reference does not exist', () => {
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(false);

      const result = verifyRef('nonexistent-branch');

      expect(result).toBe(false);
    });

    it('should verify commit SHAs', () => {
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = verifyRef('abc123');

      expect(result).toBe(true);
    });
  });

  describe('verifyRefOrThrow', () => {
    it('should return SHA when reference exists', () => {
      const mockSha = 'abc123def456';
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue(mockSha);

      const result = verifyRefOrThrow('main');

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['rev-parse', '--verify', 'main']);
      expect(result).toBe(mockSha);
    });

    it('should throw when reference does not exist', () => {
      vi.mocked(gitExecutor.execGitCommand).mockImplementation(() => {
        throw new Error('fatal: Needed a single revision');
      });

      expect(() => {
        verifyRefOrThrow('nonexistent');
      }).toThrow();
    });
  });

  describe('hasNotesRef', () => {
    it('should return true when notes ref exists', () => {
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = hasNotesRef('refs/notes/vibe-validate/validate');

      expect(gitExecutor.tryGitCommand).toHaveBeenCalledWith([
        'rev-parse',
        '--verify',
        'refs/notes/vibe-validate/validate',
      ]);
      expect(result).toBe(true);
    });

    it('should return false when notes ref does not exist', () => {
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(false);

      const result = hasNotesRef('refs/notes/nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('isMergeInProgress', () => {
    it('should return true when merge is in progress', () => {
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = isMergeInProgress();

      expect(gitExecutor.tryGitCommand).toHaveBeenCalledWith(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']);
      expect(result).toBe(true);
    });

    it('should return false when no merge is in progress', () => {
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(false);

      const result = isMergeInProgress();

      expect(result).toBe(false);
    });
  });

  describe('getDiffStats', () => {
    it('should return diff statistics between refs', () => {
      const mockStats = '5\t3\tfile1.ts\n2\t1\tfile2.ts';
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue(mockStats);

      const result = getDiffStats('origin/main');

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['diff', '--numstat', 'origin/main...HEAD']);
      expect(result).toBe(mockStats);
    });

    it('should use custom head ref', () => {
      const mockStats = '5\t3\tfile1.ts';
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue(mockStats);

      getDiffStats('origin/main', 'feature/test');

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['diff', '--numstat', 'origin/main...feature/test']);
    });
  });

  describe('getCommitCount', () => {
    it('should return commit count between refs', () => {
      const mockCount = '5';
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue(mockCount);

      const result = getCommitCount('origin/main');

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['rev-list', '--count', 'origin/main...HEAD']);
      expect(result).toBe(mockCount);
    });

    it('should use custom head ref', () => {
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue('3');

      getCommitCount('origin/main', 'feature/test');

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['rev-list', '--count', 'origin/main...feature/test']);
    });
  });

  describe('getNotesRefs', () => {
    it('should list notes refs matching pattern', () => {
      const mockRefs = 'refs/notes/vibe-validate/run/1\nrefs/notes/vibe-validate/run/2';
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue(mockRefs);

      const result = getNotesRefs('refs/notes/vibe-validate/run/*');

      expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['for-each-ref', 'refs/notes/vibe-validate/run/*']);
      expect(result).toBe(mockRefs);
    });

    it('should handle empty results', () => {
      vi.mocked(gitExecutor.execGitCommand).mockReturnValue('');

      const result = getNotesRefs('refs/notes/nonexistent/*');

      expect(result).toBe('');
    });
  });
});
