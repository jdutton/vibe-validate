/**
 * Tests for validation history pruning
 */

import * as git from '@vibe-validate/git';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { pruneHistoryByAge, pruneAllHistory } from '../src/pruner.js';
import * as reader from '../src/reader.js';
import type { HistoryNote } from '../src/types.js';

// Mock dependencies using secure git API
vi.mock('@vibe-validate/git');
vi.mock('../src/reader.js');

/**
 * Helper: Create a date N days ago
 */
function createOldDate(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date;
}

/**
 * Helper: Create a validation run with defaults
 */
function createRun(overrides: Partial<{
  id: string;
  timestamp: string;
  duration: number;
  passed: boolean;
  branch: string;
  headCommit: string;
  uncommittedChanges: boolean;
  treeHash: string;
}> = {}) {
  const now = new Date().toISOString();
  const treeHash = overrides.treeHash ?? 'abc123';

  return {
    id: 'run-1',
    timestamp: now,
    duration: 5000,
    passed: true,
    branch: 'main',
    headCommit: 'commit123',
    uncommittedChanges: false,
    ...overrides,
    result: {
      passed: overrides.passed ?? true,
      timestamp: overrides.timestamp ?? now,
      treeHash,
      phases: [],
    },
  };
}

/**
 * Helper: Create a history note with defaults
 */
function createHistoryNote(overrides: Partial<{
  treeHash: string;
  runs: ReturnType<typeof createRun>[];
}> = {}) {
  const treeHash = overrides.treeHash ?? 'abc123';

  return {
    treeHash,
    runs: overrides.runs ?? [createRun({ treeHash })],
  };
}

/**
 * Helper: Setup pruner test with mocked notes
 */
function setupPrunerTest(notes: HistoryNote[], removeNoteResolves = true) {
  vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);
  if (removeNoteResolves) {
    vi.mocked(git.removeNote).mockResolvedValue();
  }
}

