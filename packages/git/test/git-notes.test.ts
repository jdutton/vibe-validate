import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse as parseYaml } from 'yaml';

import * as gitExecutor from '../src/git-executor.js';
import {
  addNote,
  readNote,
  removeNote,
  hasNote,
  listNoteObjects,
  listNotesRefs,
  removeNotesRefs,
  hasNotesRef,
  getNotesRefSha,
  mergeReplace,
  mergeAppendRuns,
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
 * Mock a merge attempt sequence (2 git commands: read + force-write)
 * @param existingNote - The existing note content
 * @param writeSuccess - Whether the force-write should succeed
 */
function mockMergeAttempt(existingNote: string, writeSuccess: boolean): void {
  vi.mocked(gitExecutor.executeGitCommand)
    .mockReturnValueOnce({ success: true, stdout: existingNote, stderr: '', exitCode: 0 }) // read note
    .mockReturnValueOnce({ success: writeSuccess, stdout: '', stderr: '', exitCode: writeSuccess ? 0 : 1 }); // force-write
}


describe('git-notes - error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addNote', () => {
    it('should reject symbolic refs like HEAD', () => {
      mockTreeHashValidation();

      expect(() => addNote(TEST_REF, 'HEAD' as TreeHash, 'content'))
        .toThrow('must be hexadecimal');
    });

    it('should reject branch names', () => {
      mockTreeHashValidation();

      expect(() => addNote(TEST_REF, 'main' as TreeHash, 'content'))
        .toThrow('must be hexadecimal');
      expect(() => addNote(TEST_REF, 'feature/foo' as TreeHash, 'content'))
        .toThrow('must be hexadecimal');
    });

    it('should accept valid tree hashes', () => {
      mockSuccessfulValidation();
      mockSuccessfulCommand();

      const result = addNote(TEST_REF, VALID_HASH, 'content');
      expect(result).toBe(true);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'add', '-F', '-', VALID_HASH],
        expect.objectContaining({ stdin: 'content' })
      );
    });
  });

  describe('addNote - merge strategy', () => {
    it('should succeed on first write when note does not exist', () => {
      mockSuccessfulValidation();
      mockSuccessfulCommand();

      const result = addNote(TEST_REF, VALID_HASH, 'content');
      expect(result).toBe(true);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(1);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'add', '-F', '-', VALID_HASH],
        expect.objectContaining({ stdin: 'content' })
      );
    });

    it('should merge using git notes add -f when note already exists (fan-out safe)', () => {
      mockSuccessfulValidation();

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
          stderr: 'error: Object already exists',
          exitCode: 1,
        })
        // 2. Read existing note
        .mockReturnValueOnce({
          success: true,
          stdout: existingNote,
          stderr: '',
          exitCode: 0,
        })
        // 3. Force-write merged content (git handles fan-out)
        .mockReturnValueOnce({
          success: true,
          stdout: '',
          stderr: '',
          exitCode: 0,
        });

      const result = addNote(TEST_REF, VALID_HASH, newNote, mergeAppendRuns);

      expect(result).toBe(true);
      // Only 3 calls: add (fail) + read + force-add (success)
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(3);

      // Call 1: attempt to add note (no force)
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(1,
        ['notes', '--ref=vibe-validate/test', 'add', '-F', '-', VALID_HASH],
        expect.objectContaining({ stdin: newNote })
      );

      // Call 2: read existing note
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(2,
        ['notes', '--ref=vibe-validate/test', 'show', VALID_HASH],
        expect.objectContaining({ ignoreErrors: true })
      );

      // Call 3: force-write merged content (git handles fan-out correctly)
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(3,
        ['notes', '--ref=vibe-validate/test', 'add', '-f', '-F', '-', VALID_HASH],
        expect.objectContaining({
          stdin: expect.stringContaining('run-1'),
        })
      );
      // Merged content should contain BOTH runs
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(3,
        ['notes', '--ref=vibe-validate/test', 'add', '-f', '-F', '-', VALID_HASH],
        expect.objectContaining({
          stdin: expect.stringContaining('run-2'),
        })
      );
    });

    it('should return false when existing note disappeared during merge', () => {
      mockSuccessfulValidation();

      vi.mocked(gitExecutor.executeGitCommand)
        // 1. Try to add note (conflict)
        .mockReturnValueOnce({
          success: false,
          stdout: '',
          stderr: 'error: Object already exists',
          exitCode: 1,
        })
        // 2. Read existing note (disappeared)
        .mockReturnValueOnce({
          success: false,
          stdout: '',
          stderr: 'error: no note found',
          exitCode: 1,
        });

      const result = addNote(TEST_REF, VALID_HASH, 'content', mergeAppendRuns);
      expect(result).toBe(false);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(2);
    });

    it('should return false when all git commands fail', () => {
      mockSuccessfulValidation();

      // All git commands fail
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: false,
        stdout: '',
        stderr: 'error: Permission denied',
        exitCode: 1,
      });

      const result = addNote(TEST_REF, VALID_HASH, 'content');
      expect(result).toBe(false);
      // 1 (fast path fail) + 1 (readNote fail) = 2 calls
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(2);
    });

    it('should return false when force-write fails after successful read', () => {
      mockSuccessfulValidation();

      const existingNote = `treeHash: abc123
runs:
  - id: run-1
`;

      // Fast path: conflict
      mockConflictResult();

      // Merge attempt: read succeeds, write fails
      mockMergeAttempt(existingNote, false);

      const result = addNote(TEST_REF, VALID_HASH, 'new content', mergeAppendRuns);
      expect(result).toBe(false);
      // 1 (fast path) + 2 (read + failed write) = 3 calls
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(3);
    });

    it('should merge YAML-formatted notes correctly (bug fix test)', () => {
      mockSuccessfulValidation();

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

      // Fast path: conflict
      mockConflictResult();

      // Merge attempt: read + force-write
      mockMergeAttempt(existingNote, true);

      const result = addNote(TEST_REF, VALID_HASH, newNote, mergeAppendRuns);

      expect(result).toBe(true);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(3);

      // Verify force-write contains merged content with BOTH runs
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(3,
        ['notes', '--ref=vibe-validate/test', 'add', '-f', '-F', '-', VALID_HASH],
        expect.objectContaining({
          stdin: expect.stringMatching(/run-1/),
        })
      );
      expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(3,
        ['notes', '--ref=vibe-validate/test', 'add', '-f', '-F', '-', VALID_HASH],
        expect.objectContaining({
          stdin: expect.stringMatching(/run-2/),
        })
      );
    });
  });

  describe('mergeReplace', () => {
    it('should return incoming content unchanged', () => {
      const existing = 'treeHash: abc123\ncommand: npm test\ntimestamp: old\n';
      const incoming = 'treeHash: abc123\ncommand: npm test\ntimestamp: new\n';

      expect(mergeReplace(existing, incoming)).toBe(incoming);
    });

    it('should ignore existing content entirely', () => {
      const existing = 'completely different format\nwith: extra\nfields: here\n';
      const incoming = 'treeHash: abc123\ncommand: npm test\n';

      expect(mergeReplace(existing, incoming)).toBe(incoming);
    });
  });

  describe('mergeAppendRuns', () => {
    it('should append runs from both notes', () => {
      const existing = `treeHash: abc123
runs:
  - id: run-1
    passed: true
`;
      const incoming = `treeHash: abc123
runs:
  - id: run-2
    passed: false
`;

      const result = mergeAppendRuns(existing, incoming);
      const parsed = parseYaml(result);

      expect(parsed.runs).toHaveLength(2);
      expect(parsed.runs[0].id).toBe('run-1');
      expect(parsed.runs[1].id).toBe('run-2');
    });

    it('should let new data fields win over existing', () => {
      const existing = `treeHash: abc123
runs:
  - id: run-1
    passed: true
`;
      const incoming = `treeHash: updated-hash
runs:
  - id: run-2
    passed: false
`;

      const result = mergeAppendRuns(existing, incoming);
      const parsed = parseYaml(result);

      // New treeHash wins
      expect(parsed.treeHash).toBe('updated-hash');
      // But runs are appended, not replaced
      expect(parsed.runs).toHaveLength(2);
    });

    it('should not add spurious runs key when neither note has runs', () => {
      const existing = `treeHash: abc123
command: npm test
timestamp: old
`;
      const incoming = `treeHash: abc123
command: npm test
timestamp: new
`;

      const result = mergeAppendRuns(existing, incoming);
      const parsed = parseYaml(result);

      expect(parsed.runs).toBeUndefined();
      expect(parsed.timestamp).toBe('new');
    });

    it('should fall back to incoming content on YAML parse failure', () => {
      // Force a runtime error by making parseYaml return something that causes
      // property access to throw (null/undefined with .runs access)
      // Use a YAML document that parses to null so existingData?.runs is safe
      // but we need it to actually throw — use a tab character in a flow context
      const existing = '{ key: [}';
      const incoming = 'treeHash: abc123\nruns: []\n';

      const result = mergeAppendRuns(existing, incoming);
      expect(result).toBe(incoming);
    });

    it('should handle corrupted notes with duplicate YAML keys', () => {
      const existing = `treeHash: abc123
runs:
  - id: run-1
    passed: true
treeHash: abc123
runs:
  - id: run-old
    passed: false
`;
      const incoming = `treeHash: abc123
runs:
  - id: run-new
    passed: true
`;

      // Should not throw — uniqueKeys: false tolerates duplicate keys
      const result = mergeAppendRuns(existing, incoming);
      const parsed = parseYaml(result);

      expect(parsed.runs).toBeDefined();
      expect(parsed.runs.length).toBeGreaterThan(0);
      // Should contain the new run
      expect(parsed.runs.some((r: { id: string }) => r.id === 'run-new')).toBe(true);
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

  describe('listNoteObjects', () => {
    it('should return empty array when no notes exist', () => {
      mockSuccessfulValidation();
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: false,
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const result = listNoteObjects(TEST_REF);
      expect(result).toEqual([]);
    });

    it('should return array of tree hashes that have notes', () => {
      mockSuccessfulValidation();
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: true,
        stdout: 'note_sha1 abc123def456789012345678901234567890abcd\nnote_sha2 def456789012345678901234567890abcdef12',
        stderr: '',
        exitCode: 0,
      });

      const result = listNoteObjects(TEST_REF);
      expect(result).toEqual([
        'abc123def456789012345678901234567890abcd',
        'def456789012345678901234567890abcdef12',
      ]);
    });

    it('should skip lines without object SHA', () => {
      mockSuccessfulValidation();
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: true,
        stdout: 'note_sha1 abc123def456789012345678901234567890abcd\n\ninvalid_line',
        stderr: '',
        exitCode: 0,
      });

      const result = listNoteObjects(TEST_REF);
      expect(result).toEqual(['abc123def456789012345678901234567890abcd']);
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
