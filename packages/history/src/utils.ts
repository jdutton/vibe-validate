/**
 * Utility functions for validation history
 *
 * @packageDocumentation
 */

import type { ValidationRun } from './types.js';

/**
 * Get the most recent run from a runs array.
 *
 * Array ordering contract: New runs are appended to the END by mergeNotes()
 * in @vibe-validate/git (see git-notes.ts line 244).
 *
 * Therefore, the most recent run is always at index -1 (last element).
 *
 * @param runs - Array of validation runs (may be empty)
 * @returns Most recent run or undefined if array is empty
 *
 * @example
 * ```typescript
 * const runs = [oldRun, newerRun, newestRun];
 * const latest = getMostRecentRun(runs); // Returns newestRun
 * ```
 */
export function getMostRecentRun(runs: ValidationRun[]): ValidationRun | undefined {
  return runs.at(-1);
}
