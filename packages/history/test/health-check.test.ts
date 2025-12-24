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
  /**
   * Create a history note with a single run
   * @param overrides - Optional overrides for the run
   * @returns Complete HistoryNote with default values
   */
  function createHistoryNote(overrides: {
    treeHash?: string;
    timestamp?: string;
    id?: string;
    headCommit?: string;
  } = {}): HistoryNote {
    const timestamp = overrides.timestamp ?? new Date().toISOString();
    const treeHash = overrides.treeHash ?? 'abc123';
    const id = overrides.id ?? 'run-1';
    const headCommit = overrides.headCommit ?? 'commit123';

    return {
      treeHash,
      runs: [
        {
          id,
          timestamp,
          duration: 5000,
          passed: true,
          branch: 'main',
          headCommit,
          uncommittedChanges: false,
          result: {
            passed: true,
            timestamp,
            treeHash,
            phases: [],
          },
        },
      ],
    };
  }

  /**
   * Create an array of history notes (for batch creation)
   * @param count - Number of notes to create
   * @param overridesFn - Function to generate overrides for each note based on index
   * @returns Array of HistoryNote objects
   */
  function createHistoryNotes(
    count: number,
    overridesFn?: (_i: number) => Parameters<typeof createHistoryNote>[0]
  ): HistoryNote[] {
    return Array.from({ length: count }, (_, i) =>
      createHistoryNote(overridesFn ? overridesFn(i) : {})
    );
  }

  /**
   * Create a date N days in the past
   * @param daysAgo - Number of days to subtract from current date
   * @returns ISO string of the past date
   */
  function createPastDate(daysAgo: number): string {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString();
  }

  /**
   * Assert health check result matches expected values
   * @param result - Health check result to verify
   * @param expected - Expected values
   */
  function expectHealthCheckResult(
    result: Awaited<ReturnType<typeof checkHistoryHealth>>,
    expected: {
      totalNotes: number;
      oldNotesCount: number;
      shouldWarn: boolean;
      warningContains?: string[];
      warningNotContains?: string[];
    }
  ): void {
    expect(result.totalNotes).toBe(expected.totalNotes);
    expect(result.oldNotesCount).toBe(expected.oldNotesCount);
    expect(result.shouldWarn).toBe(expected.shouldWarn);

    if (expected.warningContains) {
      for (const text of expected.warningContains) {
        expect(result.warningMessage).toContain(text);
      }
    }

    if (expected.warningNotContains) {
      for (const text of expected.warningNotContains) {
        expect(result.warningMessage).not.toContain(text);
      }
    }

    if (!expected.shouldWarn) {
      expect(result.warningMessage).toBeUndefined();
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when no notes exist', () => {
    it('should return no warnings', async () => {
      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue([]);

      const result = await checkHistoryHealth();

      expect(result).toBeDefined();
      expectHealthCheckResult(result, {
        totalNotes: 0,
        oldNotesCount: 0,
        shouldWarn: false,
      });
    });
  });

  describe('when notes exist but below thresholds', () => {
    it('should not warn when count and age are below thresholds', async () => {
      const recentNotes = [createHistoryNote()];

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(recentNotes);

      const result = await checkHistoryHealth();

      expect(result).toBeDefined();
      expectHealthCheckResult(result, {
        totalNotes: 1,
        oldNotesCount: 0,
        shouldWarn: false,
      });
    });
  });

  describe('warning scenarios', () => {
    it('should warn when count exceeds threshold only', async () => {
      // Create 1001 recent notes (default warnAfterCount = 1000 as of v0.15.0)
      const manyRecentNotes = createHistoryNotes(1001, (i) => ({
        treeHash: `hash${i}`,
        id: `run-${i}`,
        headCommit: `commit${i}`,
      }));

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(manyRecentNotes);

      const result = await checkHistoryHealth();

      expect(result).toBeDefined();
      expectHealthCheckResult(result, {
        totalNotes: 1001,
        oldNotesCount: 0,
        shouldWarn: true,
        warningContains: ['grown large', '1001 tree hashes', 'history prune --older-than'],
        warningNotContains: ['older than 30 days'],
      });
    });

    it('should warn when age exceeds threshold only', async () => {
      // Create note older than 30 days (default warnAfterDays = 30 as of v0.15.0)
      const oldNotes = [
        createHistoryNote({
          timestamp: createPastDate(40), // 40 days ago (older than 30-day threshold)
        }),
      ];

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(oldNotes);

      const result = await checkHistoryHealth();

      expect(result).toBeDefined();
      expectHealthCheckResult(result, {
        totalNotes: 1,
        oldNotesCount: 1,
        shouldWarn: true,
        warningContains: ['Found validation history older than', '30 days', '1 tree hashes can be pruned'],
        warningNotContains: ['grown large'],
      });
    });

    it('should warn when both count and age exceed thresholds', async () => {
      // Create 1001 notes (exceeds count threshold), some old (exceeds age threshold)
      // v0.15.0: Updated from 101 to 1001 to match new warnAfterCount threshold
      const oldTimestamp = createPastDate(40); // 40 days ago (exceeds 30-day threshold)

      const mixedNotes: HistoryNote[] = [
        // 10 old notes
        ...createHistoryNotes(10, (i) => ({
          treeHash: `old-hash${i}`,
          id: `old-run-${i}`,
          headCommit: `old-commit${i}`,
          timestamp: oldTimestamp,
        })),
        // 991 recent notes (total: 1001)
        ...createHistoryNotes(991, (i) => ({
          treeHash: `new-hash${i}`,
          id: `new-run-${i}`,
          headCommit: `new-commit${i}`,
        })),
      ];

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(mixedNotes);

      const result = await checkHistoryHealth();

      expect(result).toBeDefined();
      expectHealthCheckResult(result, {
        totalNotes: 1001,
        oldNotesCount: 10,
        shouldWarn: true,
        warningContains: ['grown large', '1001 tree hashes', 'Found 10 notes older than', '30 days'],
      });
    });
  });

  describe('custom configuration', () => {
    it('should use custom warnAfterDays', async () => {
      const notes = [
        createHistoryNote({
          timestamp: createPastDate(40), // 40 days ago
        }),
      ];

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);

      const result = await checkHistoryHealth({
        retention: {
          warnAfterDays: 30, // Custom: 30 days instead of default 90
        },
      });

      expect(result).toBeDefined();
      expect(result.oldNotesCount).toBe(1);
      expect(result.shouldWarn).toBe(true);
      expect(result.warningMessage).toContain('older than 30 days');
    });

    it('should use custom warnAfterCount', async () => {
      const notes = createHistoryNotes(15, (i) => ({
        treeHash: `hash${i}`,
        id: `run-${i}`,
        headCommit: `commit${i}`,
      }));

      vi.mocked(reader.getAllHistoryNotes).mockResolvedValue(notes);

      const result = await checkHistoryHealth({
        retention: {
          warnAfterCount: 10, // Custom: 10 instead of default 100
        },
      });

      expect(result).toBeDefined();
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

      expect(result).toBeDefined();
      expectHealthCheckResult(result, {
        totalNotes: 1,
        oldNotesCount: 0,
        shouldWarn: false,
      });
    });

    it('should check oldest run in multi-run notes', async () => {
      const oldTimestamp = createPastDate(100);
      const recentTimestamp = new Date().toISOString();

      const notesWithMultipleRuns: HistoryNote[] = [
        {
          treeHash: 'abc123',
          runs: [
            {
              id: 'run-1',
              timestamp: oldTimestamp, // Old run
              duration: 5000,
              passed: true,
              branch: 'main',
              headCommit: 'commit123',
              uncommittedChanges: false,
              result: {
                passed: true,
                timestamp: oldTimestamp,
                treeHash: 'abc123',
                phases: [],
              },
            },
            {
              id: 'run-2',
              timestamp: recentTimestamp, // Recent run
              duration: 5000,
              passed: true,
              branch: 'main',
              headCommit: 'commit456',
              uncommittedChanges: false,
              result: {
                passed: true,
                timestamp: recentTimestamp,
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
      expect(result).toBeDefined();
      expect(result.oldNotesCount).toBe(1);
    });
  });
});