describe('pruner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pruneHistoryByAge', () => {
    describe('when no notes exist', () => {
      it('should return zero counts', async () => {
        setupPrunerTest([]);
        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(0);
        expect(result.runsPruned).toBe(0);
        expect(result.notesRemaining).toBe(0);
        expect(result.prunedTreeHashes).toEqual([]);
        expect(git.removeNote).not.toHaveBeenCalled();
      });
    });

    describe('when notes exist but none are old enough', () => {
      it('should not prune any notes', async () => {
        setupPrunerTest([createHistoryNote()]);
        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(0);
        expect(result.runsPruned).toBe(0);
        expect(result.notesRemaining).toBe(1);
        expect(result.prunedTreeHashes).toEqual([]);
        expect(git.removeNote).not.toHaveBeenCalled();
      });
    });

    describe('when notes exceed age threshold', () => {
      it('should prune old notes', async () => {
        const oldTimestamp = createOldDate(100).toISOString();
        const oldNote = createHistoryNote({
          treeHash: 'old-abc123',
          runs: [createRun({ treeHash: 'old-abc123', timestamp: oldTimestamp })],
        });
        setupPrunerTest([oldNote]);

        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(1);
        expect(result.notesRemaining).toBe(0);
        expect(result.prunedTreeHashes).toEqual(['old-abc123']);
        expect(git.removeNote).toHaveBeenCalledWith(
          'vibe-validate/validate',
          'old-abc123'
        );
      });

      it('should prune multiple old notes', async () => {
        const oldTimestamp = createOldDate(100).toISOString();
        const oldNotes = [
          createHistoryNote({
            treeHash: 'old-1',
            runs: [createRun({ id: 'run-1', treeHash: 'old-1', timestamp: oldTimestamp, headCommit: 'commit1' })],
          }),
          createHistoryNote({
            treeHash: 'old-2',
            runs: [createRun({ id: 'run-2', treeHash: 'old-2', timestamp: oldTimestamp, headCommit: 'commit2' })],
          }),
        ];
        setupPrunerTest(oldNotes);

        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(2);
        expect(result.runsPruned).toBe(2);
        expect(result.notesRemaining).toBe(0);
        expect(result.prunedTreeHashes).toEqual(['old-1', 'old-2']);
        expect(git.removeNote).toHaveBeenCalledTimes(2);
      });

      it('should count multiple runs in pruned notes', async () => {
        const oldTimestamp = createOldDate(100).toISOString();
        const oldNote = createHistoryNote({
          treeHash: 'old-abc123',
          runs: [
            createRun({ id: 'run-1', treeHash: 'old-abc123', timestamp: oldTimestamp, headCommit: 'commit1' }),
            createRun({ id: 'run-2', treeHash: 'old-abc123', timestamp: oldTimestamp, headCommit: 'commit2' }),
            createRun({ id: 'run-3', treeHash: 'old-abc123', timestamp: oldTimestamp, headCommit: 'commit3' }),
          ],
        });
        setupPrunerTest([oldNote]);

        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(3); // All 3 runs counted
      });
    });

    describe('when notes are mixed old and new', () => {
      it('should prune only old notes', async () => {
        const oldTimestamp = createOldDate(100).toISOString();
        const oldNote = createHistoryNote({
          treeHash: 'old-abc123',
          runs: [createRun({ id: 'run-1', treeHash: 'old-abc123', timestamp: oldTimestamp, headCommit: 'commit1' })],
        });
        const newNote = createHistoryNote({
          treeHash: 'new-def456',
          runs: [createRun({ id: 'run-2', treeHash: 'new-def456', headCommit: 'commit2' })],
        });
        setupPrunerTest([oldNote, newNote]);

        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(1);
        expect(result.notesRemaining).toBe(1);
        expect(result.prunedTreeHashes).toEqual(['old-abc123']);

        // Should only delete old note
        expect(git.removeNote).toHaveBeenCalledWith(
          'vibe-validate/validate',
          'old-abc123'
        );
        expect(git.removeNote).toHaveBeenCalledTimes(1);
      });
    });

    describe('dry-run mode', () => {
      it('should count notes but not delete when dryRun=true', async () => {
        const oldTimestamp = createOldDate(100).toISOString();
        const oldNote = createHistoryNote({
          treeHash: 'old-abc123',
          runs: [createRun({ treeHash: 'old-abc123', timestamp: oldTimestamp })],
        });
        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue([oldNote]);

        const result = await pruneHistoryByAge(90, {}, true);

        // Should report what would be pruned
        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(1);
        expect(result.prunedTreeHashes).toEqual(['old-abc123']);

        // But should NOT actually delete
        expect(git.removeNote).not.toHaveBeenCalled();
      });
    });

    describe('custom configuration', () => {
      it('should use custom notes ref', async () => {
        const oldTimestamp = createOldDate(100).toISOString();
        const oldNote = createHistoryNote({
          treeHash: 'old-abc123',
          runs: [createRun({ treeHash: 'old-abc123', timestamp: oldTimestamp })],
        });
        setupPrunerTest([oldNote]);

        await pruneHistoryByAge(90, {
          gitNotes: {
            ref: 'custom/notes/ref',
          },
        });

        expect(reader.getAllHistoryNotes).toHaveBeenCalledWith('custom/notes/ref');
        expect(git.removeNote).toHaveBeenCalledWith(
          'custom/notes/ref',
          'old-abc123'
        );
      });
    });

    describe('error handling', () => {
      it('should ignore git command errors and continue', async () => {
        const oldTimestamp = createOldDate(100).toISOString();
        const oldNotes = [
          createHistoryNote({
            treeHash: 'old-1',
            runs: [createRun({ id: 'run-1', treeHash: 'old-1', timestamp: oldTimestamp, headCommit: 'commit1' })],
          }),
          createHistoryNote({
            treeHash: 'old-2',
            runs: [createRun({ id: 'run-2', treeHash: 'old-2', timestamp: oldTimestamp, headCommit: 'commit2' })],
          }),
        ];
        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(oldNotes);

        // First delete fails, second succeeds
        vi.mocked(git.removeNote)
          .mockRejectedValueOnce(new Error('Git error'))
          .mockResolvedValueOnce();

        const result = await pruneHistoryByAge(90);

        // Should still count both as pruned
        expect(result.notesPruned).toBe(2);
        expect(result.runsPruned).toBe(2);
        expect(result.prunedTreeHashes).toEqual(['old-1', 'old-2']);
      });

      it('should skip notes with no runs', async () => {
        const oldTimestamp = createOldDate(100).toISOString();
        const notes = [
          createHistoryNote({
            treeHash: 'empty-note',
            runs: [],
          }),
          createHistoryNote({
            treeHash: 'old-note',
            runs: [createRun({ id: 'run-1', treeHash: 'old-note', timestamp: oldTimestamp, headCommit: 'commit1' })],
          }),
        ];
        setupPrunerTest(notes);

        const result = await pruneHistoryByAge(90);

        // Should only prune the one with runs
        expect(result.notesPruned).toBe(1);
        expect(result.prunedTreeHashes).toEqual(['old-note']);
        expect(git.removeNote).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('pruneAllHistory', () => {
    describe('when no notes exist', () => {
      it('should return zero counts', async () => {
        setupPrunerTest([]);

        const result = await pruneAllHistory();

        expect(result.notesPruned).toBe(0);
        expect(result.runsPruned).toBe(0);
        expect(result.notesRemaining).toBe(0);
        expect(result.prunedTreeHashes).toEqual([]);
        expect(git.removeNote).not.toHaveBeenCalled();
      });
    });

    describe('when notes exist', () => {
      it('should prune all notes', async () => {
        const notes = [
          createHistoryNote({
            treeHash: 'abc123',
            runs: [createRun({ id: 'run-1', treeHash: 'abc123', headCommit: 'commit1' })],
          }),
          createHistoryNote({
            treeHash: 'def456',
            runs: [createRun({ id: 'run-2', treeHash: 'def456', headCommit: 'commit2' })],
          }),
        ];
        setupPrunerTest(notes);

        const result = await pruneAllHistory();

        expect(result.notesPruned).toBe(2);
        expect(result.runsPruned).toBe(2);
        expect(result.notesRemaining).toBe(0);
        expect(result.prunedTreeHashes).toEqual(['abc123', 'def456']);

        expect(git.removeNote).toHaveBeenCalledWith(
          'vibe-validate/validate',
          'abc123'
        );
        expect(git.removeNote).toHaveBeenCalledWith(
          'vibe-validate/validate',
          'def456'
        );
      });

      it('should count all runs in pruned notes', async () => {
        const note = createHistoryNote({
          treeHash: 'abc123',
          runs: [
            createRun({ id: 'run-1', treeHash: 'abc123', headCommit: 'commit1' }),
            createRun({ id: 'run-2', treeHash: 'abc123', headCommit: 'commit2' }),
            createRun({ id: 'run-3', treeHash: 'abc123', headCommit: 'commit3' }),
          ],
        });
        setupPrunerTest([note]);

        const result = await pruneAllHistory();

        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(3);
      });

      it('should handle notes without runs gracefully', async () => {
        const note: HistoryNote = {
          treeHash: 'abc123',
          runs: undefined as unknown as HistoryNote['runs'], // Missing runs
        };
        setupPrunerTest([note]);

        const result = await pruneAllHistory();

        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(0); // Should handle undefined runs
      });
    });

    describe('dry-run mode', () => {
      it('should count notes but not delete when dryRun=true', async () => {
        const note = createHistoryNote();
        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue([note]);

        const result = await pruneAllHistory({}, true);

        // Should report what would be pruned
        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(1);
        expect(result.prunedTreeHashes).toEqual(['abc123']);

        // But should NOT actually delete
        expect(git.removeNote).not.toHaveBeenCalled();
      });
    });

    describe('custom configuration', () => {
      it('should use custom notes ref', async () => {
        const note = createHistoryNote();
        setupPrunerTest([note]);

        await pruneAllHistory({
          gitNotes: {
            ref: 'custom/notes/ref',
          },
        });

        expect(reader.getAllHistoryNotes).toHaveBeenCalledWith('custom/notes/ref');
        expect(git.removeNote).toHaveBeenCalledWith(
          'custom/notes/ref',
          'abc123'
        );
      });
    });

    describe('error handling', () => {
      it('should ignore git command errors and continue', async () => {
        const notes = [
          createHistoryNote({
            treeHash: 'note-1',
            runs: [createRun({ id: 'run-1', treeHash: 'note-1', headCommit: 'commit1' })],
          }),
          createHistoryNote({
            treeHash: 'note-2',
            runs: [createRun({ id: 'run-2', treeHash: 'note-2', headCommit: 'commit2' })],
          }),
        ];
        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);

        // First delete fails, second succeeds
        vi.mocked(git.removeNote)
          .mockRejectedValueOnce(new Error('Git error'))
          .mockResolvedValueOnce();

        const result = await pruneAllHistory();

        // Should still count both as pruned
        expect(result.notesPruned).toBe(2);
        expect(result.runsPruned).toBe(2);
        expect(result.prunedTreeHashes).toEqual(['note-1', 'note-2']);
      });
    });
  });
});
