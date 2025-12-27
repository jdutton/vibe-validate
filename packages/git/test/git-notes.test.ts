import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as gitExecutor from '../src/git-executor.js';
import {
  addNote,
  readNote,
  removeNote,
  listNotes,
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
 * Mock reading an existing note (for merge scenarios)
 */
function mockReadExistingNote(): void {
  vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({
    success: true,
    stdout: '{"treeHash":"abc123","runs":[{"id":"run-1"}]}',
    stderr: '',
    exitCode: 0,
  });
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

    it('should retry and merge when note already exists', () => {
      mockSuccessfulValidation();

      // First call: fails with "already exists"
      vi.mocked(gitExecutor.executeGitCommand)
        .mockReturnValueOnce({
          success: false,
          stdout: '',
          stderr: 'error: Object already exists for abc123',
          exitCode: 1,
        })
        // Second call: read existing note
        .mockReturnValueOnce({
          success: true,
          stdout: '{"treeHash":"abc123","runs":[{"id":"run-1","timestamp":"2024-01-01T00:00:00Z","duration":1000,"passed":true,"branch":"main","headCommit":"commit1","uncommittedChanges":false,"result":{}}]}',
          stderr: '',
          exitCode: 0,
        })
        // Third call: write merged note with force
        .mockReturnValueOnce({
          success: true,
          stdout: '',
          stderr: '',
          exitCode: 0,
        });

      const newNote = '{"treeHash":"abc123","runs":[{"id":"run-2","timestamp":"2024-01-01T00:01:00Z","duration":2000,"passed":true,"branch":"main","headCommit":"commit2","uncommittedChanges":false,"result":{}}]}';
      const result = addNote(TEST_REF, VALID_HASH, newNote, false);

      expect(result).toBe(true);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(3);

      // First attempt without force
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(1,
        ['notes', '--ref=vibe-validate/test', 'add', '-F', '-', VALID_HASH],
        expect.objectContaining({ stdin: newNote })
      );

      // Read existing note
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(2,
        ['notes', '--ref=vibe-validate/test', 'show', VALID_HASH],
        expect.objectContaining({ ignoreErrors: true })
      );

      // Write merged with force
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(3,
        ['notes', '--ref=vibe-validate/test', 'add', '-f', '-F', '-', VALID_HASH],
        expect.objectContaining({ stdin: expect.stringContaining('"run-1"') })
      );
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(3,
        ['notes', '--ref=vibe-validate/test', 'add', '-f', '-F', '-', VALID_HASH],
        expect.objectContaining({ stdin: expect.stringContaining('"run-2"') })
      );
    });

    it('should throw non-conflict errors immediately', () => {
      mockSuccessfulValidation();

      // Return permission denied error (not "already exists")
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({
        success: false,
        stdout: '',
        stderr: 'error: Permission denied',
        exitCode: 1,
      });

      const result = addNote(TEST_REF, VALID_HASH, 'content', false);
      expect(result).toBe(false);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(1);
    });

    it('should retry up to maxRetries times', () => {
      mockSuccessfulValidation();

      // All 3 attempts fail with conflict
      // Attempt 1: conflict, read, merge fails
      mockConflictResult();
      mockReadExistingNote();
      mockConflictResult();
      // Attempt 2: conflict, read, merge fails
      mockConflictResult();
      mockReadExistingNote();
      mockConflictResult();
      // Attempt 3: conflict, read, merge fails (last attempt - now tries to merge)
      mockConflictResult();
      mockReadExistingNote();
      mockConflictResult();

      const result = addNote(TEST_REF, VALID_HASH, '{"treeHash":"abc123","runs":[{"id":"run-2"}]}', false);
      expect(result).toBe(false);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(9); // 3 attempts + 3 reads + 3 merge attempts
    });

    it('should handle merge failure and retry from beginning', () => {
      mockSuccessfulValidation();

      // Attempt 1: conflict, read, merge fails
      mockConflictResult();
      mockReadExistingNote();
      mockConflictResult();
      // Attempt 2: succeeds (no one else wrote)
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = addNote(TEST_REF, VALID_HASH, '{"treeHash":"abc123","runs":[{"id":"run-2"}]}', false);
      expect(result).toBe(true);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(4);
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

  describe('listNotes', () => {
    it('should return empty array when no notes exist', () => {
      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      mockFailedCommand();

      const result = listNotes(TEST_REF);
      expect(result).toEqual([]);
    });

    it('should parse note list correctly', () => {
      mockSuccessfulValidation();
      vi.mocked(gitExecutor.executeGitCommand)
        .mockReturnValueOnce({
          success: true,
          stdout: 'note1sha abc123\nnote2sha def456',
          stderr: '',
          exitCode: 0,
        })
        .mockReturnValueOnce({
          success: true,
          stdout: 'content1',
          stderr: '',
          exitCode: 0,
        })
        .mockReturnValueOnce({
          success: true,
          stdout: 'content2',
          stderr: '',
          exitCode: 0,
        });

      const result = listNotes(TEST_REF);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(['abc123', 'content1']);
      expect(result[1]).toEqual(['def456', 'content2']);
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
