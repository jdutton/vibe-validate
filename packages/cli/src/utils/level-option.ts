/**
 * Level Option
 *
 * Resolves a command's --level against the config's declared levels.
 */

import { getLevelIndex, UnknownLevelError, type VibeValidateConfig } from '@vibe-validate/config';
import chalk from 'chalk';

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
  try {
    getLevelIndex(level, config);
    return level;
  } catch (error) {
    if (error instanceof UnknownLevelError) {
      console.error(chalk.red(`❌ ${error.message}`));
      process.exit(1);
    }
    throw error;
  }
}
