/**
 * Level Option
 *
 * Resolves a command's --level against the config's declared levels.
 */

import { getLevelIndex, getLevels, UnknownLevelError, type VibeValidateConfig } from '@vibe-validate/config';
import chalk from 'chalk';

import { exitAtStartup, type StartupExit } from './startup-exit.js';

/** `level` when the config declares it, else the UnknownLevelError naming the declared levels */
function checkLevel(config: VibeValidateConfig, level: string): UnknownLevelError | null {
  try {
    getLevelIndex(level, config);
    return null;
  } catch (error) {
    if (error instanceof UnknownLevelError) return error;
    throw error;
  }
}

/**
 * The level a command runs at, or exit when the config does not declare it
 *
 * The exit is the command's startup exit: 1, or 2 for `validate --check` (whose
 * 1 means "the run that bears on the level failed"). With `yaml`, the error is a
 * YAML document on stdout (`exists: false`, `error`, `levels`).
 *
 * @param config - The loaded configuration
 * @param requested - The --level the user passed, if any
 * @param fallback - The command's default (`getDefaultValidateLevel` / `getDefaultPreCommitLevel`)
 * @param exit - The command's startup exit
 * @returns A level the config declares
 */
export async function resolveLevelOrExit(
  config: VibeValidateConfig,
  requested: string | undefined,
  fallback: string,
  exit: StartupExit
): Promise<string> {
  const level = requested ?? fallback;
  const unknown = checkLevel(config, level);
  if (unknown) {
    console.error(chalk.red(`❌ ${unknown.message}`));
    return exitAtStartup(exit, unknown.message, { levels: getLevels(config) });
  }
  return level;
}
