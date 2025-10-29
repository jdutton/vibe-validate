/**
 * Tests for validation history pruning
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { pruneHistoryByAge, pruneAllHistory } from '../src/pruner.js';
import * as reader from '../src/reader.js';
import type { HistoryNote } from '../src/types.js';

// Mock dependencies
vi.mock('child_process');
vi.mock('../src/reader.js');

describe('pruner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pruneHistoryByAge', () => {
    describe('when no notes exist', () => {
      it('should return zero counts', async () => {
        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue([]);

        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(0);
        expect(result.runsPruned).toBe(0);
        expect(result.notesRemaining).toBe(0);
        expect(result.prunedTreeHashes).toEqual([]);
        expect(execSync).not.toHaveBeenCalled();
      });
    });

    describe('when notes exist but none are old enough', () => {
      it('should not prune any notes', async () => {
        const recentNotes: HistoryNote[] = [
          {
            treeHash: 'abc123',
            runs: [
              {
                id: 'run-1',
                timestamp: new Date().toISOString(), // Recent
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit123',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: new Date().toISOString(),
                  treeHash: 'abc123',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(recentNotes);

        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(0);
        expect(result.runsPruned).toBe(0);
        expect(result.notesRemaining).toBe(1);
        expect(result.prunedTreeHashes).toEqual([]);
        expect(execSync).not.toHaveBeenCalled();
      });
    });

    describe('when notes exceed age threshold', () => {
      it('should prune old notes', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 100); // 100 days ago

        const oldNotes: HistoryNote[] = [
          {
            treeHash: 'old-abc123',
            runs: [
              {
                id: 'run-1',
                timestamp: oldDate.toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit123',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: oldDate.toISOString(),
                  treeHash: 'old-abc123',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(oldNotes);
        vi.mocked(execSync).mockReturnValue('');

        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(1);
        expect(result.notesRemaining).toBe(0);
        expect(result.prunedTreeHashes).toEqual(['old-abc123']);

        expect(execSync).toHaveBeenCalledWith(
          'git notes --ref=vibe-validate/runs remove old-abc123',
          expect.objectContaining({
            encoding: 'utf8',
            timeout: 30000,
          })
        );
      });

      it('should prune multiple old notes', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 100);

        const oldNotes: HistoryNote[] = [
          {
            treeHash: 'old-1',
            runs: [
              {
                id: 'run-1',
                timestamp: oldDate.toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit1',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: oldDate.toISOString(),
                  treeHash: 'old-1',
                  phases: [],
                },
              },
            ],
          },
          {
            treeHash: 'old-2',
            runs: [
              {
                id: 'run-2',
                timestamp: oldDate.toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit2',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: oldDate.toISOString(),
                  treeHash: 'old-2',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(oldNotes);
        vi.mocked(execSync).mockReturnValue('');

        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(2);
        expect(result.runsPruned).toBe(2);
        expect(result.notesRemaining).toBe(0);
        expect(result.prunedTreeHashes).toEqual(['old-1', 'old-2']);
        expect(execSync).toHaveBeenCalledTimes(2);
      });

      it('should count multiple runs in pruned notes', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 100);

        const oldNoteWithMultipleRuns: HistoryNote[] = [
          {
            treeHash: 'old-abc123',
            runs: [
              {
                id: 'run-1',
                timestamp: oldDate.toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit1',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: oldDate.toISOString(),
                  treeHash: 'old-abc123',
                  phases: [],
                },
              },
              {
                id: 'run-2',
                timestamp: oldDate.toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit2',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: oldDate.toISOString(),
                  treeHash: 'old-abc123',
                  phases: [],
                },
              },
              {
                id: 'run-3',
                timestamp: oldDate.toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit3',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: oldDate.toISOString(),
                  treeHash: 'old-abc123',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(oldNoteWithMultipleRuns);
        vi.mocked(execSync).mockReturnValue('');

        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(3); // All 3 runs counted
      });
    });

    describe('when notes are mixed old and new', () => {
      it('should prune only old notes', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 100);

        const mixedNotes: HistoryNote[] = [
          {
            treeHash: 'old-abc123',
            runs: [
              {
                id: 'run-1',
                timestamp: oldDate.toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit1',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: oldDate.toISOString(),
                  treeHash: 'old-abc123',
                  phases: [],
                },
              },
            ],
          },
          {
            treeHash: 'new-def456',
            runs: [
              {
                id: 'run-2',
                timestamp: new Date().toISOString(), // Recent
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit2',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: new Date().toISOString(),
                  treeHash: 'new-def456',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(mixedNotes);
        vi.mocked(execSync).mockReturnValue('');

        const result = await pruneHistoryByAge(90);

        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(1);
        expect(result.notesRemaining).toBe(1);
        expect(result.prunedTreeHashes).toEqual(['old-abc123']);

        // Should only delete old note
        expect(execSync).toHaveBeenCalledWith(
          'git notes --ref=vibe-validate/runs remove old-abc123',
          expect.any(Object)
        );
        expect(execSync).toHaveBeenCalledTimes(1);
      });
    });

    describe('dry-run mode', () => {
      it('should count notes but not delete when dryRun=true', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 100);

        const oldNotes: HistoryNote[] = [
          {
            treeHash: 'old-abc123',
            runs: [
              {
                id: 'run-1',
                timestamp: oldDate.toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit123',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: oldDate.toISOString(),
                  treeHash: 'old-abc123',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(oldNotes);

        const result = await pruneHistoryByAge(90, {}, true);

        // Should report what would be pruned
        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(1);
        expect(result.prunedTreeHashes).toEqual(['old-abc123']);

        // But should NOT actually delete
        expect(execSync).not.toHaveBeenCalled();
      });
    });

    describe('custom configuration', () => {
      it('should use custom notes ref', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 100);

        const oldNotes: HistoryNote[] = [
          {
            treeHash: 'old-abc123',
            runs: [
              {
                id: 'run-1',
                timestamp: oldDate.toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit123',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: oldDate.toISOString(),
                  treeHash: 'old-abc123',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(oldNotes);
        vi.mocked(execSync).mockReturnValue('');

        await pruneHistoryByAge(90, {
          gitNotes: {
            ref: 'custom/notes/ref',
          },
        });

        expect(reader.getAllHistoryNotes).toHaveBeenCalledWith('custom/notes/ref');
        expect(execSync).toHaveBeenCalledWith(
          'git notes --ref=custom/notes/ref remove old-abc123',
          expect.any(Object)
        );
      });
    });

    describe('error handling', () => {
      it('should ignore git command errors and continue', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 100);

        const oldNotes: HistoryNote[] = [
          {
            treeHash: 'old-1',
            runs: [
              {
                id: 'run-1',
                timestamp: oldDate.toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit1',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: oldDate.toISOString(),
                  treeHash: 'old-1',
                  phases: [],
                },
              },
            ],
          },
          {
            treeHash: 'old-2',
            runs: [
              {
                id: 'run-2',
                timestamp: oldDate.toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit2',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: oldDate.toISOString(),
                  treeHash: 'old-2',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(oldNotes);

        // First delete fails, second succeeds
        vi.mocked(execSync)
          .mockImplementationOnce(() => {
            throw new Error('Git error');
          })
          .mockReturnValueOnce('');

        const result = await pruneHistoryByAge(90);

        // Should still count both as pruned
        expect(result.notesPruned).toBe(2);
        expect(result.runsPruned).toBe(2);
        expect(result.prunedTreeHashes).toEqual(['old-1', 'old-2']);
      });

      it('should skip notes with no runs', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 100);

        const notes: HistoryNote[] = [
          {
            treeHash: 'empty-note',
            runs: [],
          },
          {
            treeHash: 'old-note',
            runs: [
              {
                id: 'run-1',
                timestamp: oldDate.toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit1',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: oldDate.toISOString(),
                  treeHash: 'old-note',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);
        vi.mocked(execSync).mockReturnValue('');

        const result = await pruneHistoryByAge(90);

        // Should only prune the one with runs
        expect(result.notesPruned).toBe(1);
        expect(result.prunedTreeHashes).toEqual(['old-note']);
        expect(execSync).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('pruneAllHistory', () => {
    describe('when no notes exist', () => {
      it('should return zero counts', async () => {
        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue([]);

        const result = await pruneAllHistory();

        expect(result.notesPruned).toBe(0);
        expect(result.runsPruned).toBe(0);
        expect(result.notesRemaining).toBe(0);
        expect(result.prunedTreeHashes).toEqual([]);
        expect(execSync).not.toHaveBeenCalled();
      });
    });

    describe('when notes exist', () => {
      it('should prune all notes', async () => {
        const notes: HistoryNote[] = [
          {
            treeHash: 'abc123',
            runs: [
              {
                id: 'run-1',
                timestamp: new Date().toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit1',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: new Date().toISOString(),
                  treeHash: 'abc123',
                  phases: [],
                },
              },
            ],
          },
          {
            treeHash: 'def456',
            runs: [
              {
                id: 'run-2',
                timestamp: new Date().toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit2',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: new Date().toISOString(),
                  treeHash: 'def456',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);
        vi.mocked(execSync).mockReturnValue('');

        const result = await pruneAllHistory();

        expect(result.notesPruned).toBe(2);
        expect(result.runsPruned).toBe(2);
        expect(result.notesRemaining).toBe(0);
        expect(result.prunedTreeHashes).toEqual(['abc123', 'def456']);

        expect(execSync).toHaveBeenCalledWith(
          'git notes --ref=vibe-validate/runs remove abc123',
          expect.any(Object)
        );
        expect(execSync).toHaveBeenCalledWith(
          'git notes --ref=vibe-validate/runs remove def456',
          expect.any(Object)
        );
      });

      it('should count all runs in pruned notes', async () => {
        const notes: HistoryNote[] = [
          {
            treeHash: 'abc123',
            runs: [
              {
                id: 'run-1',
                timestamp: new Date().toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit1',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: new Date().toISOString(),
                  treeHash: 'abc123',
                  phases: [],
                },
              },
              {
                id: 'run-2',
                timestamp: new Date().toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit2',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: new Date().toISOString(),
                  treeHash: 'abc123',
                  phases: [],
                },
              },
              {
                id: 'run-3',
                timestamp: new Date().toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit3',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: new Date().toISOString(),
                  treeHash: 'abc123',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);
        vi.mocked(execSync).mockReturnValue('');

        const result = await pruneAllHistory();

        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(3);
      });

      it('should handle notes without runs gracefully', async () => {
        const notes: HistoryNote[] = [
          {
            treeHash: 'abc123',
            runs: undefined as any, // Missing runs
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);
        vi.mocked(execSync).mockReturnValue('');

        const result = await pruneAllHistory();

        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(0); // Should handle undefined runs
      });
    });

    describe('dry-run mode', () => {
      it('should count notes but not delete when dryRun=true', async () => {
        const notes: HistoryNote[] = [
          {
            treeHash: 'abc123',
            runs: [
              {
                id: 'run-1',
                timestamp: new Date().toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit1',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: new Date().toISOString(),
                  treeHash: 'abc123',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);

        const result = await pruneAllHistory({}, true);

        // Should report what would be pruned
        expect(result.notesPruned).toBe(1);
        expect(result.runsPruned).toBe(1);
        expect(result.prunedTreeHashes).toEqual(['abc123']);

        // But should NOT actually delete
        expect(execSync).not.toHaveBeenCalled();
      });
    });

    describe('custom configuration', () => {
      it('should use custom notes ref', async () => {
        const notes: HistoryNote[] = [
          {
            treeHash: 'abc123',
            runs: [
              {
                id: 'run-1',
                timestamp: new Date().toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit1',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: new Date().toISOString(),
                  treeHash: 'abc123',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);
        vi.mocked(execSync).mockReturnValue('');

        await pruneAllHistory({
          gitNotes: {
            ref: 'custom/notes/ref',
          },
        });

        expect(reader.getAllHistoryNotes).toHaveBeenCalledWith('custom/notes/ref');
        expect(execSync).toHaveBeenCalledWith(
          'git notes --ref=custom/notes/ref remove abc123',
          expect.any(Object)
        );
      });
    });

    describe('error handling', () => {
      it('should ignore git command errors and continue', async () => {
        const notes: HistoryNote[] = [
          {
            treeHash: 'note-1',
            runs: [
              {
                id: 'run-1',
                timestamp: new Date().toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit1',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: new Date().toISOString(),
                  treeHash: 'note-1',
                  phases: [],
                },
              },
            ],
          },
          {
            treeHash: 'note-2',
            runs: [
              {
                id: 'run-2',
                timestamp: new Date().toISOString(),
                duration: 5000,
                passed: true,
                branch: 'main',
                headCommit: 'commit2',
                uncommittedChanges: false,
                result: {
                  passed: true,
                  timestamp: new Date().toISOString(),
                  treeHash: 'note-2',
                  phases: [],
                },
              },
            ],
          },
        ];

        vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);

        // First delete fails, second succeeds
        vi.mocked(execSync)
          .mockImplementationOnce(() => {
            throw new Error('Git error');
          })
          .mockReturnValueOnce('');

        const result = await pruneAllHistory();

        // Should still count both as pruned
        expect(result.notesPruned).toBe(2);
        expect(result.runsPruned).toBe(2);
        expect(result.prunedTreeHashes).toEqual(['note-1', 'note-2']);
      });
    });
  });
});
