import { describe, it, expect } from 'vitest';

import {
  IMPLICIT_LEVEL,
  getLevels,
  getLevelIndex,
  stepRunsAtLevel,
  levelCovers,
  getDefaultValidateLevel,
  getDefaultPreCommitLevel,
  UnknownLevelError,
  type LevelSource,
} from '../src/levels.js';

/**
 * Build the parts of a config the level rules read
 * @param levels - Declared levels, or undefined for none
 * @param preCommitLevel - Optional hooks.preCommit.level
 * @returns A level source
 */
function source(levels?: string[], preCommitLevel?: string): LevelSource {
  return {
    validation: { ...(levels ? { levels } : {}), phases: [{ steps: [] }] },
    ...(preCommitLevel ? { hooks: { preCommit: { level: preCommitLevel } } } : {}),
  };
}

describe('validation levels', () => {
  const twoLevels = source(['commit', 'full']);

  it('a config without levels has the one implicit level', () => {
    expect(getLevels(source())).toEqual([IMPLICIT_LEVEL]);
    expect(stepRunsAtLevel({}, IMPLICIT_LEVEL, source())).toBe(true);
  });

  it('a run executes its own level and every earlier one, never a later one', () => {
    expect(stepRunsAtLevel({ level: 'commit' }, 'commit', twoLevels)).toBe(true);
    expect(stepRunsAtLevel({ level: 'commit' }, 'full', twoLevels)).toBe(true);
    expect(stepRunsAtLevel({ level: 'full' }, 'full', twoLevels)).toBe(true);
    expect(stepRunsAtLevel({ level: 'full' }, 'commit', twoLevels)).toBe(false);
  });

  it('a later level covers an earlier one; an earlier one never covers a later one', () => {
    expect(levelCovers('full', 'commit', ['commit', 'full'])).toBe(true);
    expect(levelCovers('commit', 'commit', ['commit', 'full'])).toBe(true);
    expect(levelCovers('commit', 'full', ['commit', 'full'])).toBe(false);
  });

  it('a level the config does not declare covers nothing and is covered by nothing', () => {
    expect(levelCovers('push', 'commit', ['commit', 'full'])).toBe(false);
    expect(levelCovers('full', 'push', ['commit', 'full'])).toBe(false);
  });

  it('vv validate defaults to the last level, the hook to the first', () => {
    expect(getDefaultValidateLevel(twoLevels)).toBe('full');
    expect(getDefaultPreCommitLevel(twoLevels)).toBe('commit');
    expect(getDefaultPreCommitLevel(source(['commit', 'full'], 'full'))).toBe('full');
    expect(getDefaultValidateLevel(source())).toBe(IMPLICIT_LEVEL);
    expect(getDefaultPreCommitLevel(source())).toBe(IMPLICIT_LEVEL);
  });

  it('an unknown level throws a coded error that lists the declared levels', () => {
    expect(() => getLevelIndex('push', twoLevels)).toThrow(UnknownLevelError);
    try {
      getLevelIndex('push', twoLevels);
    } catch (error) {
      expect((error as UnknownLevelError).code).toBe('UNKNOWN_LEVEL');
      expect((error as UnknownLevelError).message).toBe('Unknown level "push". Declared levels: commit, full');
    }
  });
});
