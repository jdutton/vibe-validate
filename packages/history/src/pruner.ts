/**
 * History pruning utilities
 */

import { removeNote, removeNotesRefs } from '@vibe-validate/git';
import type { PruneResult, HistoryConfig } from './types.js';
import { DEFAULT_HISTORY_CONFIG } from './types.js';
import { getAllHistoryNotes } from './reader.js';
import { listRunCacheTreeHashes, getAllRunCacheForTree } from './run-cache-reader.js';

// Removed: Git operations now use secure @vibe-validate/git functions

/**
 * Merge user config with defaults
 */
function mergeConfig(config: HistoryConfig = {}): {
  gitNotes: { ref: string };
} {
  return {
    ...DEFAULT_HISTORY_CONFIG,
    ...config,
    gitNotes: {
      ...DEFAULT_HISTORY_CONFIG.gitNotes,
      ...(config.gitNotes ?? {}),
    },
  };
}

/**
 * Prune validation history older than specified days
 *
 * @param olderThanDays - Remove notes older than this many days
 * @param config - History configuration
 * @param dryRun - If true, don't actually delete (default: false)
 * @returns Prune result
 */
export async function pruneHistoryByAge(
  olderThanDays: number,
  config: HistoryConfig = {},
  dryRun: boolean = false
): Promise<PruneResult> {
  const mergedConfig = mergeConfig(config);
  const notesRef = mergedConfig.gitNotes.ref;
  const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  let notesPruned = 0;
  let runsPruned = 0;
  const prunedTreeHashes: string[] = [];

  const allNotes = await getAllHistoryNotes(notesRef);
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
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const treeHash = note.treeHash!;

      if (!dryRun) {
        // Use secure removeNote function (no command injection risk)
        removeNote(notesRef, treeHash);
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
 * @param config - History configuration
 * @param dryRun - If true, don't actually delete (default: false)
 * @returns Prune result
 */
export async function pruneAllHistory(
  config: HistoryConfig = {},
  dryRun: boolean = false
): Promise<PruneResult> {
  const mergedConfig = mergeConfig(config);
  const notesRef = mergedConfig.gitNotes.ref;

  const allNotes = await getAllHistoryNotes(notesRef);
  let notesPruned = 0;
  let runsPruned = 0;
  const prunedTreeHashes: string[] = [];

  for (const note of allNotes) {
    // Note: treeHash is always populated by readHistoryNote (falls back to ref path)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const treeHash = note.treeHash!;

    if (!dryRun) {
      // Use secure removeNote function (no command injection risk)
      removeNote(notesRef, treeHash);
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
 * Clean up legacy git notes from pre-0.15.0 versions
 *
 * Removes notes from the old `refs/notes/vibe-validate/runs` namespace.
 * Safe to call - only removes if legacy notes exist.
 *
 * @param dryRun - If true, don't actually delete (default: false)
 * @returns Prune result
 */
export async function pruneLegacyNotes(dryRun: boolean = false): Promise<PruneResult> {
  const legacyRef = 'vibe-validate/runs';

  let notesPruned = 0;
  let runsPruned = 0;
  const prunedTreeHashes: string[] = [];

  try {
    const allNotes = await getAllHistoryNotes(legacyRef);

    for (const note of allNotes) {
      // Note: treeHash is always populated by readHistoryNote (falls back to ref path)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const treeHash = note.treeHash!;

      if (!dryRun) {
        // Use secure removeNote function (no command injection risk)
        removeNote(legacyRef, treeHash);
      }

      notesPruned++;
      runsPruned += note.runs?.length ?? 0;
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

    if (entries.length > 0) {
      if (!dryRun) {
        // SECURITY FIX: Use secure removeNotesRefs instead of shell piping
        // This eliminates command injection risk from treeHash variable
        const deleted = removeNotesRefs(`refs/notes/vibe-validate/run/${treeHash}`);
        notesPruned += deleted;
      } else {
        notesPruned += entries.length;
      }

      prunedTreeHashes.push(treeHash);
    }
  }

  return {
    notesPruned,
    runsPruned: notesPruned, // For run cache, each note is one cached command
    notesRemaining: 0,
    prunedTreeHashes,
  };
}
