/**
 * History health check utilities
 *
 * O(1) implementation: uses at most 2 git spawns regardless of note count.
 * - listNoteObjects(): single `git notes list` to get count
 * - git log on the notes ref: single spawn to check last modification time
 */

import { listNoteObjects, executeGitCommand } from '@vibe-validate/git';
import type { NotesRef } from '@vibe-validate/git';

import type { HealthCheckResult, HistoryConfig } from './types.js';
import { DEFAULT_HISTORY_CONFIG } from './types.js';

/**
 * Check validation history health
 *
 * O(1) complexity: counts notes via `git notes list` (1 spawn)
 * and checks age via `git log -1` on the notes ref (1 spawn).
 *
 * @param config - History configuration
 * @returns Health check result
 */
export async function checkHistoryHealth(
  config: HistoryConfig = {}
): Promise<HealthCheckResult> {
  const mergedConfig = {
    ...DEFAULT_HISTORY_CONFIG,
    ...config,
    retention: {
      ...DEFAULT_HISTORY_CONFIG.retention,
      ...config.retention,
    },
  };

  // Type assertion safe: DEFAULT_HISTORY_CONFIG is Required<HistoryConfig>
  const warnAfterDays = (mergedConfig.retention.warnAfterDays ?? DEFAULT_HISTORY_CONFIG.retention.warnAfterDays);
  const warnAfterCount = (mergedConfig.retention.warnAfterCount ?? DEFAULT_HISTORY_CONFIG.retention.warnAfterCount);

  const ref = (mergedConfig.gitNotes.ref ?? DEFAULT_HISTORY_CONFIG.gitNotes.ref) as NotesRef;

  // O(1): single git spawn to list note object hashes (no content reading)
  const noteHashes = listNoteObjects(ref);
  const totalNotes = noteHashes.length;

  // O(1): single git spawn to check last modification time of the notes ref.
  // If the notes ref hasn't been updated in warnAfterDays, old notes likely exist.
  let oldNotesCount = 0;
  const fullRef = `refs/notes/${ref}`;
  const logResult = executeGitCommand(
    ['log', '-1', '--format=%aI', fullRef],
    { ignoreErrors: true, suppressStderr: true }
  );

  if (logResult.success && logResult.stdout.trim()) {
    const lastModified = new Date(logResult.stdout.trim()).getTime();
    const cutoffTime = Date.now() - warnAfterDays * 24 * 60 * 60 * 1000;

    if (lastModified < cutoffTime) {
      // Notes ref hasn't been touched since before the cutoff,
      // so all notes are potentially old
      oldNotesCount = totalNotes;
    }
  }
  // If git log fails (e.g., no notes ref yet), skip age check (oldNotesCount stays 0)

  // Determine if we should warn
  const shouldWarnCount = totalNotes > warnAfterCount;
  const shouldWarnAge = oldNotesCount > 0;
  const shouldWarn = shouldWarnCount || shouldWarnAge;

  let warningMessage: string | undefined;

  if (shouldWarnCount && shouldWarnAge) {
    warningMessage =
      `ℹ️  Validation history has grown large (${totalNotes} tree hashes)\n` +
      `   Found ${oldNotesCount} notes older than ${warnAfterDays} days\n` +
      `   Consider pruning: vibe-validate history prune --older-than "${warnAfterDays} days"`;
  } else if (shouldWarnCount) {
    warningMessage =
      `ℹ️  Validation history has grown large (${totalNotes} tree hashes)\n` +
      `   Consider pruning: vibe-validate history prune --older-than "${warnAfterDays} days"`;
  } else if (shouldWarnAge) {
    warningMessage =
      `ℹ️  Found validation history older than ${warnAfterDays} days\n` +
      `   ${oldNotesCount} tree hashes can be pruned\n` +
      `   Run: vibe-validate history prune --older-than "${warnAfterDays} days"`;
  }

  return {
    totalNotes,
    oldNotesCount,
    shouldWarn,
    warningMessage,
  };
}
