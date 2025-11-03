/**
 * Git notes reader
 */

import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { safeValidateResult } from '@vibe-validate/core';
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
 * @param notesRef - Git notes ref (default: vibe-validate/validate)
 * @returns History note or null if not found
 */
export async function readHistoryNote(
  treeHash: string,
  notesRef: string = 'vibe-validate/validate'
): Promise<HistoryNote | null> {
  try {
    const yaml = execSync(
      `git notes --ref=${notesRef} show ${treeHash}`,
      GIT_OPTIONS
    );

    const parsed = parseYaml(yaml);

    // Validate as HistoryNote structure
    if (!parsed || typeof parsed !== 'object' || !('runs' in parsed) || !Array.isArray(parsed.runs)) {
      console.warn(`Invalid history note structure for ${treeHash} - missing runs array`);
      return null;
    }

    // Validate each ValidationResult in runs array using safe validation
    const validatedRuns = [];
    for (const run of parsed.runs) {
      if (!run.result) {
        console.warn(`Run ${run.id} missing result field - skipping`);
        continue;
      }

      const validationResult = safeValidateResult(run.result);
      if (!validationResult.success) {
        console.warn(`Invalid ValidationResult in run ${run.id}:`, validationResult.errors);
        console.warn('Skipping corrupted run entry');
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
  } catch (error) {
    // No notes exist yet - expected for new repos
    console.debug(`No history notes found: ${error instanceof Error ? error.message : String(error)}`);
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
