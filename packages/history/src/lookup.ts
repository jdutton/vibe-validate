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

/** A run passed only when both the run and its result say so */
function isPass(run: ValidationRun): boolean {
  return run.passed && run.result.passed;
}

/**
 * Find the run that decides a request at `request.level`
 *
 * Runs with matching submodule state are read newest first. A pass whose level
 * does not cover the request (an earlier level skipped steps the request runs)
 * says nothing about it and is skipped. The first remaining run decides: a pass
 * covering the request, or a failure at ANY level. A failure always decides,
 * because a newer red means the tree failed since the last green (a `--force`
 * re-check that went red must overturn the pass it re-checked), and a red at
 * another level may be a step the request also runs.
 *
 * @param note - The history note for the worktree's tree hash (null when none)
 * @param treeHashResult - Current worktree state
 * @param request - Requested level and the config's levels
 * @returns The deciding run (pass or failure), or null when nothing is recorded that bears on it
 */
export function findDecidingRun(
  note: HistoryNote | null,
  treeHashResult: TreeHashResult,
  request: LevelRequest
): ValidationRun | null {
  return findNewestRun(note, treeHashResult, run =>
    !isPass(run) || levelCovers(run.level, request.level, request.levels)
  );
}

/**
 * Find a cached PASS that answers a request at `request.level`
 *
 * The deciding run (see findDecidingRun) answers only when it passed; a deciding
 * failure is a miss, never a replay.
 *
 * @param note - The history note for the worktree's tree hash (null when none)
 * @param treeHashResult - Current worktree state
 * @param request - Requested level and the config's levels
 * @returns The deciding run when it passed, or null
 */
export function findCachedValidation(
  note: HistoryNote | null,
  treeHashResult: TreeHashResult,
  request: LevelRequest
): ValidationRun | null {
  const run = findDecidingRun(note, treeHashResult, request);
  return run && isPass(run) ? run : null;
}

/**
 * Find the run `--retry-failed` builds on
 *
 * Only the deciding run (see findDecidingRun) may be built on, and only when it
 * failed at exactly `request.level`. An older run at the level is never used:
 * the steps it passed may fail now (a newer red says the tree failed since).
 *
 * @param note - The history note for the worktree's tree hash (null when none)
 * @param treeHashResult - Current worktree state
 * @param request - The level being retried and the config's levels
 * @returns The deciding failure at that level, or null (retry then runs every step)
 */
export function findRetryRun(
  note: HistoryNote | null,
  treeHashResult: TreeHashResult,
  request: LevelRequest
): ValidationRun | null {
  const run = findDecidingRun(note, treeHashResult, request);
  return run && !isPass(run) && run.level === request.level ? run : null;
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
