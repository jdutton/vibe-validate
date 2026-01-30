/**
 * Shared utility for formatting tree hash output (used by state and history commands)
 */

import type { RunCacheNote } from '@vibe-validate/history';

/**
 * Clean run cache entries by removing redundant treeHash and empty workdir
 */
export function cleanRunCacheEntries(entries: RunCacheNote[]): RunCacheNote[] {
  return entries.map(entry => {
    // Remove treeHash from output (redundant at root level)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { treeHash, ...withoutTreeHash } = entry;

    // Remove empty workdir to save tokens
    if (withoutTreeHash.workdir === '') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { workdir, ...withoutWorkdir } = withoutTreeHash;
      return withoutWorkdir as RunCacheNote;
    }

    return withoutTreeHash as RunCacheNote;
  });
}

/**
 * Format output with treeHash at root level and cleaned nested structures
 */
export function formatTreeHashOutput<T>(
  treeHash: string,
  validationData: T | null,
  runCacheEntries: RunCacheNote[],
  options: {
    includeValidation: boolean;
    includeRunCache: boolean;
  }
): Record<string, unknown> {
  const output: Record<string, unknown> = {
    treeHash,
  };

  // Add validation section if requested and data exists
  if (options.includeValidation && validationData) {
    // Remove treeHash from validation data (it's at root level)
    const validationObj = validationData as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { treeHash, ...validationWithoutTreeHash } = validationObj;
    output.validation = validationWithoutTreeHash;
  }

  // Add runCache section if requested and entries exist
  if (options.includeRunCache && runCacheEntries.length > 0) {
    output.runCache = cleanRunCacheEntries(runCacheEntries);
  }

  return output;
}
