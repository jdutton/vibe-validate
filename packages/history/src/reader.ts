/**
 * Git notes reader
 */

import { execSync } from 'child_process';
import { parse as parseYaml } from 'yaml';
import type { HistoryNote } from './types.js';

const GIT_TIMEOUT = 30000;
const GIT_OPTIONS = {
  encoding: 'utf8' as const,
  timeout: GIT_TIMEOUT,
  stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'],
};

/**
 * Read validation history note for a tree hash
 *
 * @param treeHash - Git tree hash
 * @param notesRef - Git notes ref (default: vibe-validate/runs)
 * @returns History note or null if not found
 */
export async function readHistoryNote(
  treeHash: string,
  notesRef: string = 'vibe-validate/runs'
): Promise<HistoryNote | null> {
  try {
    const yaml = execSync(
      `git notes --ref=${notesRef} show ${treeHash}`,
      GIT_OPTIONS
    );

    const note = parseYaml(yaml) as HistoryNote;
    return note;
  } catch (_error) {
    // Note doesn't exist - this is fine
    return null;
  }
}

/**
 * List all tree hashes with validation history
 *
 * @param notesRef - Git notes ref (default: vibe-validate/runs)
 * @returns Array of tree hashes with notes
 */
export async function listHistoryTreeHashes(
  notesRef: string = 'vibe-validate/runs'
): Promise<string[]> {
  try {
    const output = execSync(`git notes --ref=${notesRef} list`, GIT_OPTIONS);

    if (!output.trim()) {
      return [];
    }

    // Output format: "<note-sha> <tree-hash>"
    const treeHashes = output
      .trim()
      .split('\n')
      .map((line) => {
        const parts = line.split(' ');
        return parts[1]; // tree hash
      })
      .filter(Boolean);

    return treeHashes;
  } catch (_error) {
    // No notes exist yet
    return [];
  }
}

/**
 * Get all validation history notes
 *
 * @param notesRef - Git notes ref (default: vibe-validate/runs)
 * @returns Array of all history notes
 */
export async function getAllHistoryNotes(
  notesRef: string = 'vibe-validate/runs'
): Promise<HistoryNote[]> {
  const treeHashes = await listHistoryTreeHashes(notesRef);
  const notes: HistoryNote[] = [];

  for (const treeHash of treeHashes) {
    const note = await readHistoryNote(treeHash, notesRef);
    if (note) {
      notes.push(note);
    }
  }

  return notes;
}

/**
 * Check if validation history exists for a tree hash
 *
 * @param treeHash - Git tree hash
 * @param notesRef - Git notes ref (default: vibe-validate/runs)
 * @returns True if history exists
 */
export async function hasHistoryForTree(
  treeHash: string,
  notesRef: string = 'vibe-validate/runs'
): Promise<boolean> {
  const note = await readHistoryNote(treeHash, notesRef);
  return note !== null;
}
