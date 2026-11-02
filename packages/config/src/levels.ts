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
  return declaredLevels(config.validation.levels) ?? [IMPLICIT_LEVEL];
}

/** The declared levels, or undefined when none are (an empty list declares none) */
function declaredLevels(levels: string[] | undefined): string[] | undefined {
  return levels && levels.length > 0 ? levels : undefined;
}

/**
 * The level a step belongs to
 *
 * @param step - A step
 * @param levels - The config's levels in order (see {@link getLevels})
 * @returns The step's level, or the only level when there is just one
 * @throws MissingStepLevelError when the step names no level and there are several to choose from;
 *   the schema rejects such a config, so only an unvalidated one reaches this
 */
export function getStepLevel(step: { name?: string; level?: string }, levels: readonly string[]): string {
  if (step.level !== undefined) {
    return step.level;
  }
  const [only] = levels;
  if (levels.length === 1 && only) {
    return only;
  }
  throw new MissingStepLevelError(step.name ?? '', levels);
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
export function stepRunsAtLevel(step: { name?: string; level?: string }, runLevel: string, config: LevelSource): boolean {
  return getLevelIndex(getStepLevel(step, getLevels(config)), config) <= getLevelIndex(runLevel, config);
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

/** A step with no level where the config declares several to choose from */
export class MissingStepLevelError extends Error {
  readonly code = 'MISSING_STEP_LEVEL';

  constructor(readonly stepName: string, readonly levels: readonly string[]) {
    super(missingLevelMessage(stepName, levels));
    this.name = 'MissingStepLevelError';
  }
}

function missingLevelMessage(stepName: string, levels: readonly string[]): string {
  return `Step "${stepName}" has no level; every step needs one once validation.levels is declared (${levels.join(', ')})`;
}

/**
 * Collect the level-rule violations in a `validation` section
 *
 * An empty `levels` list is reported by the schema on its own, so no step is
 * judged against it.
 *
 * @param validation - A `validation` section that passed the structural schema
 * @returns One message per violation, each with its path relative to `validation`
 */
export function findValidationLevelViolations(validation: LevelSource['validation']): LevelViolation[] {
  const declared = declaredLevels(validation.levels);
  const steps = validation.phases.flatMap((phase, phaseIndex) =>
    phase.steps.map((step, stepIndex) => ({ step: step as { name?: string; level?: string }, phaseIndex, stepIndex }))
  );

  // An empty list is its own error; judging the steps against it would add a false "not declared"
  if (validation.levels?.length === 0) {
    return [];
  }
  const stepViolations = steps.flatMap(({ step, phaseIndex, stepIndex }) => {
    const message = checkStepLevel(step, declared);
    return message ? [{ path: ['phases', phaseIndex, 'steps', stepIndex, 'level'], message }] : [];
  });
  if (!declared) {
    return stepViolations;
  }

  // A level looks empty only because a step is missing or misnames its level: report the step alone
  const emptyLevels = stepViolations.length === 0 ? findEmptyLevels(declared, steps.map(entry => entry.step.level)) : [];
  return [...findDuplicateLevels(declared), ...emptyLevels, ...stepViolations];
}

/**
 * Check `hooks.preCommit.level` against the declared levels
 *
 * @param config - Config that passed the structural schema
 * @returns The violation, with its path from the config root, or null
 */
export function findHookLevelViolation(config: LevelSource): LevelViolation | null {
  const message = checkHookLevel(config.hooks?.preCommit?.level, declaredLevels(config.validation.levels));
  return message ? { path: ['hooks', 'preCommit', 'level'], message } : null;
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
      violations.push({ path: ['levels', index], message: `Duplicate level "${level}"` });
    }
    seen.add(level);
  }
  return violations;
}

/** A declared level no step names adds nothing: a run at it repeats the level before, or runs nothing at all */
function findEmptyLevels(declared: readonly string[], stepLevels: ReadonlyArray<string | undefined>): LevelViolation[] {
  const used = new Set(stepLevels);
  return declared.flatMap((level, index) =>
    used.has(level) || declared.indexOf(level) !== index
      ? []
      : [{ path: ['levels', index], message: `Level "${level}" has no steps; give it a step or remove it` }]
  );
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
    return missingLevelMessage(name, declared);
  }
  if (!declared.includes(step.level)) {
    return `Step "${name}" names level "${step.level}", which is not declared (${declared.join(', ')})`;
  }
  return null;
}
