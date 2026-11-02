/**
 * Level Option
 *
 * Resolves a command's --level against the config's declared levels.
 */

import { getLevelIndex, getLevels, UnknownLevelError, type VibeValidateConfig } from '@vibe-validate/config';
import chalk from 'chalk';

import { outputYamlResult } from './yaml-output.js';

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
 * The level a command runs at, or exit 1 when the config does not declare it
 *
 * @param config - The loaded configuration
 * @param requested - The --level the user passed, if any
 * @param fallback - The command's default (`getDefaultValidateLevel` / `getDefaultPreCommitLevel`)
 * @returns A level the config declares
 */
export function resolveLevelOrExit(
  config: VibeValidateConfig,
  requested: string | undefined,
  fallback: string
): string {
  const level = requested ?? fallback;
  const unknown = checkLevel(config, level);
  if (unknown) {
    console.error(chalk.red(`❌ ${unknown.message}`));
    process.exit(1);
  }
  return level;
}

/**
 * The level `validate --check` asks about, or exit 2 when the config does not declare it
 *
 * --check reserves exit 1 for "the run that bears on the level failed", so an
 * unknown level exits 2 (cannot answer). With `yaml`, the error is a YAML
 * document on stdout (`exists: false`, `error`, `levels`), like every other
 * --check --yaml answer.
 *
 * @param config - The loaded configuration
 * @param requested - The --level the user passed, if any
 * @param fallback - validate's default level (`getDefaultValidateLevel`)
 * @param yaml - Whether the answer goes to stdout as YAML
 * @returns A level the config declares
 */
export async function resolveCheckLevelOrExit(
  config: VibeValidateConfig,
  requested: string | undefined,
  fallback: string,
  yaml: boolean
): Promise<string> {
  const level = requested ?? fallback;
  const unknown = checkLevel(config, level);
  if (unknown) {
    console.error(chalk.red(`❌ ${unknown.message}`));
    if (yaml) {
      await outputYamlResult({ exists: false, error: unknown.message, levels: getLevels(config) });
    }
    process.exit(2);
  }
  return level;
}
