import { describe, it, expect } from 'vitest';

import {
  IMPLICIT_LEVEL,
  getLevels,
  getLevelIndex,
  stepRunsAtLevel,
  levelCovers,
  getDefaultValidateLevel,
  getDefaultPreCommitLevel,
  getStepLevel,
  findValidationLevelViolations,
  MissingStepLevelError,
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

  it('a step with no level belongs to the only level, and has no level to guess when there are several', () => {
    expect(getStepLevel({}, [IMPLICIT_LEVEL])).toBe(IMPLICIT_LEVEL);
    expect(getStepLevel({ level: 'commit' }, ['commit', 'full'])).toBe('commit');
    expect(() => getStepLevel({ name: 'Lint' }, ['commit', 'full'])).toThrow(MissingStepLevelError);
    try {
      getStepLevel({ name: 'Lint' }, ['commit', 'full']);
    } catch (error) {
      expect((error as MissingStepLevelError).code).toBe('MISSING_STEP_LEVEL');
      expect((error as MissingStepLevelError).message).toBe(
        'Step "Lint" has no level; every step needs one once validation.levels is declared (commit, full)'
      );
    }
    expect(() => stepRunsAtLevel({}, 'full', twoLevels)).toThrow(MissingStepLevelError);
  });
});

/**
 * A level source with one phase holding the given steps
 * @param levels - Declared levels, or undefined for none
 * @param steps - Steps of the single phase
 * @returns A level source
 */
function withSteps(levels: string[] | undefined, steps: Array<{ name: string; level?: string }>): LevelSource['validation'] {
  return { ...(levels ? { levels } : {}), phases: [{ steps }] };
}

describe('findValidationLevelViolations', () => {
  it('an empty levels list reports nothing about the steps: it is the same as no list', () => {
    expect(findValidationLevelViolations(withSteps([], [{ name: 'A' }]))).toEqual([]);
  });

  it('rejects a declared level that adds no steps, naming it', () => {
    expect(findValidationLevelViolations(withSteps(['quick', 'full'], [{ name: 'A', level: 'full' }]))).toEqual([
      { path: ['levels', 0], message: 'Level "quick" has no steps; give it a step or remove it' },
    ]);
  });

  it('rejects a later level that adds nothing to the one before it', () => {
    expect(findValidationLevelViolations(withSteps(['commit', 'full'], [{ name: 'A', level: 'commit' }]))).toEqual([
      { path: ['levels', 1], message: 'Level "full" has no steps; give it a step or remove it' },
    ]);
  });

  it('accepts levels that each add a step', () => {
    expect(findValidationLevelViolations(withSteps(['commit', 'full'], [
      { name: 'A', level: 'commit' },
      { name: 'B', level: 'full' },
    ]))).toEqual([]);
  });
});
