import type { TreeHashResult, TreeHash } from '@vibe-validate/git';
import { describe, it, expect } from 'vitest';

import { findCachedValidation, findRetryRun, type LevelRequest } from '../src/lookup.js';
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
    const commitRed = createMockRun({ id: 'run-1', level: 'commit', passed: false });
    const fullRed = createMockRun({ id: 'run-2', level: 'full', passed: false });
    const note = noteWith([commitRed, fullRed]);

    expect(findCachedValidation(note, TREE, COMMIT)).toBeNull();
    expect(findCachedValidation(note, TREE, FULL)).toBeNull();
  });

  it('a green older than a red still answers: the red is a record, never a verdict', () => {
    const green = createMockRun({ id: 'run-1', timestamp: '2025-01-01T00:00:00Z' });
    const red = createMockRun({ id: 'run-2', timestamp: '2025-01-02T00:00:00Z', passed: false });

    expect(findCachedValidation(noteWith([green, red]), TREE, FULL)).toBe(green);
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
  it('returns the most recent run at exactly the requested level', () => {
    const fullRed = createMockRun({ id: 'run-1', level: 'full', passed: false });
    const commitRed = createMockRun({ id: 'run-2', level: 'commit', passed: false });
    const note = noteWith([fullRed, commitRed]);

    expect(findRetryRun(note, TREE, 'full')).toBe(fullRed);
    expect(findRetryRun(note, TREE, 'commit')).toBe(commitRed);
  });

  it('returns null when no run at that level matches the submodule state', () => {
    const run = createMockRun({ level: 'full', submoduleHashes: { 'libs/auth': 'def456' } });
    expect(findRetryRun(noteWith([run]), TREE, 'full')).toBeNull();
    expect(findRetryRun(null, TREE, 'full')).toBeNull();
  });
});
