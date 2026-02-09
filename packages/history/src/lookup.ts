/**
 * Cache lookup with submodule state matching
 */

import type { TreeHashResult } from '@vibe-validate/git';

import { readHistoryNote } from './reader.js';
import type { ValidationRun } from './types.js';

const DEFAULT_NOTES_REF = 'vibe-validate/validate';

/**
 * Find cached validation result matching current worktree state
 *
 * Matches both parent tree hash and submodule state (if present).
 *
 * @param treeHashResult - Current worktree state
 * @param notesRef - Git notes reference
 * @returns Matching validation run or null
 */
export async function findCachedValidation(
  treeHashResult: TreeHashResult,
  notesRef: string = DEFAULT_NOTES_REF
): Promise<ValidationRun | null> {
  // Read note at root tree hash
  const note = await readHistoryNote(treeHashResult.hash, notesRef);
  if (!note?.runs.length) {
    return null;
  }

  // Find MOST RECENT run with matching submodule state
  // Iterate backwards since new runs are appended to the end (git-notes.ts mergeNotes)
  for (let i = note.runs.length - 1; i >= 0; i--) {
    const run = note.runs[i];
    if (submoduleHashesMatch(run.submoduleHashes, treeHashResult.submoduleHashes)) {
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
