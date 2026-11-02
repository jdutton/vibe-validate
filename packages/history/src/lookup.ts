/**
 * Cache lookup with level and submodule state matching
 *
 * Only a PASSING run is ever a cache hit. A failed run is recorded for history,
 * `--retry-failed` and flakiness detection, but never replayed: a step that
 * failed because the machine was starved (a test timing out under load) exits
 * like any real failure, so a replayed red would stick until the tree changed.
 */

import { levelCovers } from '@vibe-validate/config';
import type { TreeHashResult } from '@vibe-validate/git';

import type { HistoryNote, ValidationRun } from './types.js';

/** The level a caller wants answered, with the config's levels in order */
export interface LevelRequest {
  level: string;
  levels: readonly string[];
}

/**
 * Find a cached PASS that answers a request at `request.level`
 *
 * A run qualifies when its submodule state matches the worktree, it passed, and
 * its level is the requested one or a later one (a later level ran every step of
 * the earlier ones). When several qualify, the most recent wins: runs are
 * stored oldest first, so the last qualifying one is returned.
 *
 * @param note - The history note for the worktree's tree hash (null when none)
 * @param treeHashResult - Current worktree state
 * @param request - Requested level and the config's levels
 * @returns The newest qualifying run, or null
 */
export function findCachedValidation(
  note: HistoryNote | null,
  treeHashResult: TreeHashResult,
  request: LevelRequest
): ValidationRun | null {
  return findNewestRun(note, treeHashResult, run =>
    run.passed && typeof run.level === 'string' && levelCovers(run.level, request.level, request.levels)
  );
}

/**
 * Find the run `--retry-failed` builds on: the newest at exactly `level`
 *
 * @param note - The history note for the worktree's tree hash (null when none)
 * @param treeHashResult - Current worktree state
 * @param level - The level being retried
 * @returns The newest run at that level with matching submodule state, pass or fail, or null
 */
export function findRetryRun(
  note: HistoryNote | null,
  treeHashResult: TreeHashResult,
  level: string
): ValidationRun | null {
  return findNewestRun(note, treeHashResult, run => run.level === level);
}

function findNewestRun(
  note: HistoryNote | null,
  treeHashResult: TreeHashResult,
  qualifies: (_run: ValidationRun) => boolean
): ValidationRun | null {
  if (!note?.runs.length) {
    return null;
  }
  // Iterate backwards since new runs are appended to the end (git-notes.ts mergeNotes)
  for (let i = note.runs.length - 1; i >= 0; i--) {
    const run = note.runs[i];
    if (submoduleHashesMatch(run.submoduleHashes, treeHashResult.submoduleHashes) && qualifies(run)) {
      return run;
    }
  }
  return null;
}

/**
 * Check if submodule hashes match
 *
 * Handles undefined (no submodules) and partial matches.
 *
 * @param runHashes - Submodule hashes from cached run
 * @param currentHashes - Current worktree submodule hashes
 * @returns true if hashes match
 */
function submoduleHashesMatch(
  runHashes: Record<string, string> | undefined,
  currentHashes: Record<string, string> | undefined
): boolean {
  // Both undefined → match (no submodules)
  if (!runHashes && !currentHashes) {
    return true;
  }

  // One has submodules, other doesn't → no match
  if (!runHashes || !currentHashes) {
    return false;
  }

  // Compare keys
  const runKeys = Object.keys(runHashes).sort((a, b) => a.localeCompare(b, 'en'));
  const currentKeys = Object.keys(currentHashes).sort((a, b) => a.localeCompare(b, 'en'));

  if (runKeys.length !== currentKeys.length) {
    return false;
  }

  // Compare values
  for (const runKey of runKeys) {
    const index = runKeys.indexOf(runKey);
    if (runKey !== currentKeys[index]) {
      return false;
    }
    if (runHashes[runKey] !== currentHashes[currentKeys[index]]) {
      return false;
    }
  }

  return true;
}
