/**
 * History health check utilities
 */

import type { HealthCheckResult, HistoryConfig } from './types.js';
import { DEFAULT_HISTORY_CONFIG } from './types.js';
import { getAllHistoryNotes } from './reader.js';

/**
 * Check validation history health
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
  const warnAfterDays = (mergedConfig.retention.warnAfterDays ?? DEFAULT_HISTORY_CONFIG.retention.warnAfterDays) as number;
  const warnAfterCount = (mergedConfig.retention.warnAfterCount ?? DEFAULT_HISTORY_CONFIG.retention.warnAfterCount) as number;

  const allNotes = await getAllHistoryNotes(
    mergedConfig.gitNotes.ref
  );

  const totalNotes = allNotes.length;
  const cutoffTime = Date.now() - warnAfterDays * 24 * 60 * 60 * 1000;

  let oldNotesCount = 0;

  for (const note of allNotes) {
    if (note.runs.length === 0) {
      continue;
    }

    // Check oldest run
    const oldestRun = note.runs[0];
    const oldestTimestamp = new Date(oldestRun.timestamp).getTime();

    if (oldestTimestamp < cutoffTime) {
      oldNotesCount++;
    }
  }

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
