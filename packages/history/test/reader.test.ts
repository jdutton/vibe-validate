/**
 * Tests for git notes reader
 */

import { readNote, listNoteObjects } from '@vibe-validate/git';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  readHistoryNote,
  listHistoryTreeHashes,
  getAllHistoryNotes,
  hasHistoryForTree,
} from '../src/reader.js';

// Mock @vibe-validate/git
vi.mock('@vibe-validate/git', () => ({
  readNote: vi.fn(),
  listNoteObjects: vi.fn(),
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

    it('should accept results with unknown fields (forward compatibility)', async () => {
      // When a newer version of vibe-validate writes extra fields,
      // older readers should still accept the result (strip unknowns, not reject)
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
      futureField: some-new-data
      phases:
        - name: Testing
          passed: true
          durationSecs: 5
          newPhaseMetric: 42
          steps:
            - name: Unit Tests
              command: npm test
              exitCode: 0
              durationSecs: 5
              passed: true
              newStepFeature: enabled
`;

      vi.mocked(readNote).mockReturnValue(mockYaml);

      const result = await readHistoryNote('abc123def456');

      // Should NOT silently reject the run - unknown fields should be stripped, not rejected
      expect(result).toBeDefined();
      expect(result?.runs).toHaveLength(1);
      expect(result?.runs[0].id).toBe('run-1');
      expect(result?.runs[0].passed).toBe(true);
    });

    it('should silently ignore old format notes without runs array (pre-0.19.0)', async () => {
      // Simulate legacy history from before PR #123 (composite hash format)
      const oldFormatYaml = `
treeHash: 98c9247ff1446b44d2fb80ac05ce09c11bb3d3eb
timestamp: '2025-10-21T09:00:00Z'
passed: true
duration: 5000
`;

      vi.mocked(readNote).mockReturnValue(oldFormatYaml);

      const result = await readHistoryNote('98c9247ff1446b44d2fb80ac05ce09c11bb3d3eb');

      // Should return null for old format notes (missing 'runs' array)
      expect(result).toBeNull();
      // No warnings should be logged - this is expected during version upgrades
      // New validations will create properly formatted notes
    });
  });

  describe('listHistoryTreeHashes', () => {
    it('should list all tree hashes with notes', async () => {
      vi.mocked(listNoteObjects).mockReturnValue([
        'abc123def456' as any,
        '789012abc345' as any,
        'fedcba987654' as any,
      ]);

      const result = await listHistoryTreeHashes();

      expect(result).toEqual([
        'abc123def456',
        '789012abc345',
        'fedcba987654',
      ]);

      expect(listNoteObjects).toHaveBeenCalledWith('vibe-validate/validate');
    });

    it('should use custom notes ref when provided', async () => {
      vi.mocked(listNoteObjects).mockReturnValue(['abc123def456' as any]);

      await listHistoryTreeHashes('custom/notes/ref');

      expect(listNoteObjects).toHaveBeenCalledWith('custom/notes/ref');
    });

    it('should return empty array when no notes exist', async () => {
      vi.mocked(listNoteObjects).mockReturnValue([]);

      const result = await listHistoryTreeHashes();

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      vi.mocked(listNoteObjects).mockImplementation(() => {
        throw new Error('Git command failed');
      });

      const result = await listHistoryTreeHashes();

      expect(result).toEqual([]);
    });

    it('should handle single tree hash', async () => {
      vi.mocked(listNoteObjects).mockReturnValue(['abc123def456' as any]);

      const result = await listHistoryTreeHashes();

      expect(result).toEqual(['abc123def456']);
    });
  });

  describe('getAllHistoryNotes', () => {
    it('should get all notes for all tree hashes', async () => {
      vi.mocked(listNoteObjects).mockReturnValue([
        'abc123' as any,
        'def456' as any,
      ]);
      const mockNote1 = 'treeHash: abc123\nruns: []';
      const mockNote2 = 'treeHash: def456\nruns: []';

      vi.mocked(readNote)
        .mockReturnValueOnce(mockNote1) // first read call
        .mockReturnValueOnce(mockNote2); // second read call

      const result = await getAllHistoryNotes();

      expect(result).toHaveLength(2);
      expect(result[0].treeHash).toBe('abc123');
      expect(result[1].treeHash).toBe('def456');

      // Should call listNoteObjects once and readNote twice
      expect(listNoteObjects).toHaveBeenCalledTimes(1);
      expect(readNote).toHaveBeenCalledTimes(2);
    });

    it('should use custom notes ref', async () => {
      vi.mocked(listNoteObjects).mockReturnValue(['abc123' as any]);
      const mockNote = 'treeHash: abc123\nruns: []';

      vi.mocked(readNote).mockReturnValue(mockNote);

      await getAllHistoryNotes('custom/notes/ref');

      expect(listNoteObjects).toHaveBeenCalledWith('custom/notes/ref');
      expect(readNote).toHaveBeenCalledWith('custom/notes/ref', 'abc123');
    });

    it('should return empty array when no tree hashes exist', async () => {
      vi.mocked(listNoteObjects).mockReturnValue([]);

      const result = await getAllHistoryNotes();

      expect(result).toEqual([]);
    });

    it('should skip notes that fail to read', async () => {
      vi.mocked(listNoteObjects).mockReturnValue([
        'abc123' as any,
        'def456' as any,
        'ghi789' as any,
      ]);
      const mockNote1 = 'treeHash: abc123\nruns: []';
      const mockNote3 = 'treeHash: ghi789\nruns: []';

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
      vi.mocked(listNoteObjects).mockReturnValue([]);

      const result = await getAllHistoryNotes();

      expect(result).toEqual([]);
      expect(listNoteObjects).toHaveBeenCalledTimes(1);
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
