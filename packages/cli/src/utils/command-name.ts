/**
 * Command name detection utilities
 *
 * Detects the actual command name used to invoke vibe-validate (e.g., "vv" vs "vibe-validate")
 * so error messages and usage examples reflect what the user actually typed.
 */

import { basename } from 'node:path';

// Constants (extracted to avoid duplication warnings)
const COMMAND_NAME_DEFAULT = 'vibe-validate';

/**
 * Get the command name that was used to invoke the CLI
 *
 * @returns The command name (e.g., "vv", "vibe-validate", or fallback "vibe-validate")
 *
 * @example
 * ```typescript
 * const cmd = getCommandName();
 * console.error(`Usage: ${cmd} watch-pr <pr-number>`);
 * // If invoked with "vv": "Usage: vv watch-pr <pr-number>"
 * // If invoked with "vibe-validate": "Usage: vibe-validate watch-pr <pr-number>"
 * ```
 */
export function getCommandName(): string {
  // Check if the wrapper passed the command name via environment variable
  // This is set by the smart wrapper (bin/vibe-validate.ts) when it spawns bin.js
  const envCommandName = process.env.VV_COMMAND_NAME;
  if (envCommandName === 'vv' || envCommandName === COMMAND_NAME_DEFAULT) {
    return envCommandName;
  }

  // Fallback: extract from process.argv[1] (for direct invocation or dev mode)
  // process.argv[0] is node executable
  // process.argv[1] is the script being executed (e.g., /path/to/vv or /path/to/vibe-validate)
  const scriptPath = process.argv[1];

  if (!scriptPath) {
    return COMMAND_NAME_DEFAULT; // Fallback
  }

  // Extract basename (e.g., "vv" from "/usr/local/bin/vv")
  const commandName = basename(scriptPath);

  // Handle common cases: vv, vibe-validate, or .js/.ts extensions in dev mode
  if (commandName === 'vv' || commandName === COMMAND_NAME_DEFAULT) {
    return commandName;
  }

  // Dev mode: might be bin.js, bin.ts, vibe-validate.js, etc.
  // Fall back to "vibe-validate" for consistency
  return COMMAND_NAME_DEFAULT;
}
