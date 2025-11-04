/**
 * Run cache reader - Read run cache entries from git notes
 *
 * Run cache is stored at: refs/notes/vibe-validate/run/{treeHash}/{cacheKey}
 * where cacheKey = encodeURIComponent(workdir ? `${workdir}:${command}` : command)
 */

import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import type { RunCacheNote } from './types.js';

const GIT_TIMEOUT = 30000;
const GIT_OPTIONS = {
  encoding: 'utf8' as const,
  timeout: GIT_TIMEOUT,
  stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'],
};

/**
 * Entry metadata from git notes list
 */
export interface RunCacheEntryMeta {
  treeHash: string;
  cacheKey: string; // URL-encoded cache key
  refPath: string; // Full ref path
}

/**
 * List all run cache entries for a tree hash
 *
 * @param treeHash - Git tree hash
 * @returns Array of run cache entry metadata
 */
export async function listRunCacheEntries(treeHash: string): Promise<RunCacheEntryMeta[]> {
  try {
    // List all notes under refs/notes/vibe-validate/run/{treeHash}/*
    const output = execSync(
      `git for-each-ref --format="%(refname) %(objectname)" refs/notes/vibe-validate/run/${treeHash}/`,
      GIT_OPTIONS
    );

    if (!output.trim()) {
      return [];
    }

    // Parse output: "refs/notes/vibe-validate/run/{treeHash}/{cacheKey} {noteObjectName}"
    const entries = output
      .trim()
      .split('\n')
      .map((line) => {
        const [refPath] = line.split(' ');
        // Extract cache key from ref path
        const regex = /refs\/notes\/vibe-validate\/run\/([^/]+)\/(.+)$/;
        const match = regex.exec(refPath);
        if (!match) return null;

        const [, treeHashFromRef, cacheKey] = match;
        return {
          treeHash: treeHashFromRef,
          cacheKey,
          refPath,
        };
      })
      .filter(Boolean) as RunCacheEntryMeta[];

    return entries;
  } catch {
    // No run cache exists - expected for tree hashes without run cache
    return [];
  }
}

/**
 * Get a specific run cache entry
 *
 * @param treeHash - Git tree hash
 * @param cacheKey - URL-encoded cache key
 * @returns Run cache note or null if not found
 */
export async function getRunCacheEntry(
  treeHash: string,
  cacheKey: string
): Promise<RunCacheNote | null> {
  try {
    const refPath = `vibe-validate/run/${treeHash}/${cacheKey}`;
    const yaml = execSync(`git notes --ref=${refPath} show HEAD`, GIT_OPTIONS);

    const note = parseYaml(yaml) as RunCacheNote;
    return note;
  } catch {
    // Entry doesn't exist or parse failed
    return null;
  }
}

/**
 * Get all run cache entries for a tree hash
 *
 * @param treeHash - Git tree hash
 * @returns Array of all run cache notes for this tree hash
 */
export async function getAllRunCacheForTree(treeHash: string): Promise<RunCacheNote[]> {
  const entries = await listRunCacheEntries(treeHash);
  const notes: RunCacheNote[] = [];

  for (const entry of entries) {
    const note = await getRunCacheEntry(entry.treeHash, entry.cacheKey);
    if (note) {
      notes.push(note);
    }
  }

  return notes;
}

/**
 * List all tree hashes that have run cache entries
 *
 * @returns Array of tree hashes with run cache
 */
export async function listRunCacheTreeHashes(): Promise<string[]> {
  try {
    // List all notes under refs/notes/vibe-validate/run/
    const output = execSync(
      'git for-each-ref --format="%(refname)" refs/notes/vibe-validate/run/',
      GIT_OPTIONS
    );

    if (!output.trim()) {
      return [];
    }

    // Parse output and extract unique tree hashes
    const treeHashes = new Set<string>();
    const lines = output.trim().split('\n');

    for (const line of lines) {
      // Extract tree hash from ref path: refs/notes/vibe-validate/run/{treeHash}/...
      const regex = /refs\/notes\/vibe-validate\/run\/([^/]+)/;
      const match = regex.exec(line);
      if (match) {
        treeHashes.add(match[1]);
      }
    }

    return Array.from(treeHashes);
  } catch {
    // No run cache exists - expected for repos without run cache
    return [];
  }
}

/**
 * Get all run cache entries across all tree hashes
 *
 * @returns Array of all run cache notes
 */
export async function getAllRunCacheEntries(): Promise<RunCacheNote[]> {
  const treeHashes = await listRunCacheTreeHashes();
  const allNotes: RunCacheNote[] = [];

  for (const treeHash of treeHashes) {
    const notes = await getAllRunCacheForTree(treeHash);
    allNotes.push(...notes);
  }

  // Sort by timestamp (newest first)
  allNotes.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return allNotes;
}
