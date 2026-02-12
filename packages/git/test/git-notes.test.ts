import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as gitExecutor from '../src/git-executor.js';
import {
  addNote,
  readNote,
  removeNote,
  hasNote,
  listNotesRefs,
  removeNotesRefs,
  hasNotesRef,
  getNotesRefSha,
} from '../src/git-notes.js';
import type { TreeHash, NotesRef } from '../src/types.js';

// Mock git-executor
vi.mock('../src/git-executor.js', () => ({
  executeGitCommand: vi.fn(),
  tryGitCommand: vi.fn(),
  validateNotesRef: vi.fn(),
  validateTreeHash: vi.fn(),
}));

/**
 * Valid test tree hash (40 character hexadecimal)
 */
const VALID_HASH = 'abc123def456789012345678901234567890abcd' as TreeHash;

/**
 * Test notes ref for standard tests
 */
const TEST_REF = 'vibe-validate/test' as NotesRef;

/**
 * Setup mock to validate tree hashes and reject symbolic refs
 */
function mockTreeHashValidation(): void {
  vi.mocked(gitExecutor.validateTreeHash).mockImplementation((hash) => {
    if (!/^[0-9a-f]{4,40}$/.test(hash)) {
      throw new Error('Invalid tree hash: must be hexadecimal');
    }
  });
}

/**
 * Setup mocks for successful git operations (no validation errors)
 */
function mockSuccessfulValidation(): void {
  vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
  vi.mocked(gitExecutor.validateTreeHash).mockImplementation(() => {});
}

/**
 * Mock executeGitCommand to return successful result
 * @param stdout - Command output
 * @returns Mocked function
 */
function mockSuccessfulCommand(stdout = ''): void {
  vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
    success: true,
    stdout,
    stderr: '',
    exitCode: 0,
  });
}

/**
 * Mock executeGitCommand to return failed result
 * @param stderr - Error output
 * @param exitCode - Exit code (default: 1)
 */
function mockFailedCommand(stderr = '', exitCode = 1): void {
  vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
    success: false,
    stdout: '',
    stderr,
    exitCode,
  });
}

/**
 * Mock a conflict scenario (note already exists)
 */
function mockConflictResult(): void {
  vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({
    success: false,
    stdout: '',
    stderr: 'error: Object already exists',
    exitCode: 1,
  });
}

/**
 * Mock a full atomic merge attempt sequence (7 git commands)
 * @param commitSha - The commit SHA to return for the ref
 * @param existingNote - The existing note content
 * @param casSuccess - Whether the final update-ref should succeed
 */
function mockAtomicMergeAttempt(commitSha: string, existingNote: string, casSuccess: boolean): void {
  vi.mocked(gitExecutor.executeGitCommand)
    .mockReturnValueOnce({ success: true, stdout: commitSha, stderr: '', exitCode: 0 }) // get ref SHA
    .mockReturnValueOnce({ success: true, stdout: existingNote, stderr: '', exitCode: 0 }) // read note
    .mockReturnValueOnce({ success: true, stdout: '100644 blob blob-sha\tobj', stderr: '', exitCode: 0 }) // ls-tree
    .mockReturnValueOnce({ success: true, stdout: 'new-blob', stderr: '', exitCode: 0 }) // hash-object
    .mockReturnValueOnce({ success: true, stdout: 'new-tree', stderr: '', exitCode: 0 }) // mktree
    .mockReturnValueOnce({ success: true, stdout: 'new-commit', stderr: '', exitCode: 0 }) // commit-tree
    .mockReturnValueOnce({ success: casSuccess, stdout: '', stderr: '', exitCode: casSuccess ? 0 : 1 }); // update-ref
}


