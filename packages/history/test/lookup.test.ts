import type { TreeHashResult, TreeHash } from '@vibe-validate/git';
import { describe, it, expect } from 'vitest';

import { findCachedValidation, findDecidingRun, findRetryRun, type LevelRequest } from '../src/lookup.js';
import type { HistoryNote, ValidationRun } from '../src/types.js';

const LEVELS = ['commit', 'full'] as const;
const COMMIT: LevelRequest = { level: 'commit', levels: LEVELS };
const FULL: LevelRequest = { level: 'full', levels: LEVELS };
const TREE: TreeHashResult = { hash: 'abc123' as TreeHash };

/**
 * Helper: Create mock ValidationRun (a passing full-level run unless overridden)
 */
function createMockRun(overrides?: Partial<ValidationRun>): ValidationRun {
  return {
    id: 'run-1',
    timestamp: '2025-01-01T00:00:00Z',
    duration: 1000,
    passed: true,
    level: 'full',
    branch: 'main',
    headCommit: 'abc',
    uncommittedChanges: false,
    result: { passed: true, phases: [] } as any,
    ...overrides,
  };
}

/** Helper: a note holding `runs`, oldest first (as git-notes.ts appends them) */
function noteWith(runs: ValidationRun[]): HistoryNote {
  return { treeHash: 'abc123', runs };
}

/** Helper: a commit-level failure followed by a newer full-level failure */
function commitRedThenFullRed(): { commitRed: ValidationRun; fullRed: ValidationRun; note: HistoryNote } {
  const commitRed = createMockRun({ id: 'run-1', level: 'commit', passed: false });
  const fullRed = createMockRun({ id: 'run-2', level: 'full', passed: false });
  return { commitRed, fullRed, note: noteWith([commitRed, fullRed]) };
}

