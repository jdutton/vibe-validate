/**
 * Validation levels
 *
 * A config may declare an ordered list of named levels (`validation.levels`,
 * e.g. `[commit, full]`). Each level contains every level before it, and each
 * step names the lowest level that runs it. A run at level L runs every step
 * whose level is at or before L, so a pass at a later level covers every
 * earlier one on the same tree.
 *
 * A config that declares no levels has exactly one, named {@link IMPLICIT_LEVEL},
 * and every step belongs to it.
 */

/** The single level of a config that declares no `validation.levels` */
export const IMPLICIT_LEVEL = 'full';

/** The parts of a config the level rules read */
export interface LevelSource {
  validation: {
    levels?: string[];
    phases: ReadonlyArray<{ steps: ReadonlyArray<{ level?: string }> }>;
  };
  hooks?: { preCommit?: { level?: string } };
}

/**
 * The config's levels in order, lowest first
 *
 * @param config - Loaded config
 * @returns Declared levels, or `[IMPLICIT_LEVEL]` when none are declared
 */
export function getLevels(config: LevelSource): string[] {
  return config.validation.levels ?? [IMPLICIT_LEVEL];
}

/**
 * The level a step belongs to
 *
 * @param step - A validated step
 * @returns The step's level (the implicit one when levels are not declared)
 */
export function getStepLevel(step: { level?: string }): string {
  return step.level ?? IMPLICIT_LEVEL;
}

/**
 * Position of a level in the config's order
 *
 * @param level - Level name
 * @param config - Loaded config
 * @returns Zero-based index
 * @throws Error naming the declared levels when `level` is not one of them
 */
export function getLevelIndex(level: string, config: LevelSource): number {
  const levels = getLevels(config);
  const index = levels.indexOf(level);
  if (index === -1) {
    throw new UnknownLevelError(level, levels);
  }
  return index;
}

/**
 * Does a run at `runLevel` execute this step?
 *
 * @param step - A validated step
 * @param runLevel - The level being run
 * @param config - Loaded config
 * @returns true when the step's level is at or before `runLevel`
 */
export function stepRunsAtLevel(step: { level?: string }, runLevel: string, config: LevelSource): boolean {
  return getLevelIndex(getStepLevel(step), config) <= getLevelIndex(runLevel, config);
}

/**
 * Does a passing run at `coveringLevel` answer a request for `requestedLevel`?
 *
 * @param coveringLevel - Level of the recorded run
 * @param requestedLevel - Level being asked for
 * @param levels - The config's levels in order
 * @returns true when `coveringLevel` is `requestedLevel` or later; false when either is not a declared level
 */
export function levelCovers(coveringLevel: string, requestedLevel: string, levels: readonly string[]): boolean {
  const covering = levels.indexOf(coveringLevel);
  const requested = levels.indexOf(requestedLevel);
  return covering !== -1 && requested !== -1 && covering >= requested;
}

/** Level `vv validate` (and CI) runs when no `--level` is given: the last */
export function getDefaultValidateLevel(config: LevelSource): string {
  const levels = getLevels(config);
  return levels.at(-1) ?? IMPLICIT_LEVEL;
}

/** Level `vv pre-commit` runs when no `--level` is given: `hooks.preCommit.level`, else the first */
export function getDefaultPreCommitLevel(config: LevelSource): string {
  return config.hooks?.preCommit?.level ?? getLevels(config)[0] ?? IMPLICIT_LEVEL;
}

/** A requested level that the config does not declare */
export class UnknownLevelError extends Error {
  readonly code = 'UNKNOWN_LEVEL';

  constructor(readonly level: string, readonly levels: readonly string[]) {
    super(`Unknown level "${level}". Declared levels: ${levels.join(', ')}`);
    this.name = 'UnknownLevelError';
  }
}

/**
 * Collect the level-rule violations in a parsed config
 *
 * @param config - Config that passed the structural schema
 * @returns One message per violation, each with the config path it applies to
 */
export function findLevelViolations(config: LevelSource): LevelViolation[] {
  const declared = config.validation.levels;
  const violations = declared ? findDuplicateLevels(declared) : [];

  for (const [phaseIndex, phase] of config.validation.phases.entries()) {
    for (const [stepIndex, step] of phase.steps.entries()) {
      const stepMessage = checkStepLevel(step as { name?: string; level?: string }, declared);
      if (stepMessage) {
        violations.push({ path: ['validation', 'phases', phaseIndex, 'steps', stepIndex, 'level'], message: stepMessage });
      }
    }
  }

  const hookMessage = checkHookLevel(config.hooks?.preCommit?.level, declared);
  if (hookMessage) {
    violations.push({ path: ['hooks', 'preCommit', 'level'], message: hookMessage });
  }

  return violations;
}

/** One level-rule violation and the config path it applies to */
export interface LevelViolation {
  path: Array<string | number>;
  message: string;
}

function findDuplicateLevels(declared: readonly string[]): LevelViolation[] {
  const violations: LevelViolation[] = [];
  const seen = new Set<string>();
  for (const [index, level] of declared.entries()) {
    if (seen.has(level)) {
      violations.push({ path: ['validation', 'levels', index], message: `Duplicate level "${level}"` });
    }
    seen.add(level);
  }
  return violations;
}

function checkHookLevel(hookLevel: string | undefined, declared: readonly string[] | undefined): string | null {
  if (hookLevel === undefined) {
    return null;
  }
  if (!declared) {
    return `hooks.preCommit.level "${hookLevel}" is set but validation.levels is not declared`;
  }
  return declared.includes(hookLevel)
    ? null
    : `hooks.preCommit.level "${hookLevel}" is not a declared level (${declared.join(', ')})`;
}

function checkStepLevel(step: { name?: string; level?: string }, declared: readonly string[] | undefined): string | null {
  const name = step.name ?? '';
  if (!declared) {
    return step.level === undefined
      ? null
      : `Step "${name}" sets level "${step.level}" but validation.levels is not declared`;
  }
  if (step.level === undefined) {
    return `Step "${name}" has no level; every step needs one once validation.levels is declared (${declared.join(', ')})`;
  }
  if (!declared.includes(step.level)) {
    return `Step "${name}" names level "${step.level}", which is not declared (${declared.join(', ')})`;
  }
  return null;
}