describe('git-notes - error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addNote', () => {
    it('should reject symbolic refs like HEAD', () => {
      mockTreeHashValidation();

      expect(() => addNote(TEST_REF, 'HEAD' as TreeHash, 'content', false))
        .toThrow('must be hexadecimal');
    });

    it('should reject branch names', () => {
      mockTreeHashValidation();

      expect(() => addNote(TEST_REF, 'main' as TreeHash, 'content', false))
        .toThrow('must be hexadecimal');
      expect(() => addNote(TEST_REF, 'feature/foo' as TreeHash, 'content', false))
        .toThrow('must be hexadecimal');
    });

    it('should accept valid tree hashes', () => {
      mockSuccessfulValidation();
      mockSuccessfulCommand();

      const result = addNote(TEST_REF, VALID_HASH, 'content', true);
      expect(result).toBe(true);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'add', '-f', '-F', '-', VALID_HASH],
        expect.objectContaining({ stdin: 'content' })
      );
    });

    it('should handle force flag correctly', () => {
      mockSuccessfulValidation();
      mockSuccessfulCommand();

      // Without force
      addNote(TEST_REF, VALID_HASH, 'content', false);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'add', '-F', '-', VALID_HASH],
        expect.objectContaining({ stdin: 'content' })
      );

      vi.clearAllMocks();

      // With force
      mockSuccessfulValidation();
      mockSuccessfulCommand();
      addNote(TEST_REF, VALID_HASH, 'content', true);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'add', '-f', '-F', '-', VALID_HASH],
        expect.objectContaining({ stdin: 'content' })
      );
    });
  });

  describe('addNote - optimistic locking', () => {
    it('should succeed on first write when note does not exist', () => {
      mockSuccessfulValidation();
      mockSuccessfulCommand();

      const result = addNote(TEST_REF, VALID_HASH, 'content', false);
      expect(result).toBe(true);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(1);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'add', '-F', '-', VALID_HASH],
        expect.objectContaining({ stdin: 'content' })
      );
    });

    it('should retry and merge when note already exists (atomic CAS)', () => {
      mockSuccessfulValidation();

      // YAML format (as written by packages/history/src/recorder.ts)
      const existingNote = `treeHash: abc123
runs:
  - id: run-1
    timestamp: '2024-01-01T00:00:00Z'
    duration: 1000
    passed: true
    branch: main
    headCommit: commit1
    uncommittedChanges: false
    result: {}
`;
      const newNote = `treeHash: abc123
runs:
  - id: run-2
    timestamp: '2024-01-01T00:01:00Z'
    duration: 2000
    passed: true
    branch: main
    headCommit: commit2
    uncommittedChanges: false
    result: {}
`;

      vi.mocked(gitExecutor.executeGitCommand)
        // 1. Try to add note (conflict)
        .mockReturnValueOnce({
          success: false,
          stdout: '',
          stderr: 'error: Object already exists for abc123',
          exitCode: 1,
        })
        // 2. Get notes ref SHA (for CAS)
        .mockReturnValueOnce({
          success: true,
          stdout: 'commit-sha-123',
          stderr: '',
          exitCode: 0,
        })
        // 3. Read existing note
        .mockReturnValueOnce({
          success: true,
          stdout: existingNote,
          stderr: '',
          exitCode: 0,
        })
        // 4. Read tree entries (ls-tree)
        .mockReturnValueOnce({
          success: true,
          stdout: `100644 blob blob-sha-1\t${VALID_HASH}`,
          stderr: '',
          exitCode: 0,
        })
        // 5. Create blob (hash-object)
        .mockReturnValueOnce({
          success: true,
          stdout: 'new-blob-sha',
          stderr: '',
          exitCode: 0,
        })
        // 6. Create tree (mktree)
        .mockReturnValueOnce({
          success: true,
          stdout: 'new-tree-sha',
          stderr: '',
          exitCode: 0,
        })
        // 7. Create commit (commit-tree)
        .mockReturnValueOnce({
          success: true,
          stdout: 'new-commit-sha',
          stderr: '',
          exitCode: 0,
        })
        // 8. Atomic update ref (update-ref with CAS)
        .mockReturnValueOnce({
          success: true,
          stdout: '',
          stderr: '',
          exitCode: 0,
        });

      const result = addNote(TEST_REF, VALID_HASH, newNote, false);

      expect(result).toBe(true);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(8);

      // Verify first call is attempt to add note
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(1,
        ['notes', '--ref=vibe-validate/test', 'add', '-F', '-', VALID_HASH],
        expect.objectContaining({ stdin: newNote })
      );

      // Verify get notes ref SHA call
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(2,
        ['rev-parse', '--verify', 'refs/notes/vibe-validate/test'],
        expect.any(Object)
      );

      // Verify read existing note call
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(3,
        ['notes', '--ref=vibe-validate/test', 'show', VALID_HASH],
        expect.objectContaining({ ignoreErrors: true })
      );

      // Verify ls-tree call
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(4,
        ['ls-tree', 'commit-sha-123'],
        expect.any(Object)
      );

      // Verify hash-object call (should contain merged content in YAML format)
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(5,
        ['hash-object', '-w', '--stdin'],
        expect.objectContaining({ stdin: expect.stringContaining('run-1') })
      );
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(5,
        ['hash-object', '-w', '--stdin'],
        expect.objectContaining({ stdin: expect.stringContaining('run-2') })
      );

      // Verify mktree call
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(6,
        ['mktree'],
        expect.any(Object)
      );

      // Verify commit-tree call
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(7,
        ['commit-tree', 'new-tree-sha', '-m', 'Notes added by vibe-validate', '-p', 'commit-sha-123']
      );

      // Verify atomic update-ref call
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(8,
        ['update-ref', 'refs/notes/vibe-validate/test', 'new-commit-sha', 'commit-sha-123'],
        expect.any(Object)
      );
    });

    it('should retry atomic merge even on non-conflict errors', () => {
      // New behavior: Always attempt atomic merge when fast-path fails
      // This is simpler and more robust than parsing error messages
      mockSuccessfulValidation();

      // All git commands fail with permission denied
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: false,
        stdout: '',
        stderr: 'error: Permission denied',
        exitCode: 1,
      });

      const result = addNote(TEST_REF, VALID_HASH, 'content', false);
      expect(result).toBe(false);
      // Will make multiple attempts (fast-path + atomic merge retries)
      expect(gitExecutor.executeGitCommand).toHaveBeenCalled();
    });

    it('should retry up to maxRetries times with atomic CAS failures', () => {
      mockSuccessfulValidation();

      const existingNote = `treeHash: abc123
runs:
  - id: run-1
`;
      const newNote = `treeHash: abc123
runs:
  - id: run-2
`;

      // Fast path: initial add attempt (conflict)
      mockConflictResult();

      // Attempt 1: full atomic merge sequence, CAS fails
      mockAtomicMergeAttempt('commit-sha-1', existingNote, false);

      // Attempt 2: full atomic merge sequence, CAS fails
      mockAtomicMergeAttempt('commit-sha-2', existingNote, false);

      // Attempt 3 (last): full atomic merge sequence, CAS fails
      mockAtomicMergeAttempt('commit-sha-3', existingNote, false);

      const result = addNote(TEST_REF, VALID_HASH, newNote, false);
      expect(result).toBe(false);
      // 1 (initial conflict) + 7*3 (three full atomic merge attempts) = 22 total calls
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(22);
    });

    it('should handle CAS failure and retry until success', () => {
      mockSuccessfulValidation();

      const existingNote = `treeHash: abc123
runs:
  - id: run-1
`;
      const newNote = `treeHash: abc123
runs:
  - id: run-2
`;

      // Fast path: initial add attempt (conflict)
      mockConflictResult();

      // Attempt 1: full atomic merge sequence, CAS fails
      mockAtomicMergeAttempt('commit-sha-1', existingNote, false);

      // Attempt 2: full atomic merge sequence, CAS succeeds
      mockAtomicMergeAttempt('commit-sha-2', existingNote, true);

      const result = addNote(TEST_REF, VALID_HASH, newNote, false);
      expect(result).toBe(true);
      // 1 (initial conflict) + 7 (attempt 1) + 7 (attempt 2) = 15 total calls
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(15);
    });

    it('should merge YAML-formatted notes correctly (bug fix test)', () => {
      mockSuccessfulValidation();

      // YAML format (as written by packages/history/src/recorder.ts)
      const existingNote = `treeHash: abc123
runs:
  - id: run-1
    timestamp: '2024-01-01T00:00:00Z'
    duration: 1000
    passed: true
    branch: main
    headCommit: commit1
    uncommittedChanges: false
    result: {}
`;

      const newNote = `treeHash: abc123
runs:
  - id: run-2
    timestamp: '2024-01-01T00:01:00Z'
    duration: 2000
    passed: true
    branch: main
    headCommit: commit2
    uncommittedChanges: false
    result: {}
`;

      // Fast path: initial add attempt (conflict)
      mockConflictResult();

      // Atomic merge attempt (succeeds)
      mockAtomicMergeAttempt('commit-sha-123', existingNote, true);

      const result = addNote(TEST_REF, VALID_HASH, newNote, false);

      expect(result).toBe(true);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(8);

      // Verify hash-object call contains merged content with BOTH runs
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(5,
        ['hash-object', '-w', '--stdin'],
        expect.objectContaining({
          stdin: expect.stringMatching(/run-1/)
        })
      );
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(5,
        ['hash-object', '-w', '--stdin'],
        expect.objectContaining({
          stdin: expect.stringMatching(/run-2/)
        })
      );
    });
  });

  describe('readNote', () => {
    it('should reject symbolic refs like HEAD', () => {
      mockTreeHashValidation();

      expect(() => readNote(TEST_REF, 'HEAD' as TreeHash))
        .toThrow('must be hexadecimal');
    });

    it('should return note content for valid hash', () => {
      mockSuccessfulValidation();
      mockSuccessfulCommand('note content');

      const result = readNote(TEST_REF, VALID_HASH);
      expect(result).toBe('note content');
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'show', VALID_HASH],
        expect.objectContaining({ ignoreErrors: true, suppressStderr: true })
      );
    });

    it('should return null when note does not exist', () => {
      mockSuccessfulValidation();
      mockFailedCommand('error: no note found');

      const result = readNote(TEST_REF, VALID_HASH);
      expect(result).toBeNull();
    });
  });

  describe('removeNote', () => {
    it('should reject symbolic refs like HEAD', () => {
      mockTreeHashValidation();

      expect(() => removeNote(TEST_REF, 'HEAD' as TreeHash))
        .toThrow('must be hexadecimal');
    });

    it('should return true when note is removed', () => {
      mockSuccessfulValidation();
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = removeNote(TEST_REF, VALID_HASH);
      expect(result).toBe(true);
      expect(gitExecutor.tryGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'remove', VALID_HASH],
        expect.objectContaining({ suppressStderr: true })
      );
    });

    it('should return false when note does not exist', () => {
      mockSuccessfulValidation();
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(false);

      const result = removeNote(TEST_REF, VALID_HASH);
      expect(result).toBe(false);
    });
  });

  describe('hasNote', () => {
    it('should reject symbolic refs like HEAD', () => {
      mockTreeHashValidation();

      expect(() => hasNote(TEST_REF, 'HEAD' as TreeHash))
        .toThrow('must be hexadecimal');
    });

    it('should return true when note exists', () => {
      mockSuccessfulValidation();
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = hasNote(TEST_REF, VALID_HASH);
      expect(result).toBe(true);
    });

    it('should return false when note does not exist', () => {
      mockSuccessfulValidation();
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(false);

      const result = hasNote(TEST_REF, VALID_HASH);
      expect(result).toBe(false);
    });
  });

  describe('listNotesRefs', () => {
    it('should return empty array when no refs exist', () => {
      mockFailedCommand();

      const result = listNotesRefs('refs/notes/vibe-validate/run');
      expect(result).toEqual([]);
    });

    it('should return list of refs', () => {
      mockSuccessfulCommand('refs/notes/vibe-validate/run/abc123\nrefs/notes/vibe-validate/run/def456');

      const result = listNotesRefs('refs/notes/vibe-validate/run');
      expect(result).toEqual([
        'refs/notes/vibe-validate/run/abc123',
        'refs/notes/vibe-validate/run/def456',
      ]);
    });

    it('should normalize path without refs/ prefix', () => {
      mockSuccessfulCommand('refs/notes/vibe-validate/run/abc123');

      listNotesRefs('vibe-validate/run');
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
        ['for-each-ref', '--format=%(refname)', 'refs/notes/vibe-validate/run'],
        expect.any(Object)
      );
    });
  });

  describe('removeNotesRefs', () => {
    it('should reject non-vibe-validate refs', () => {
      expect(() => removeNotesRefs('refs/notes/other/path'))
        .toThrow('Refusing to delete refs outside vibe-validate namespace');
    });

    it('should delete all refs under path', () => {
      mockSuccessfulCommand('refs/notes/vibe-validate/run/abc123\nrefs/notes/vibe-validate/run/def456');
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = removeNotesRefs('refs/notes/vibe-validate/run/abc123');
      expect(result).toBe(2);
      expect(gitExecutor.tryGitCommand).toHaveBeenCalledTimes(2);
    });

    it('should skip refs outside vibe-validate namespace', () => {
      mockSuccessfulCommand('refs/notes/vibe-validate/run/abc123\nrefs/notes/other/def456');
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = removeNotesRefs('refs/notes/vibe-validate/run');
      expect(result).toBe(1); // Only vibe-validate ref deleted
    });
  });

  describe('hasNotesRef', () => {
    it('should return true when ref exists', () => {
      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = hasNotesRef('vibe-validate/test');
      expect(result).toBe(true);
    });

    it('should return false when ref does not exist', () => {
      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(false);

      const result = hasNotesRef('vibe-validate/test');
      expect(result).toBe(false);
    });

    it('should handle full ref paths', () => {
      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      hasNotesRef('refs/notes/vibe-validate/test');
      expect(gitExecutor.tryGitCommand).toHaveBeenCalledWith(
        ['rev-parse', '--verify', 'refs/notes/vibe-validate/test'],
        expect.any(Object)
      );
    });
  });

  describe('getNotesRefSha', () => {
    it('should return SHA when ref exists', () => {
      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      mockSuccessfulCommand('abc123def456');

      const result = getNotesRefSha('vibe-validate/test');
      expect(result).toBe('abc123def456');
    });

    it('should return null when ref does not exist', () => {
      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      mockFailedCommand('fatal: Needed a single revision', 128);

      const result = getNotesRefSha('vibe-validate/test');
      expect(result).toBeNull();
    });
  });
});
