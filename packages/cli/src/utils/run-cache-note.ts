/**
 * Run Cache Note
 *
 * Reads a `vv run` cache note back as a result.
 */

import type { RunCacheNote } from '@vibe-validate/history';
import yaml from 'yaml';

import type { RunResult } from '../schemas/run-result-schema.js';

/**
 * The cached result a `vv run` note holds, or null when it is not a cache hit
 *
 * Only a passing run is a hit. `vv run` stores only exit code 0, but the note
 * ref is shared with every worktree and every vv version, so a note holding a
 * failure is refused on read too: a replayed red sticks until the tree changes.
 *
 * @param noteContent - The note's YAML
 * @returns The result marked `isCachedResult`, or null for a failure
 */
export function parseRunCacheNote(noteContent: string): RunResult | null {
  const cachedNote = yaml.parse(noteContent) as RunCacheNote;
  if (cachedNote.exitCode !== 0) {
    return null;
  }

  // Migration: v0.14.x cached notes used 'duration' (ms), v0.15.0+ uses 'durationSecs' (s)
  const legacyDurationMs = (cachedNote as { duration?: number }).duration;
  const durationSecs = cachedNote.durationSecs ?? (legacyDurationMs ? legacyDurationMs / 1000 : 0);

  return {
    command: cachedNote.command, // Use command from cache (may be unwrapped)
    exitCode: cachedNote.exitCode,
    durationSecs,
    timestamp: cachedNote.timestamp,
    treeHash: cachedNote.treeHash,
    extraction: cachedNote.extraction,
    ...(cachedNote.outputFiles ? { outputFiles: cachedNote.outputFiles } : {}),
    isCachedResult: true, // Mark as cache hit
  };
}