describe('findCachedValidation', () => {
  it('returns null when there is no note', () => {
    expect(findCachedValidation(null, TREE, FULL)).toBeNull();
  });

  it('a passing run answers a request at its own level', () => {
    const run = createMockRun();
    expect(findCachedValidation(noteWith([run]), TREE, FULL)).toBe(run);
  });

  it('a passing full run answers a commit request', () => {
    const run = createMockRun({ level: 'full' });
    expect(findCachedValidation(noteWith([run]), TREE, COMMIT)).toBe(run);
  });

  it('a passing commit run never answers a full request', () => {
    const run = createMockRun({ level: 'commit' });
    expect(findCachedValidation(noteWith([run]), TREE, FULL)).toBeNull();
  });

  it('never replays a failure, at its own level or any other', () => {
    const { note } = commitRedThenFullRed();

    expect(findCachedValidation(note, TREE, COMMIT)).toBeNull();
    expect(findCachedValidation(note, TREE, FULL)).toBeNull();
  });

  it('a newer red overturns an older green at the same level', () => {
    const green = createMockRun({ id: 'run-1', timestamp: '2025-01-01T00:00:00Z' });
    const red = createMockRun({ id: 'run-2', timestamp: '2025-01-02T00:00:00Z', passed: false });

    expect(findCachedValidation(noteWith([green, red]), TREE, FULL)).toBeNull();
    expect(findCachedValidation(noteWith([green, red]), TREE, COMMIT)).toBeNull();
  });

  it('a newer red at a lower level overturns an older green at a higher one', () => {
    const fullGreen = createMockRun({ id: 'run-1', level: 'full' });
    const commitRed = createMockRun({ id: 'run-2', level: 'commit', passed: false });
    const note = noteWith([fullGreen, commitRed]);

    expect(findCachedValidation(note, TREE, FULL)).toBeNull();
    expect(findCachedValidation(note, TREE, COMMIT)).toBeNull();
  });

  it('a newer green that covers the request answers it over an older red', () => {
    const red = createMockRun({ id: 'run-1', level: 'full', passed: false });
    const green = createMockRun({ id: 'run-2', level: 'full' });

    expect(findCachedValidation(noteWith([red, green]), TREE, FULL)).toBe(green);
  });

  it('a newer green below the request neither answers it nor hides an older red', () => {
    const fullRed = createMockRun({ id: 'run-1', level: 'full', passed: false });
    const commitGreen = createMockRun({ id: 'run-2', level: 'commit' });
    const note = noteWith([fullRed, commitGreen]);

    expect(findCachedValidation(note, TREE, COMMIT)).toBe(commitGreen);
    expect(findCachedValidation(note, TREE, FULL)).toBeNull();
    expect(findDecidingRun(note, TREE, FULL)).toBe(fullRed);
  });

  it('a run whose result did not pass is not a pass, whatever the run says', () => {
    const run = createMockRun({ result: { passed: false, phases: [] } as any });
    expect(findCachedValidation(noteWith([run]), TREE, FULL)).toBeNull();
    expect(findDecidingRun(noteWith([run]), TREE, FULL)).toBe(run);
  });

  it('the most recent qualifying run wins', () => {
    const older = createMockRun({ id: 'run-1', timestamp: '2025-01-01T00:00:00Z', level: 'full' });
    const newer = createMockRun({ id: 'run-2', timestamp: '2025-01-02T00:00:00Z', level: 'commit' });

    expect(findCachedValidation(noteWith([older, newer]), TREE, COMMIT)).toBe(newer);
  });

  it('a run whose level the config no longer declares answers nothing', () => {
    const run = createMockRun({ level: 'push' });
    expect(findCachedValidation(noteWith([run]), TREE, COMMIT)).toBeNull();
  });

  it('a run with no recorded level answers nothing', () => {
    const run = createMockRun();
    delete (run as Partial<ValidationRun>).level;
    expect(findCachedValidation(noteWith([run]), TREE, FULL)).toBeNull();
  });

  describe('submodule state', () => {
    const withSubmodule = (hash: string): TreeHashResult => ({
      hash: 'abc123' as TreeHash,
      submoduleHashes: { 'libs/auth': hash as TreeHash },
    });

    it('matches when every submodule hash matches', () => {
      const run = createMockRun({ submoduleHashes: { 'libs/auth': 'def456' } });
      expect(findCachedValidation(noteWith([run]), withSubmodule('def456'), FULL)).toBe(run);
    });

    it('misses when a submodule hash differs', () => {
      const run = createMockRun({ submoduleHashes: { 'libs/auth': 'def456' } });
      expect(findCachedValidation(noteWith([run]), withSubmodule('999aaa'), FULL)).toBeNull();
    });

    it('misses when a submodule was added', () => {
      expect(findCachedValidation(noteWith([createMockRun()]), withSubmodule('def456'), FULL)).toBeNull();
    });

    it('misses when a submodule was removed', () => {
      const run = createMockRun({ submoduleHashes: { 'libs/auth': 'def456' } });
      expect(findCachedValidation(noteWith([run]), TREE, FULL)).toBeNull();
    });

    it('finds the run whose submodule state matches among several', () => {
      const first = createMockRun({ id: 'run-1', submoduleHashes: { 'libs/auth': 'def456' } });
      const second = createMockRun({ id: 'run-2', submoduleHashes: { 'libs/auth': '999aaa' } });
      expect(findCachedValidation(noteWith([first, second]), withSubmodule('999aaa'), FULL)).toBe(second);
    });
  });
});

describe('findRetryRun', () => {
  it('returns the newest run when it failed at exactly the requested level', () => {
    const { fullRed, note } = commitRedThenFullRed();
    expect(findRetryRun(note, TREE, FULL)).toBe(fullRed);
  });

  it('returns null when the newest failure is at another level', () => {
    expect(findRetryRun(commitRedThenFullRed().note, TREE, COMMIT)).toBeNull();
  });

  it('never builds on an older pass a newer failure overturned', () => {
    const fullGreen = createMockRun({ id: 'run-1', level: 'full' });
    const commitRed = createMockRun({ id: 'run-2', level: 'commit', passed: false });

    expect(findRetryRun(noteWith([fullGreen, commitRed]), TREE, FULL)).toBeNull();
  });

  it('returns the newer of two failures at the same level', () => {
    const older = createMockRun({ id: 'run-1', level: 'full', passed: false });
    const newer = createMockRun({ id: 'run-2', level: 'full', passed: false });
    expect(findRetryRun(noteWith([older, newer]), TREE, FULL)).toBe(newer);
  });

  it('returns null when no run matches the submodule state', () => {
    const run = createMockRun({ level: 'full', passed: false, submoduleHashes: { 'libs/auth': 'def456' } });
    expect(findRetryRun(noteWith([run]), TREE, FULL)).toBeNull();
    expect(findRetryRun(null, TREE, FULL)).toBeNull();
  });
});
