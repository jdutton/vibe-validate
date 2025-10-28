/**
 * History pruning utilities
 */

import { execSync } from 'node:child_process';
import type { PruneResult, HistoryConfig } from './types.js';
import { DEFAULT_HISTORY_CONFIG } from './types.js';
import { getAllHistoryNotes } from './reader.js';

const GIT_TIMEOUT = 30000;
const GIT_OPTIONS = {
  encoding: 'utf8' as const,
  timeout: GIT_TIMEOUT,
  stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'],
};

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
  const mergedConfig = {
    ...DEFAULT_HISTORY_CONFIG,
    ...config,
    gitNotes: {
      ...DEFAULT_HISTORY_CONFIG.gitNotes,
      ...config.gitNotes,
    },
  };

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
      if (!dryRun) {
        try {
          execSync(
            `git notes --ref=${notesRef} remove ${note.treeHash}`,
            { ...GIT_OPTIONS, stdio: 'ignore' }
          );
        } catch {
          // Ignore errors (note might not exist)
        }
      }

      notesPruned++;
      runsPruned += note.runs.length;
      prunedTreeHashes.push(note.treeHash);
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
  const mergedConfig = {
    ...DEFAULT_HISTORY_CONFIG,
    ...config,
    gitNotes: {
      ...DEFAULT_HISTORY_CONFIG.gitNotes,
      ...config.gitNotes,
    },
  };

  const notesRef = mergedConfig.gitNotes.ref;

  const allNotes = await getAllHistoryNotes(notesRef);
  let notesPruned = 0;
  let runsPruned = 0;
  const prunedTreeHashes: string[] = [];

  for (const note of allNotes) {
    if (!dryRun) {
      try {
        execSync(
          `git notes --ref=${notesRef} remove ${note.treeHash}`,
          { ...GIT_OPTIONS, stdio: 'ignore' }
        );
      } catch {
        // Ignore errors
      }
    }

    notesPruned++;
    runsPruned += note.runs?.length ?? 0;
    prunedTreeHashes.push(note.treeHash);
  }

  return {
    notesPruned,
    runsPruned,
    notesRemaining: 0,
    prunedTreeHashes,
  };
}
