/**
 * Tests for validation history pruning
 */

import * as git from '@vibe-validate/git';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { pruneHistoryByAge, pruneAllHistory, pruneLegacyNotes } from '../src/pruner.js';
import * as reader from '../src/reader.js';
import { VALIDATION_NOTES_REF } from '../src/schemas.js';
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
 * Helper: One note whose single run is 100 days old (past the 90-day threshold)
 */
function createOldNote(treeHash = 'old-abc123') {
  const timestamp = createOldDate(100).toISOString();
  return createHistoryNote({ treeHash, runs: [createRun({ treeHash, timestamp })] });
}

/**
 * Helper: One single-run note per tree hash (run-N / commitN), optionally all at one timestamp
 */
function createNotes(treeHashes: string[], timestamp?: string) {
  return treeHashes.map((treeHash, i) =>
    createHistoryNote({
      treeHash,
      runs: [
        createRun({
          id: `run-${i + 1}`,
          treeHash,
          headCommit: `commit${i + 1}`,
          ...(timestamp === undefined ? {} : { timestamp }),
        }),
      ],
    })
  );
}

/**
 * Helper: Assert a prune that removed nothing
 */
function expectNothingPruned(
  result: Awaited<ReturnType<typeof pruneAllHistory>>,
  notesRemaining: number
) {
  expect(result.notesPruned).toBe(0);
  expect(result.runsPruned).toBe(0);
  expect(result.notesRemaining).toBe(notesRemaining);
  expect(result.prunedTreeHashes).toEqual([]);
  expect(git.removeNote).not.toHaveBeenCalled();
}

/**
 * Helper: Assert a dry run that would have pruned one note and removed nothing
 */
function expectDryRunOfOne(result: Awaited<ReturnType<typeof pruneAllHistory>>) {
  expect(result.notesPruned).toBe(1);
  expect(git.removeNote).not.toHaveBeenCalled();
}

/**
 * Helper: Mock the given notes, then make the first delete fail and the second succeed
 */
