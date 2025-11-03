/**
 * Tests for validation history health check
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkHistoryHealth } from '../src/health-check.js';
import * as reader from '../src/reader.js';
import type { HistoryNote } from '../src/types.js';

// Mock reader module
vi.mock('../src/reader.js');

describe('checkHistoryHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when no notes exist', () => {
    it('should return no warnings', async () => {
      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue([]);

      const result = await checkHistoryHealth();

      expect(result.totalNotes).toBe(0);
      expect(result.oldNotesCount).toBe(0);
      expect(result.shouldWarn).toBe(false);
      expect(result.warningMessage).toBeUndefined();
    });
  });

  describe('when notes exist but below thresholds', () => {
    it('should not warn when count and age are below thresholds', async () => {
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

      const result = await checkHistoryHealth();

      expect(result.totalNotes).toBe(1);
      expect(result.oldNotesCount).toBe(0);
      expect(result.shouldWarn).toBe(false);
      expect(result.warningMessage).toBeUndefined();
    });
  });

  describe('warning scenarios', () => {
    it('should warn when count exceeds threshold only', async () => {
      // Create 1001 recent notes (default warnAfterCount = 1000 as of v0.15.0)
      const manyRecentNotes: HistoryNote[] = Array.from({ length: 1001 }, (_, i) => ({
        treeHash: `hash${i}`,
        runs: [
          {
            id: `run-${i}`,
            timestamp: new Date().toISOString(),
            duration: 5000,
            passed: true,
            branch: 'main',
            headCommit: `commit${i}`,
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: new Date().toISOString(),
              treeHash: `hash${i}`,
              phases: [],
            },
          },
        ],
      }));

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(manyRecentNotes);

      const result = await checkHistoryHealth();

      expect(result.totalNotes).toBe(1001);
      expect(result.oldNotesCount).toBe(0);
      expect(result.shouldWarn).toBe(true);
      expect(result.warningMessage).toContain('grown large');
      expect(result.warningMessage).toContain('1001 tree hashes');
      expect(result.warningMessage).toContain('history prune --older-than');
      expect(result.warningMessage).not.toContain('older than');
    });

    it('should warn when age exceeds threshold only', async () => {
      // Create note older than 30 days (default warnAfterDays = 30 as of v0.15.0)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40); // 40 days ago (older than 30-day threshold)

      const oldNotes: HistoryNote[] = [
        {
          treeHash: 'abc123',
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
                treeHash: 'abc123',
                phases: [],
              },
            },
          ],
        },
      ];

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(oldNotes);

      const result = await checkHistoryHealth();

      expect(result.totalNotes).toBe(1);
      expect(result.oldNotesCount).toBe(1);
      expect(result.shouldWarn).toBe(true);
      expect(result.warningMessage).toContain('Found validation history older than');
      expect(result.warningMessage).toContain('30 days'); // v0.15.0: changed from 90
      expect(result.warningMessage).toContain('1 tree hashes can be pruned');
      expect(result.warningMessage).not.toContain('grown large');
    });

    it('should warn when both count and age exceed thresholds', async () => {
      // Create 1001 notes (exceeds count threshold), some old (exceeds age threshold)
      // v0.15.0: Updated from 101 to 1001 to match new warnAfterCount threshold
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40); // 40 days ago (exceeds 30-day threshold)

      const mixedNotes: HistoryNote[] = [
        // 10 old notes
        ...Array.from({ length: 10 }, (_, i) => ({
          treeHash: `old-hash${i}`,
          runs: [
            {
              id: `old-run-${i}`,
              timestamp: oldDate.toISOString(),
              duration: 5000,
              passed: true,
              branch: 'main',
              headCommit: `old-commit${i}`,
              uncommittedChanges: false,
              result: {
                passed: true,
                timestamp: oldDate.toISOString(),
                treeHash: `old-hash${i}`,
                phases: [],
              },
            },
          ],
        })),
        // 991 recent notes (total: 1001)
        ...Array.from({ length: 991 }, (_, i) => ({
          treeHash: `new-hash${i}`,
          runs: [
            {
              id: `new-run-${i}`,
              timestamp: new Date().toISOString(),
              duration: 5000,
              passed: true,
              branch: 'main',
              headCommit: `new-commit${i}`,
              uncommittedChanges: false,
              result: {
                passed: true,
                timestamp: new Date().toISOString(),
                treeHash: `new-hash${i}`,
                phases: [],
              },
            },
          ],
        })),
      ];

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(mixedNotes);

      const result = await checkHistoryHealth();

      expect(result.totalNotes).toBe(1001);
      expect(result.oldNotesCount).toBe(10);
      expect(result.shouldWarn).toBe(true);
      expect(result.warningMessage).toContain('grown large');
      expect(result.warningMessage).toContain('1001 tree hashes');
      expect(result.warningMessage).toContain('Found 10 notes older than');
      expect(result.warningMessage).toContain('30 days'); // v0.15.0: changed from 90
    });
  });

  describe('custom configuration', () => {
    it('should use custom warnAfterDays', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40); // 40 days ago

      const notes: HistoryNote[] = [
        {
          treeHash: 'abc123',
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
                treeHash: 'abc123',
                phases: [],
              },
            },
          ],
        },
      ];

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);

      const result = await checkHistoryHealth({
        retention: {
          warnAfterDays: 30, // Custom: 30 days instead of default 90
        },
      });

      expect(result.oldNotesCount).toBe(1);
      expect(result.shouldWarn).toBe(true);
      expect(result.warningMessage).toContain('older than 30 days');
    });

    it('should use custom warnAfterCount', async () => {
      const notes: HistoryNote[] = Array.from({ length: 15 }, (_, i) => ({
        treeHash: `hash${i}`,
        runs: [
          {
            id: `run-${i}`,
            timestamp: new Date().toISOString(),
            duration: 5000,
            passed: true,
            branch: 'main',
            headCommit: `commit${i}`,
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: new Date().toISOString(),
              treeHash: `hash${i}`,
              phases: [],
            },
          },
        ],
      }));

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);

      const result = await checkHistoryHealth({
        retention: {
          warnAfterCount: 10, // Custom: 10 instead of default 100
        },
      });

      expect(result.totalNotes).toBe(15);
      expect(result.shouldWarn).toBe(true);
      expect(result.warningMessage).toContain('15 tree hashes');
    });

    it('should use custom notes ref', async () => {
      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue([]);

      await checkHistoryHealth({
        gitNotes: {
          ref: 'custom/notes/ref',
        },
      });

      expect(reader.getAllHistoryNotes).toHaveBeenCalledWith('custom/notes/ref');
    });
  });

  describe('edge cases', () => {
    it('should handle notes with no runs', async () => {
      const notesWithoutRuns: HistoryNote[] = [
        {
          treeHash: 'abc123',
          runs: [],
        },
      ];

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notesWithoutRuns);

      const result = await checkHistoryHealth();

      expect(result.totalNotes).toBe(1);
      expect(result.oldNotesCount).toBe(0);
      expect(result.shouldWarn).toBe(false);
    });

    it('should check oldest run in multi-run notes', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      const notesWithMultipleRuns: HistoryNote[] = [
        {
          treeHash: 'abc123',
          runs: [
            {
              id: 'run-1',
              timestamp: oldDate.toISOString(), // Old run
              duration: 5000,
              passed: true,
              branch: 'main',
              headCommit: 'commit123',
              uncommittedChanges: false,
              result: {
                passed: true,
                timestamp: oldDate.toISOString(),
                treeHash: 'abc123',
                phases: [],
              },
            },
            {
              id: 'run-2',
              timestamp: new Date().toISOString(), // Recent run
              duration: 5000,
              passed: true,
              branch: 'main',
              headCommit: 'commit456',
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

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notesWithMultipleRuns);

      const result = await checkHistoryHealth();

      // Should count this note as old because oldest run is old
      expect(result.oldNotesCount).toBe(1);
    });
  });
});
