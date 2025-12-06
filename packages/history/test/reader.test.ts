/**
 * Tests for git notes reader
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readHistoryNote,
  listHistoryTreeHashes,
  getAllHistoryNotes,
  hasHistoryForTree,
} from '../src/reader.js';
import { readNote, listNotes } from '@vibe-validate/git';

// Mock @vibe-validate/git
vi.mock('@vibe-validate/git', () => ({
  readNote: vi.fn(),
  listNotes: vi.fn(),
}));

describe('reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('readHistoryNote', () => {
    it('should read and parse history note for a tree hash', async () => {
      const mockYaml = `
treeHash: abc123def456
runs:
  - id: run-1
    timestamp: '2025-10-21T10:00:00Z'
    duration: 5000
    passed: true
    branch: main
    headCommit: commit123
    uncommittedChanges: false
    result:
      passed: true
      timestamp: '2025-10-21T10:00:00Z'
      treeHash: abc123def456
      phases: []
`;

      vi.mocked(readNote).mockReturnValue(mockYaml);

      const result = await readHistoryNote('abc123def456');

      expect(result).toBeDefined();
      expect(result?.treeHash).toBe('abc123def456');
      expect(result?.runs).toHaveLength(1);
      expect(result?.runs[0].id).toBe('run-1');
      expect(result?.runs[0].passed).toBe(true);

      expect(readNote).toHaveBeenCalledWith(
        'vibe-validate/validate',
        'abc123def456'
      );
    });

    it('should use custom notes ref when provided', async () => {
      const mockYaml = 'treeHash: abc123\nruns: []';
      vi.mocked(readNote).mockReturnValue(mockYaml);

      await readHistoryNote('abc123def456', 'custom/notes/ref');

      expect(readNote).toHaveBeenCalledWith(
        'custom/notes/ref',
        'abc123def456'
      );
    });

    it('should return null when note does not exist', async () => {
      vi.mocked(readNote).mockReturnValue(null);

      const result = await readHistoryNote('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null on any error', async () => {
      vi.mocked(readNote).mockImplementation(() => {
        throw new Error('Git command failed');
      });

      const result = await readHistoryNote('abc123def456');

      expect(result).toBeNull();
    });

    it('should handle multiple runs in note', async () => {
      const mockYaml = `
treeHash: abc123def456
runs:
  - id: run-1
    timestamp: '2025-10-21T09:00:00Z'
    duration: 5000
    passed: false
    branch: main
    headCommit: commit123
    uncommittedChanges: false
    result:
      passed: false
      timestamp: '2025-10-21T09:00:00Z'
      treeHash: abc123def456
      phases: []
  - id: run-2
    timestamp: '2025-10-21T10:00:00Z'
    duration: 3000
    passed: true
    branch: main
    headCommit: commit456
    uncommittedChanges: false
    result:
      passed: true
      timestamp: '2025-10-21T10:00:00Z'
      treeHash: abc123def456
      phases: []
`;

      vi.mocked(readNote).mockReturnValue(mockYaml);

      const result = await readHistoryNote('abc123def456');

      expect(result?.runs).toHaveLength(2);
      expect(result?.runs[0].id).toBe('run-1');
      expect(result?.runs[1].id).toBe('run-2');
    });

    it('should silently skip corrupted runs with invalid line/column (legacy 0/0 bug)', async () => {
      // Simulate legacy history from rc.9 with 0/0 line/column errors
      const mockYaml = `
treeHash: abc123def456
runs:
  - id: run-corrupted
    timestamp: '2025-10-21T09:00:00Z'
    duration: 5000
    passed: false
    branch: main
    headCommit: commit123
    uncommittedChanges: false
    result:
      passed: false
      timestamp: '2025-10-21T09:00:00Z'
      treeHash: abc123def456
      phases:
        - name: Tests
          passed: false
          durationSecs: 5
          steps:
            - name: Unit Tests
              command: npm test
              exitCode: 1
              durationSecs: 5
              passed: false
              extraction:
                summary: Test failed
                totalErrors: 1
                errors:
                  - file: test.ts
                    line: 0
                    column: 0
                    message: Some error
  - id: run-valid
    timestamp: '2025-10-21T10:00:00Z'
    duration: 3000
    passed: true
    branch: main
    headCommit: commit456
    uncommittedChanges: false
    result:
      passed: true
      timestamp: '2025-10-21T10:00:00Z'
      treeHash: abc123def456
      phases: []
`;

      vi.mocked(readNote).mockReturnValue(mockYaml);

      const result = await readHistoryNote('abc123def456');

      // Should only return valid runs, corrupted run silently skipped
      expect(result?.runs).toHaveLength(1);
      expect(result?.runs[0].id).toBe('run-valid');
      // Silent skip - no warnings logged, no user notification needed
      // After upgrade, users should run 'vv doctor' to check for issues
    });
  });

  describe('listHistoryTreeHashes', () => {
    it('should list all tree hashes with notes', async () => {
      const mockNotes: Array<[string, string]> = [
        ['abc123def456', 'note content 1'],
        ['789012abc345', 'note content 2'],
        ['fedcba987654', 'note content 3'],
      ];

      vi.mocked(listNotes).mockReturnValue(mockNotes);

      const result = await listHistoryTreeHashes();

      expect(result).toEqual([
        'abc123def456',
        '789012abc345',
        'fedcba987654',
      ]);

      expect(listNotes).toHaveBeenCalledWith('vibe-validate/validate');
    });

    it('should use custom notes ref when provided', async () => {
      const mockNotes: Array<[string, string]> = [['abc123def456', 'note content']];
      vi.mocked(listNotes).mockReturnValue(mockNotes);

      await listHistoryTreeHashes('custom/notes/ref');

      expect(listNotes).toHaveBeenCalledWith('custom/notes/ref');
    });

    it('should return empty array when no notes exist', async () => {
      vi.mocked(listNotes).mockReturnValue([]);

      const result = await listHistoryTreeHashes();

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      vi.mocked(listNotes).mockImplementation(() => {
        throw new Error('Git command failed');
      });

      const result = await listHistoryTreeHashes();

      expect(result).toEqual([]);
    });

    it('should filter out empty lines', async () => {
      // listNotes already filters empty lines, but test the behavior
      const mockNotes: Array<[string, string]> = [
        ['abc123def456', 'note content 1'],
        ['789012abc345', 'note content 2'],
      ];

      vi.mocked(listNotes).mockReturnValue(mockNotes);

      const result = await listHistoryTreeHashes();

      expect(result).toEqual([
        'abc123def456',
        '789012abc345',
      ]);
    });

    it('should handle single tree hash', async () => {
      const mockNotes: Array<[string, string]> = [['abc123def456', 'note content']];
      vi.mocked(listNotes).mockReturnValue(mockNotes);

      const result = await listHistoryTreeHashes();

      expect(result).toEqual(['abc123def456']);
    });
  });

  describe('getAllHistoryNotes', () => {
    it('should get all notes for all tree hashes', async () => {
      // Mock listNotes
      const mockNotes: Array<[string, string]> = [
        ['abc123', 'note content 1'],
        ['def456', 'note content 2'],
      ];
      const mockNote1 = 'treeHash: abc123\nruns: []';
      const mockNote2 = 'treeHash: def456\nruns: []';

      vi.mocked(listNotes).mockReturnValue(mockNotes);
      vi.mocked(readNote)
        .mockReturnValueOnce(mockNote1) // first read call
        .mockReturnValueOnce(mockNote2); // second read call

      const result = await getAllHistoryNotes();

      expect(result).toHaveLength(2);
      expect(result[0].treeHash).toBe('abc123');
      expect(result[1].treeHash).toBe('def456');

      // Should call listNotes once and readNote twice
      expect(listNotes).toHaveBeenCalledTimes(1);
      expect(readNote).toHaveBeenCalledTimes(2);
    });

    it('should use custom notes ref', async () => {
      const mockNotes: Array<[string, string]> = [['abc123', 'note content']];
      const mockNote = 'treeHash: abc123\nruns: []';

      vi.mocked(listNotes).mockReturnValue(mockNotes);
      vi.mocked(readNote).mockReturnValue(mockNote);

      await getAllHistoryNotes('custom/notes/ref');

      expect(listNotes).toHaveBeenCalledWith('custom/notes/ref');
      expect(readNote).toHaveBeenCalledWith('custom/notes/ref', 'abc123');
    });

    it('should return empty array when no tree hashes exist', async () => {
      vi.mocked(listNotes).mockReturnValue([]);

      const result = await getAllHistoryNotes();

      expect(result).toEqual([]);
    });

    it('should skip notes that fail to read', async () => {
      const mockNotes: Array<[string, string]> = [
        ['abc123', 'note content 1'],
        ['def456', 'note content 2'],
        ['ghi789', 'note content 3'],
      ];
      const mockNote1 = 'treeHash: abc123\nruns: []';
      const mockNote3 = 'treeHash: ghi789\nruns: []';

      vi.mocked(listNotes).mockReturnValue(mockNotes);
      vi.mocked(readNote)
        .mockReturnValueOnce(mockNote1)
        .mockReturnValueOnce(null) // Failed to read def456
        .mockReturnValueOnce(mockNote3);

      const result = await getAllHistoryNotes();

      // Should get 2 notes (skip the one that failed)
      expect(result).toHaveLength(2);
      expect(result[0].treeHash).toBe('abc123');
      expect(result[1].treeHash).toBe('ghi789');
    });

    it('should handle no notes gracefully', async () => {
      vi.mocked(listNotes).mockReturnValue([]);

      const result = await getAllHistoryNotes();

      expect(result).toEqual([]);
      expect(listNotes).toHaveBeenCalledTimes(1); // Only list call
    });
  });

  describe('hasHistoryForTree', () => {
    it('should return true when history exists', async () => {
      const mockYaml = 'treeHash: abc123\nruns: []';
      vi.mocked(readNote).mockReturnValue(mockYaml);

      const result = await hasHistoryForTree('abc123def456');

      expect(result).toBe(true);
      expect(readNote).toHaveBeenCalledWith(
        'vibe-validate/validate',
        'abc123def456'
      );
    });

    it('should return false when history does not exist', async () => {
      vi.mocked(readNote).mockReturnValue(null);

      const result = await hasHistoryForTree('nonexistent');

      expect(result).toBe(false);
    });

    it('should use custom notes ref', async () => {
      const mockYaml = 'treeHash: abc123\nruns: []';
      vi.mocked(readNote).mockReturnValue(mockYaml);

      await hasHistoryForTree('abc123def456', 'custom/notes/ref');

      expect(readNote).toHaveBeenCalledWith(
        'custom/notes/ref',
        'abc123def456'
      );
    });

    it('should return false on any error', async () => {
      vi.mocked(readNote).mockImplementation(() => {
        throw new Error('Git command failed');
      });

      const result = await hasHistoryForTree('abc123def456');

      expect(result).toBe(false);
    });
  });
});
