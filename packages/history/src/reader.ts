/**
 * Git notes reader
 */

import { parse as parseYaml } from 'yaml';
import { safeValidateResult } from '@vibe-validate/core';
import { listNotes, readNote, type TreeHash, type NotesRef } from '@vibe-validate/git';
import type { HistoryNote } from './types.js';

// Removed: Git operations now use secure @vibe-validate/git functions

/**
 * Read validation history note for a tree hash
 *
 * @param treeHash - Git tree hash
 * @param notesRef - Git notes ref (default: vibe-validate/validate)
 * @returns History note or null if not found
 */
export async function readHistoryNote(
  treeHash: string,
  notesRef: string = 'vibe-validate/validate'
): Promise<HistoryNote | null> {
  try {
    // Use secure readNote function (no command injection risk)
    const yaml = readNote(notesRef as NotesRef, treeHash as TreeHash);

    if (!yaml) {
      return null;
    }

    const parsed = parseYaml(yaml);

    // Validate as HistoryNote structure
    if (!parsed || typeof parsed !== 'object' || !('runs' in parsed) || !Array.isArray(parsed.runs)) {
      console.warn(`Invalid history note structure for ${treeHash} - missing runs array`);
      return null;
    }

    // Validate each ValidationResult in runs array using safe validation
    // Silently skip corrupted entries (e.g., legacy 0/0 line/column from rc.9)
    // After upgrading vibe-validate, run 'vv doctor' to check for issues
    // Users can optionally cleanup old history with: vv history prune --all
    const validatedRuns = [];
    for (const run of parsed.runs) {
      if (!run.result) {
        continue;
      }

      const validationResult = safeValidateResult(run.result);
      if (!validationResult.success) {
        continue;
      }

      validatedRuns.push({
        ...run,
        result: validationResult.data,
      });
    }

    return {
      treeHash: parsed.treeHash ?? treeHash,
      runs: validatedRuns,
    } as HistoryNote;
  } catch {
    // Note doesn't exist - this is expected for first-time validation
    return null;
  }
}

/**
 * List all tree hashes with validation history
 *
 * @param notesRef - Git notes ref (default: vibe-validate/validate)
 * @returns Array of tree hashes with notes
 */
export async function listHistoryTreeHashes(
  notesRef: string = 'vibe-validate/validate'
): Promise<string[]> {
  try {
    // Use secure listNotes function (no command injection risk)
    const notes = listNotes(notesRef as NotesRef);

    if (notes.length === 0) {
      return [];
    }

    // Extract tree hashes from [treeHash, content] pairs
    const treeHashes = notes.map(([treeHash]) => treeHash);

    return treeHashes;
  } catch {
    // No notes exist yet - expected for new repos
    return [];
  }
}

/**
 * Get all validation history notes
 *
 * @param notesRef - Git notes ref (default: vibe-validate/validate)
 * @returns Array of all history notes
 */
export async function getAllHistoryNotes(
  notesRef: string = 'vibe-validate/validate'
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
 * @param notesRef - Git notes ref (default: vibe-validate/validate)
 * @returns True if history exists
 */
export async function hasHistoryForTree(
  treeHash: string,
  notesRef: string = 'vibe-validate/validate'
): Promise<boolean> {
  const note = await readHistoryNote(treeHash, notesRef);
  return note !== null;
}
