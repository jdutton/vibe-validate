/**
 * Tests for validation history health check (O(1) implementation)
 *
 * The health check uses:
 * - listNoteObjects(): returns hash array (count only, no content reading)
 * - executeGitCommand(): runs `git log -1 --format=%aI` on notes ref (age check)
 */

import * as git from '@vibe-validate/git';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { checkHistoryHealth } from '../src/health-check.js';

// Mock @vibe-validate/git module
vi.mock('@vibe-validate/git');

/**
 * Create an array of fake tree hashes (for listNoteObjects mock)
 * @param count - Number of hashes to create
 * @returns Array of fake tree hash strings
 */
function createFakeHashes(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `hash${i}`);
}

/**
 * Create a date N days in the past as ISO string
 * @param daysAgo - Number of days to subtract from current date
 * @returns ISO string of the past date
 */
function createPastDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

/**
 * Create a successful git execution result
 * @param stdout - The stdout content
 * @returns GitExecutionResult-like object
 */
function createGitResult(stdout: string) {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}

/**
 * Create a failed git execution result
 * @returns GitExecutionResult-like object
 */
function createFailedGitResult() {
  return { success: false, stdout: '', stderr: 'error', exitCode: 1 };
}

/**
 * Mock listNoteObjects and executeGitCommand for a health check scenario
 * @param noteCount - Number of notes to simulate
 * @param ageDate - ISO date string for notes ref age (or null for failed git log)
 */
