/**
 * Tests for git notes reader
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import {
  readHistoryNote,
  listHistoryTreeHashes,
  getAllHistoryNotes,
  hasHistoryForTree,
} from '../src/reader.js';

// Mock child_process
vi.mock('child_process');

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

      vi.mocked(execSync).mockReturnValue(mockYaml);

      const result = await readHistoryNote('abc123def456');

      expect(result).toBeDefined();
      expect(result?.treeHash).toBe('abc123def456');
      expect(result?.runs).toHaveLength(1);
      expect(result?.runs[0].id).toBe('run-1');
      expect(result?.runs[0].passed).toBe(true);

      expect(execSync).toHaveBeenCalledWith(
        'git notes --ref=vibe-validate/validate show abc123def456',
        expect.objectContaining({
          encoding: 'utf8',
          timeout: 30000,
        })
      );
    });

    it('should use custom notes ref when provided', async () => {
      const mockYaml = 'treeHash: abc123\nruns: []';
      vi.mocked(execSync).mockReturnValue(mockYaml);

      await readHistoryNote('abc123def456', 'custom/notes/ref');

      expect(execSync).toHaveBeenCalledWith(
        'git notes --ref=custom/notes/ref show abc123def456',
        expect.any(Object)
      );
    });

    it('should return null when note does not exist', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('No note found');
      });

      const result = await readHistoryNote('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null on any error', async () => {
      vi.mocked(execSync).mockImplementation(() => {
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

      vi.mocked(execSync).mockReturnValue(mockYaml);

      const result = await readHistoryNote('abc123def456');

      expect(result?.runs).toHaveLength(2);
      expect(result?.runs[0].id).toBe('run-1');
      expect(result?.runs[1].id).toBe('run-2');
    });
  });

  describe('listHistoryTreeHashes', () => {
    it('should list all tree hashes with notes', async () => {
      const mockOutput = `
note1sha abc123def456
note2sha 789012abc345
note3sha fedcba987654
`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = await listHistoryTreeHashes();

      expect(result).toEqual([
        'abc123def456',
        '789012abc345',
        'fedcba987654',
      ]);

      expect(execSync).toHaveBeenCalledWith(
        'git notes --ref=vibe-validate/validate list',
        expect.objectContaining({
          encoding: 'utf8',
          timeout: 30000,
        })
      );
    });

    it('should use custom notes ref when provided', async () => {
      const mockOutput = 'note1sha abc123def456';
      vi.mocked(execSync).mockReturnValue(mockOutput);

      await listHistoryTreeHashes('custom/notes/ref');

      expect(execSync).toHaveBeenCalledWith(
        'git notes --ref=custom/notes/ref list',
        expect.any(Object)
      );
    });

    it('should return empty array when no notes exist', async () => {
      vi.mocked(execSync).mockReturnValue('');

      const result = await listHistoryTreeHashes();

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Git command failed');
      });

      const result = await listHistoryTreeHashes();

      expect(result).toEqual([]);
    });

    it('should filter out empty lines', async () => {
      const mockOutput = `
note1sha abc123def456

note2sha 789012abc345


`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = await listHistoryTreeHashes();

      expect(result).toEqual([
        'abc123def456',
        '789012abc345',
      ]);
    });

    it('should handle single tree hash', async () => {
      const mockOutput = 'note1sha abc123def456\n';
      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = await listHistoryTreeHashes();

      expect(result).toEqual(['abc123def456']);
    });
  });

  describe('getAllHistoryNotes', () => {
    it('should get all notes for all tree hashes', async () => {
      // Mock listHistoryTreeHashes
      const mockListOutput = 'note1sha abc123\nnote2sha def456';
      const mockNote1 = 'treeHash: abc123\nruns: []';
      const mockNote2 = 'treeHash: def456\nruns: []';

      vi.mocked(execSync)
        .mockReturnValueOnce(mockListOutput) // list call
        .mockReturnValueOnce(mockNote1) // first show call
        .mockReturnValueOnce(mockNote2); // second show call

      const result = await getAllHistoryNotes();

      expect(result).toHaveLength(2);
      expect(result[0].treeHash).toBe('abc123');
      expect(result[1].treeHash).toBe('def456');

      // Should call list once and show twice
      expect(execSync).toHaveBeenCalledTimes(3);
    });

    it('should use custom notes ref', async () => {
      const mockListOutput = 'note1sha abc123';
      const mockNote = 'treeHash: abc123\nruns: []';

      vi.mocked(execSync)
        .mockReturnValueOnce(mockListOutput)
        .mockReturnValueOnce(mockNote);

      await getAllHistoryNotes('custom/notes/ref');

      expect(execSync).toHaveBeenCalledWith(
        'git notes --ref=custom/notes/ref list',
        expect.any(Object)
      );
      expect(execSync).toHaveBeenCalledWith(
        'git notes --ref=custom/notes/ref show abc123',
        expect.any(Object)
      );
    });

    it('should return empty array when no tree hashes exist', async () => {
      vi.mocked(execSync).mockReturnValue('');

      const result = await getAllHistoryNotes();

      expect(result).toEqual([]);
    });

    it('should skip notes that fail to read', async () => {
      const mockListOutput = 'note1sha abc123\nnote2sha def456\nnote3sha ghi789';
      const mockNote1 = 'treeHash: abc123\nruns: []';
      const mockNote3 = 'treeHash: ghi789\nruns: []';

      vi.mocked(execSync)
        .mockReturnValueOnce(mockListOutput)
        .mockReturnValueOnce(mockNote1)
        .mockImplementationOnce(() => {
          throw new Error('Failed to read note');
        })
        .mockReturnValueOnce(mockNote3);

      const result = await getAllHistoryNotes();

      // Should get 2 notes (skip the one that failed)
      expect(result).toHaveLength(2);
      expect(result[0].treeHash).toBe('abc123');
      expect(result[1].treeHash).toBe('ghi789');
    });

    it('should handle no notes gracefully', async () => {
      vi.mocked(execSync).mockReturnValue('');

      const result = await getAllHistoryNotes();

      expect(result).toEqual([]);
      expect(execSync).toHaveBeenCalledTimes(1); // Only list call
    });
  });

  describe('hasHistoryForTree', () => {
    it('should return true when history exists', async () => {
      const mockYaml = 'treeHash: abc123\nruns: []';
      vi.mocked(execSync).mockReturnValue(mockYaml);

      const result = await hasHistoryForTree('abc123def456');

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith(
        'git notes --ref=vibe-validate/validate show abc123def456',
        expect.any(Object)
      );
    });

    it('should return false when history does not exist', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('No note found');
      });

      const result = await hasHistoryForTree('nonexistent');

      expect(result).toBe(false);
    });

    it('should use custom notes ref', async () => {
      const mockYaml = 'treeHash: abc123\nruns: []';
      vi.mocked(execSync).mockReturnValue(mockYaml);

      await hasHistoryForTree('abc123def456', 'custom/notes/ref');

      expect(execSync).toHaveBeenCalledWith(
        'git notes --ref=custom/notes/ref show abc123def456',
        expect.any(Object)
      );
    });

    it('should return false on any error', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Git command failed');
      });

      const result = await hasHistoryForTree('abc123def456');

      expect(result).toBe(false);
    });
  });
});
