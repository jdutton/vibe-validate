/**
 * History pruning utilities
 *
 * Validation history is pruned from VALIDATION_NOTES_REF only; the ref is not a
 * parameter or a config key.
 */

import {
  listNoteObjects,
  readNote,
  removeNote,
  removeNotesRefs,
  type TreeHash,
  type NotesRef,
} from '@vibe-validate/git';
import { parse as parseYaml } from 'yaml';

import { getAllHistoryNotes } from './reader.js';
import { listRunCacheTreeHashes, getAllRunCacheForTree } from './run-cache-reader.js';
import { VALIDATION_NOTES_REF } from './schemas.js';
import type { PruneResult } from './types.js';

const NOTES_REF = VALIDATION_NOTES_REF as NotesRef;

/**
 * Prune validation history older than specified days
 *
 * @param olderThanDays - Remove notes older than this many days
 * @param dryRun - If true, don't actually delete (default: false)
 * @returns Prune result
 */
export async function pruneHistoryByAge(
  olderThanDays: number,
  dryRun: boolean = false
): Promise<PruneResult> {
  const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  let notesPruned = 0;
  let runsPruned = 0;
  const prunedTreeHashes: string[] = [];

  const allNotes = await getAllHistoryNotes();
  const notesRemaining = allNotes.length;

  for (const note of allNotes) {
    if (note.runs?.length === 0) {
      continue;
    }

    // Get oldest run timestamp
    const oldestRun = note.runs[0];
    const oldestTimestamp = new Date(oldestRun.timestamp).getTime();

    if (oldestTimestamp < cutoffTime) {
      // All runs in this note are old - delete entire note
      // Note: treeHash is always populated by readHistoryNote (falls back to ref path)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- readHistoryNote always sets treeHash
      const treeHash = note.treeHash! as TreeHash;

      if (!dryRun) {
        // Use secure removeNote function (no command injection risk)
        removeNote(NOTES_REF, treeHash);
      }

      notesPruned++;
      runsPruned += note.runs.length;
      prunedTreeHashes.push(treeHash);
    }
  }

  return {
    notesPruned,
    runsPruned,
    notesRemaining: notesRemaining - notesPruned,
    prunedTreeHashes,
  };
}

/**
 * Prune all validation history
 *
 * @param dryRun - If true, don't actually delete (default: false)
 * @returns Prune result
 */
export async function pruneAllHistory(dryRun: boolean = false): Promise<PruneResult> {
  const allNotes = await getAllHistoryNotes();
  let notesPruned = 0;
  let runsPruned = 0;
  const prunedTreeHashes: string[] = [];

  for (const note of allNotes) {
    // Note: treeHash is always populated by readHistoryNote (falls back to ref path)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- readHistoryNote always sets treeHash
    const treeHash = note.treeHash! as TreeHash;

    if (!dryRun) {
      // Use secure removeNote function (no command injection risk)
      removeNote(NOTES_REF, treeHash);
    }

    notesPruned++;
    runsPruned += note.runs?.length ?? 0;
    prunedTreeHashes.push(treeHash);
  }

  return {
    notesPruned,
    runsPruned,
    notesRemaining: 0,
    prunedTreeHashes,
  };
}

/**
 * Count the `runs` entries in a legacy note, whatever shape they have
 *
 * Legacy runs predate ValidationRunSchema, so they are counted raw, not parsed.
 */
function countLegacyRuns(ref: NotesRef, treeHash: TreeHash): number {
  try {
    const parsed = parseYaml(readNote(ref, treeHash) ?? '', { uniqueKeys: false }) as unknown;
    const runs = (parsed as { runs?: unknown } | null)?.runs;
    return Array.isArray(runs) ? runs.length : 0;
  } catch {
    // Unparseable legacy note: it is still removed, it just has no countable runs
    return 0;
  }
}

/**
 * Clean up legacy git notes from pre-0.15.0 versions
 *
 * Removes notes from the old `refs/notes/vibe-validate/runs` namespace.
 * Safe to call - only removes if legacy notes exist.
 *
 * @param dryRun - If true, don't actually delete (default: false)
 * @returns Prune result
 */
export async function pruneLegacyNotes(dryRun: boolean = false): Promise<PruneResult> {
  const legacyRef = 'vibe-validate/runs' as NotesRef;

  let notesPruned = 0;
  let runsPruned = 0;
  const prunedTreeHashes: string[] = [];

  try {
    for (const treeHash of listNoteObjects(legacyRef)) {
      runsPruned += countLegacyRuns(legacyRef, treeHash);

      if (!dryRun) {
        // Use secure removeNote function (no command injection risk)
        removeNote(legacyRef, treeHash);
      }

      notesPruned++;
      prunedTreeHashes.push(treeHash);
    }
  } catch {
    // No legacy notes found - that's fine
  }

  return {
    notesPruned,
    runsPruned,
    notesRemaining: 0,
    prunedTreeHashes,
  };
}

/**
 * Prune all run cache entries
 *
 * @param dryRun - If true, don't actually delete (default: false)
 * @returns Prune result
 */
export async function pruneAllRunCache(dryRun: boolean = false): Promise<PruneResult> {
  const treeHashes = await listRunCacheTreeHashes();
  let notesPruned = 0;
  const prunedTreeHashes: string[] = [];

  for (const treeHash of treeHashes) {
    const entries = await getAllRunCacheForTree(treeHash);

    if (entries.length === 0) {
      continue;
    }

    if (dryRun) {
      notesPruned += entries.length;
    } else {
      // SECURITY FIX: Use secure removeNotesRefs instead of shell piping
      // This eliminates command injection risk from treeHash variable
      const deleted = removeNotesRefs(`refs/notes/vibe-validate/run/${treeHash}`);
      notesPruned += deleted;
    }

    prunedTreeHashes.push(treeHash);
  }

  return {
    notesPruned,
    runsPruned: notesPruned, // For run cache, each note is one cached command
    notesRemaining: 0,
    prunedTreeHashes,
  };
}