function setupFirstRemoveFails(notes: HistoryNote[]) {
  vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);
  vi.mocked(git.removeNote)
    .mockRejectedValueOnce(new Error('Git error'))
    .mockResolvedValueOnce();
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
        expectNothingPruned(await pruneHistoryByAge(90), 0);
      });
    });

    describe('when notes exist but none are old enough', () => {
      it('should not prune any notes', async () => {
        setupPrunerTest([createHistoryNote()]);
        expectNothingPruned(await pruneHistoryByAge(90), 1);
      });
    });

    describe('when notes exceed age threshold', () => {
      it('should prune old notes', async () => {
        setupPrunerTest([createOldNote()]);

        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(1);
        expect(result.notesRemaining).toBe(0);
        expect(result.prunedTreeHashes).toEqual(['old-abc123']);
        expect(git.removeNote).toHaveBeenCalledWith(
          'vibe-validate/leveled-runs',
          'old-abc123'
        );
      });

      it('should prune multiple old notes', async () => {
        setupPrunerTest(createNotes(['old-1', 'old-2'], createOldDate(100).toISOString()));

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
          'vibe-validate/leveled-runs',
          'old-abc123'
        );
        expect(git.removeNote).toHaveBeenCalledTimes(1);
      });
    });

    describe('dry-run mode', () => {
      it('should count notes but not delete when dryRun=true', async () => {
        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue([createOldNote()]);

        const result = await pruneHistoryByAge(90, true);

        // Should report what would be pruned
        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(1);
        expect(result.prunedTreeHashes).toEqual(['old-abc123']);

        // But should NOT actually delete
        expect(git.removeNote).not.toHaveBeenCalled();
      });
    });

    describe('notes ref', () => {
      it('removes from VALIDATION_NOTES_REF and takes no ref-bearing config', async () => {
        setupPrunerTest([createOldNote()]);

        await pruneHistoryByAge(90, false);

        expect(reader.getAllHistoryNotes).toHaveBeenCalledWith();
        expect(git.removeNote).toHaveBeenCalledWith(VALIDATION_NOTES_REF, 'old-abc123');
      });

      it('treats the second argument as dryRun', async () => {
        setupPrunerTest([createOldNote()]);

        expectDryRunOfOne(await pruneHistoryByAge(90, true));
      });
    });

    describe('error handling', () => {
      it('should ignore git command errors and continue', async () => {
        setupFirstRemoveFails(createNotes(['old-1', 'old-2'], createOldDate(100).toISOString()));

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
        expectNothingPruned(await pruneAllHistory(), 0);
      });
    });

    describe('when notes exist', () => {
      it('should prune all notes', async () => {
        setupPrunerTest(createNotes(['abc123', 'def456']));

        const result = await pruneAllHistory();

        expect(result.notesPruned).toBe(2);
        expect(result.runsPruned).toBe(2);
        expect(result.notesRemaining).toBe(0);
        expect(result.prunedTreeHashes).toEqual(['abc123', 'def456']);

        expect(git.removeNote).toHaveBeenCalledWith(
          'vibe-validate/leveled-runs',
          'abc123'
        );
        expect(git.removeNote).toHaveBeenCalledWith(
          'vibe-validate/leveled-runs',
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

        const result = await pruneAllHistory(true);

        // Should report what would be pruned
        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(1);
        expect(result.prunedTreeHashes).toEqual(['abc123']);

        // But should NOT actually delete
        expect(git.removeNote).not.toHaveBeenCalled();
      });
    });

    describe('notes ref', () => {
      it('removes from VALIDATION_NOTES_REF and takes no ref-bearing config', async () => {
        setupPrunerTest([createHistoryNote()]);

        await pruneAllHistory(false);

        expect(reader.getAllHistoryNotes).toHaveBeenCalledWith();
        expect(git.removeNote).toHaveBeenCalledWith(VALIDATION_NOTES_REF, 'abc123');
      });

      it('treats the first argument as dryRun', async () => {
        setupPrunerTest([createHistoryNote()]);

        expectDryRunOfOne(await pruneAllHistory(true));
      });
    });

    describe('error handling', () => {
      it('should ignore git command errors and continue', async () => {
        setupFirstRemoveFails(createNotes(['note-1', 'note-2']));

        const result = await pruneAllHistory();

        // Should still count both as pruned
        expect(result.notesPruned).toBe(2);
        expect(result.runsPruned).toBe(2);
        expect(result.prunedTreeHashes).toEqual(['note-1', 'note-2']);
      });
    });
  });
});

describe('pruneLegacyNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes notes from the pre-0.15 runs ref only, counting their raw runs', async () => {
    vi.mocked(git.listNoteObjects).mockReturnValue(['legacy-1', 'legacy-2'] as git.TreeHash[]);
    vi.mocked(git.readNote)
      .mockReturnValueOnce('runs:\n  - a\n  - b\n')
      .mockReturnValueOnce('not: a history note\n');

    const result = await pruneLegacyNotes();

    expect(git.listNoteObjects).toHaveBeenCalledWith('vibe-validate/runs');
    expect(git.removeNote).toHaveBeenCalledWith('vibe-validate/runs', 'legacy-1');
    expect(git.removeNote).toHaveBeenCalledWith('vibe-validate/runs', 'legacy-2');
    expect(git.removeNote).not.toHaveBeenCalledWith(VALIDATION_NOTES_REF, expect.anything());
    expect(reader.getAllHistoryNotes).not.toHaveBeenCalled();
    expect(result).toEqual({
      notesPruned: 2,
      runsPruned: 2,
      notesRemaining: 0,
      prunedTreeHashes: ['legacy-1', 'legacy-2'],
    });
  });

  it('removes nothing in dry-run mode', async () => {
    vi.mocked(git.listNoteObjects).mockReturnValue(['legacy-1'] as git.TreeHash[]);
    vi.mocked(git.readNote).mockReturnValue(null);

    const result = await pruneLegacyNotes(true);

    expect(result.notesPruned).toBe(1);
    expect(git.removeNote).not.toHaveBeenCalled();
  });
});
