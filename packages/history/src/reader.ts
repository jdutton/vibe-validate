/**
 * Git notes reader
 *
 * Every function here reads VALIDATION_NOTES_REF and nothing else. The ref is not a
 * parameter: a caller that could name it could read the pre-levels ref, whose
 * level-less runs would answer a cache lookup they never covered.
 */

import { listNoteObjects, readNote, type TreeHash, type NotesRef } from '@vibe-validate/git';
import { parse as parseYaml } from 'yaml';

import { VALIDATION_NOTES_REF, ValidationRunSchema } from './schemas.js';
import type { HistoryNote, ValidationRun } from './types.js';

const NOTES_REF = VALIDATION_NOTES_REF as NotesRef;

/**
 * Parse note YAML, falling back to a permissive parse for duplicate keys
 *
 * Strict parsing comes first so corruption is visible (logged warning) while the
 * system keeps working.
 */
function parseNoteYaml(yaml: string): unknown {
  try {
    return parseYaml(yaml);
  } catch (strictError) {
    // Strict parsing failed (e.g., duplicate keys from fan-out concatenation bug).
    const msg = strictError instanceof Error ? strictError.message : String(strictError);
    console.warn(`[vibe-validate] Note has corrupted YAML (using permissive parse): ${msg.slice(0, 120)}`);
    return parseYaml(yaml, { uniqueKeys: false });
  }
}

/**
 * Keep the runs that satisfy ValidationRunSchema, drop the rest
 *
 * A run is dropped, not repaired: `passed: "false"` would read as truthy and a run
 * with no `level` answers no request. Corrupted entries (e.g., legacy 0/0
 * line/column from rc.9) go the same way; `vv history prune --all` clears them.
 */
function validRuns(runs: unknown[]): ValidationRun[] {
  const valid: ValidationRun[] = [];
  for (const run of runs) {
    const parsed = ValidationRunSchema.safeParse(run);
    if (parsed.success) {
      valid.push(parsed.data);
    }
  }
  return valid;
}

/**
 * Read validation history note for a tree hash
 *
 * @param treeHash - Git tree hash
 * @returns History note or null if not found
 */
export async function readHistoryNote(treeHash: string): Promise<HistoryNote | null> {
  try {
    // Use secure readNote function (no command injection risk)
    const yaml = readNote(NOTES_REF, treeHash as TreeHash);

    if (!yaml) {
      return null;
    }

    const parsed = parseNoteYaml(yaml) as Record<string, unknown> | null;

    // Not a HistoryNote (silently ignore old format notes)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.runs)) {
      return null;
    }

    return {
      treeHash: typeof parsed.treeHash === 'string' ? parsed.treeHash : treeHash,
      runs: validRuns(parsed.runs),
    };
  } catch {
    // Note doesn't exist - this is expected for first-time validation
    return null;
  }
}

/**
 * List all tree hashes with validation history
 *
 * @returns Array of tree hashes with notes
 */
export async function listHistoryTreeHashes(): Promise<string[]> {
  try {
    // Use listNoteObjects for O(1) single-spawn listing (no content reading)
    return listNoteObjects(NOTES_REF);
  } catch {
    // No notes exist yet - expected for new repos
    return [];
  }
}

/**
 * Get all validation history notes
 *
 * @returns Array of all history notes
 */
export async function getAllHistoryNotes(): Promise<HistoryNote[]> {
  const treeHashes = await listHistoryTreeHashes();
  const notes: HistoryNote[] = [];

  for (const treeHash of treeHashes) {
    const note = await readHistoryNote(treeHash);
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
 * @returns True if history exists
 */
export async function hasHistoryForTree(treeHash: string): Promise<boolean> {
  const note = await readHistoryNote(treeHash);
  return note !== null;
}
