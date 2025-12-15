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

describe('git-notes - error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addNote', () => {
    it('should reject symbolic refs like HEAD', () => {
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation((hash) => {
        if (!/^[0-9a-f]{4,40}$/.test(hash)) {
          throw new Error('Invalid tree hash: must be hexadecimal');
        }
      });

      expect(() => addNote('vibe-validate/test' as NotesRef, 'HEAD' as TreeHash, 'content', false))
        .toThrow('must be hexadecimal');
    });

    it('should reject branch names', () => {
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation((hash) => {
        if (!/^[0-9a-f]{4,40}$/.test(hash)) {
          throw new Error('Invalid tree hash: must be hexadecimal');
        }
      });

      expect(() => addNote('vibe-validate/test' as NotesRef, 'main' as TreeHash, 'content', false))
        .toThrow('must be hexadecimal');
      expect(() => addNote('vibe-validate/test' as NotesRef, 'feature/foo' as TreeHash, 'content', false))
        .toThrow('must be hexadecimal');
    });

    it('should accept valid tree hashes', () => {
      const validHash = 'abc123def456789012345678901234567890abcd' as TreeHash;

      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation(() => {});
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = addNote('vibe-validate/test' as NotesRef, validHash, 'content', true);
      expect(result).toBe(true);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'add', '-f', '-F', '-', validHash],
        expect.objectContaining({ stdin: 'content' })
      );
    });

    it('should handle force flag correctly', () => {
      const validHash = 'abc123def456789012345678901234567890abcd' as TreeHash;

      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation(() => {});
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      // Without force
      addNote('vibe-validate/test' as NotesRef, validHash, 'content', false);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'add', '-F', '-', validHash],
        expect.objectContaining({ stdin: 'content' })
      );

      vi.clearAllMocks();

      // With force
      addNote('vibe-validate/test' as NotesRef, validHash, 'content', true);
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'add', '-f', '-F', '-', validHash],
        expect.objectContaining({ stdin: 'content' })
      );
    });
  });

  describe('readNote', () => {
    it('should reject symbolic refs like HEAD', () => {
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation((hash) => {
        if (!/^[0-9a-f]{4,40}$/.test(hash)) {
          throw new Error('Invalid tree hash: must be hexadecimal');
        }
      });

      expect(() => readNote('vibe-validate/test' as NotesRef, 'HEAD' as TreeHash))
        .toThrow('must be hexadecimal');
    });

    it('should return note content for valid hash', () => {
      const validHash = 'abc123def456789012345678901234567890abcd' as TreeHash;

      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation(() => {});
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: true,
        stdout: 'note content',
        stderr: '',
        exitCode: 0,
      });

      const result = readNote('vibe-validate/test' as NotesRef, validHash);
      expect(result).toBe('note content');
      expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'show', validHash],
        expect.objectContaining({ ignoreErrors: true, suppressStderr: true })
      );
    });

    it('should return null when note does not exist', () => {
      const validHash = 'abc123def456789012345678901234567890abcd' as TreeHash;

      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation(() => {});
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: false,
        stdout: '',
        stderr: 'error: no note found',
        exitCode: 1,
      });

      const result = readNote('vibe-validate/test' as NotesRef, validHash);
      expect(result).toBeNull();
    });
  });

  describe('removeNote', () => {
    it('should reject symbolic refs like HEAD', () => {
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation((hash) => {
        if (!/^[0-9a-f]{4,40}$/.test(hash)) {
          throw new Error('Invalid tree hash: must be hexadecimal');
        }
      });

      expect(() => removeNote('vibe-validate/test' as NotesRef, 'HEAD' as TreeHash))
        .toThrow('must be hexadecimal');
    });

    it('should return true when note is removed', () => {
      const validHash = 'abc123def456789012345678901234567890abcd' as TreeHash;

      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation(() => {});
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = removeNote('vibe-validate/test' as NotesRef, validHash);
      expect(result).toBe(true);
      expect(gitExecutor.tryGitCommand).toHaveBeenCalledWith(
        ['notes', '--ref=vibe-validate/test', 'remove', validHash],
        expect.objectContaining({ suppressStderr: true })
      );
    });

    it('should return false when note does not exist', () => {
      const validHash = 'abc123def456789012345678901234567890abcd' as TreeHash;

      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation(() => {});
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(false);

      const result = removeNote('vibe-validate/test' as NotesRef, validHash);
      expect(result).toBe(false);
    });
  });

  describe('hasNote', () => {
    it('should reject symbolic refs like HEAD', () => {
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation((hash) => {
        if (!/^[0-9a-f]{4,40}$/.test(hash)) {
          throw new Error('Invalid tree hash: must be hexadecimal');
        }
      });

      expect(() => hasNote('vibe-validate/test' as NotesRef, 'HEAD' as TreeHash))
        .toThrow('must be hexadecimal');
    });

    it('should return true when note exists', () => {
      const validHash = 'abc123def456789012345678901234567890abcd' as TreeHash;

      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation(() => {});
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = hasNote('vibe-validate/test' as NotesRef, validHash);
      expect(result).toBe(true);
    });

    it('should return false when note does not exist', () => {
      const validHash = 'abc123def456789012345678901234567890abcd' as TreeHash;

      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation(() => {});
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(false);

      const result = hasNote('vibe-validate/test' as NotesRef, validHash);
      expect(result).toBe(false);
    });
  });

  describe('listNotes', () => {
    it('should return empty array when no notes exist', () => {
      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: false,
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const result = listNotes('vibe-validate/test' as NotesRef);
      expect(result).toEqual([]);
    });

    it('should parse note list correctly', () => {
      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.validateTreeHash).mockImplementation(() => {});
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

      const result = listNotes('vibe-validate/test' as NotesRef);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(['abc123', 'content1']);
      expect(result[1]).toEqual(['def456', 'content2']);
    });
  });

  describe('listNotesRefs', () => {
    it('should return empty array when no refs exist', () => {
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: false,
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const result = listNotesRefs('refs/notes/vibe-validate/run');
      expect(result).toEqual([]);
    });

    it('should return list of refs', () => {
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: true,
        stdout: 'refs/notes/vibe-validate/run/abc123\nrefs/notes/vibe-validate/run/def456',
        stderr: '',
        exitCode: 0,
      });

      const result = listNotesRefs('refs/notes/vibe-validate/run');
      expect(result).toEqual([
        'refs/notes/vibe-validate/run/abc123',
        'refs/notes/vibe-validate/run/def456',
      ]);
    });

    it('should normalize path without refs/ prefix', () => {
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: true,
        stdout: 'refs/notes/vibe-validate/run/abc123',
        stderr: '',
        exitCode: 0,
      });

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
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: true,
        stdout: 'refs/notes/vibe-validate/run/abc123\nrefs/notes/vibe-validate/run/def456',
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(true);

      const result = removeNotesRefs('refs/notes/vibe-validate/run/abc123');
      expect(result).toBe(2);
      expect(gitExecutor.tryGitCommand).toHaveBeenCalledTimes(2);
    });

    it('should skip refs outside vibe-validate namespace', () => {
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: true,
        stdout: 'refs/notes/vibe-validate/run/abc123\nrefs/notes/other/def456',
        stderr: '',
        exitCode: 0,
      });
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
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: true,
        stdout: 'abc123def456',
        stderr: '',
        exitCode: 0,
      });

      const result = getNotesRefSha('vibe-validate/test');
      expect(result).toBe('abc123def456');
    });

    it('should return null when ref does not exist', () => {
      vi.mocked(gitExecutor.validateNotesRef).mockImplementation(() => {});
      vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
        success: false,
        stdout: '',
        stderr: 'fatal: Needed a single revision',
        exitCode: 128,
      });

      const result = getNotesRefSha('vibe-validate/test');
      expect(result).toBeNull();
    });
  });
});
