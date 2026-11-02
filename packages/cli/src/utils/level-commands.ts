/**
 * Commands that name a level
 *
 * One builder for every hint that tells the user which command to run next, so
 * none of them can name the wrong level.
 */

import { getDefaultValidateLevel, type VibeValidateConfig } from '@vibe-validate/config';

import { getCommandName } from './command-name.js';

/** The command that runs `level`: `--level` is named only when it is not validate's default */
export function validateCommandFor(config: VibeValidateConfig, level: string): string {
  const levelFlag = level === getDefaultValidateLevel(config) ? '' : ` --level ${level}`;
  return `${getCommandName()} validate${levelFlag}`;
}

/** The command that shows the run deciding `level` (always named: state's default may differ) */
export function stateCommandFor(level: string): string {
  return `${getCommandName()} state --level ${level}`;
}