function mockHealthCheckScenario(noteCount: number, ageDate: string | null): void {
  vi.mocked(git.listNoteObjects).mockReturnValue(createFakeHashes(noteCount) as git.TreeHash[]);
  vi.mocked(git.executeGitCommand).mockReturnValue(
    ageDate ? createGitResult(ageDate) : createFailedGitResult()
  );
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

describe('checkHistoryHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when no notes exist', () => {
    it('should return no warnings', async () => {
      vi.mocked(git.listNoteObjects).mockReturnValue([]);
      vi.mocked(git.executeGitCommand).mockReturnValue(createFailedGitResult());

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
      vi.mocked(git.listNoteObjects).mockReturnValue(createFakeHashes(1) as git.TreeHash[]);
      // Notes ref was recently modified (today)
      vi.mocked(git.executeGitCommand).mockReturnValue(
        createGitResult(new Date().toISOString())
      );

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
      // Create 1001 hashes (default warnAfterCount = 1000)
      vi.mocked(git.listNoteObjects).mockReturnValue(createFakeHashes(1001) as git.TreeHash[]);
      // Notes ref was recently modified (no age warning)
      vi.mocked(git.executeGitCommand).mockReturnValue(
        createGitResult(new Date().toISOString())
      );

      const result = await checkHistoryHealth();

      expect(result).toBeDefined();
      expectHealthCheckResult(result, {
        totalNotes: 1001,
        oldNotesCount: 0,
        shouldWarn: true,
        warningContains: ['grown large', '1001 tree hashes', 'history prune --older-than'],
      });
    });

    it('should warn when age exceeds threshold only', async () => {
      // 1 note, but notes ref last modified 40 days ago (default warnAfterDays = 30)
      mockHealthCheckScenario(1, createPastDate(40));

      const result = await checkHistoryHealth();

      expect(result).toBeDefined();
      expectHealthCheckResult(result, {
        totalNotes: 1,
        oldNotesCount: 1, // Estimated as totalNotes when ref is old
        shouldWarn: true,
        warningContains: ['Found validation history older than', '30 days', '1 tree hashes can be pruned'],
        warningNotContains: ['grown large'],
      });
    });

    it('should warn when both count and age exceed thresholds', async () => {
      // 1001 notes, notes ref last modified 40 days ago
      mockHealthCheckScenario(1001, createPastDate(40));

      const result = await checkHistoryHealth();

      expect(result).toBeDefined();
      expectHealthCheckResult(result, {
        totalNotes: 1001,
        oldNotesCount: 1001, // All notes estimated as old
        shouldWarn: true,
        warningContains: ['grown large', '1001 tree hashes', `Found 1001 notes older than`, '30 days'],
      });
    });
  });

  describe('custom configuration', () => {
    it('should use custom warnAfterDays', async () => {
      vi.mocked(git.listNoteObjects).mockReturnValue(createFakeHashes(1) as git.TreeHash[]);
      // Notes ref modified 40 days ago
      vi.mocked(git.executeGitCommand).mockReturnValue(
        createGitResult(createPastDate(40))
      );

      const result = await checkHistoryHealth({
        retention: {
          warnAfterDays: 30,
        },
      });

      expect(result).toBeDefined();
      expect(result.oldNotesCount).toBe(1);
      expect(result.shouldWarn).toBe(true);
      expect(result.warningMessage).toContain('older than 30 days');
    });

    it('should use custom warnAfterCount', async () => {
      vi.mocked(git.listNoteObjects).mockReturnValue(createFakeHashes(15) as git.TreeHash[]);
      // Notes ref recently modified
      vi.mocked(git.executeGitCommand).mockReturnValue(
        createGitResult(new Date().toISOString())
      );

      const result = await checkHistoryHealth({
        retention: {
          warnAfterCount: 10,
        },
      });

      expect(result).toBeDefined();
      expect(result.totalNotes).toBe(15);
      expect(result.shouldWarn).toBe(true);
      expect(result.warningMessage).toContain('15 tree hashes');
    });

    it('should use custom notes ref', async () => {
      vi.mocked(git.listNoteObjects).mockReturnValue([]);
      vi.mocked(git.executeGitCommand).mockReturnValue(createFailedGitResult());

      await checkHistoryHealth({
        gitNotes: {
          ref: 'custom/notes/ref',
        },
      });

      expect(git.listNoteObjects).toHaveBeenCalledWith('custom/notes/ref');
      expect(git.executeGitCommand).toHaveBeenCalledWith(
        ['log', '-1', '--format=%aI', 'refs/notes/custom/notes/ref'],
        expect.objectContaining({ ignoreErrors: true, suppressStderr: true })
      );
    });
  });

  describe('edge cases', () => {
    it('should skip age check when git log fails', async () => {
      vi.mocked(git.listNoteObjects).mockReturnValue(createFakeHashes(5) as git.TreeHash[]);
      // git log fails (no notes ref in git history yet)
      vi.mocked(git.executeGitCommand).mockReturnValue(createFailedGitResult());

      const result = await checkHistoryHealth();

      expect(result).toBeDefined();
      expectHealthCheckResult(result, {
        totalNotes: 5,
        oldNotesCount: 0,
        shouldWarn: false,
      });
    });

    it('should skip age check when git log returns empty stdout', async () => {
      vi.mocked(git.listNoteObjects).mockReturnValue(createFakeHashes(5) as git.TreeHash[]);
      vi.mocked(git.executeGitCommand).mockReturnValue(createGitResult(''));

      const result = await checkHistoryHealth();

      expect(result).toBeDefined();
      expectHealthCheckResult(result, {
        totalNotes: 5,
        oldNotesCount: 0,
        shouldWarn: false,
      });
    });

    it('should not warn when notes ref was recently modified', async () => {
      vi.mocked(git.listNoteObjects).mockReturnValue(createFakeHashes(5) as git.TreeHash[]);
      // Notes ref modified just now
      vi.mocked(git.executeGitCommand).mockReturnValue(
        createGitResult(new Date().toISOString())
      );

      const result = await checkHistoryHealth();

      expect(result).toBeDefined();
      expectHealthCheckResult(result, {
        totalNotes: 5,
        oldNotesCount: 0,
        shouldWarn: false,
      });
    });

    it('should set oldNotesCount to totalNotes when ref is old', async () => {
      // 50 notes, ref last modified 60 days ago
      vi.mocked(git.listNoteObjects).mockReturnValue(createFakeHashes(50) as git.TreeHash[]);
      vi.mocked(git.executeGitCommand).mockReturnValue(
        createGitResult(createPastDate(60))
      );

      const result = await checkHistoryHealth();

      expect(result).toBeDefined();
      // oldNotesCount should be totalNotes (estimate: all are old)
      expect(result.oldNotesCount).toBe(50);
    });
  });
});
