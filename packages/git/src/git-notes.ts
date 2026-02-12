/**
 * Git Notes Operations
 *
 * High-level abstraction for git notes operations. All notes-related
 * commands in vibe-validate must use these functions.
 *
 * @packageDocumentation
 */

import { toForwardSlash } from '@vibe-validate/utils';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import {
  executeGitCommand,
  tryGitCommand,
  validateNotesRef,
  validateTreeHash,
} from './git-executor.js';
import type { TreeHash, NotesRef } from './types.js';

/**
 * Strategy for merging note content when a note already exists.
 *
 * Pure function: given existing note content and incoming content, produce merged output.
 * Each strategy is independently testable.
 */
export type NoteMergeStrategy = (existing: string, incoming: string) => string;

/**
 * Merge strategy: replace existing note entirely with incoming content.
 *
 * Used by run cache where each entry is deterministic (same tree + command = same result).
 */
export const mergeReplace: NoteMergeStrategy = (_existing, incoming) => incoming;

/**
 * Merge strategy: append runs arrays from both notes, new fields win.
 *
 * Used by validation history where multiple runs accumulate per tree hash.
 * Parses YAML with `uniqueKeys: false` to tolerate corrupted notes with duplicate keys.
 *
 * @example
 * ```typescript
 * // Existing note has run-1, incoming has run-2 → merged has both
 * const merged = mergeAppendRuns(existingYaml, incomingYaml);
 * ```
 */
export const mergeAppendRuns: NoteMergeStrategy = (existing, incoming) => {
  try {
    const existingData = parseYaml(existing, { uniqueKeys: false });
    const newData = parseYaml(incoming, { uniqueKeys: false });

    const existingRuns = Array.isArray(existingData?.runs) ? existingData.runs : [];
    const newRuns = Array.isArray(newData?.runs) ? newData.runs : [];

    const merged: Record<string, unknown> = {
      ...existingData,
      ...newData,
    };

    // Only include runs when at least one side has them (avoids spurious runs: [] on cache notes)
    if (existingRuns.length > 0 || newRuns.length > 0) {
      merged.runs = [...existingRuns, ...newRuns];
    }

    return stringifyYaml(merged);
  } catch {
    // If parsing fails, prefer new note (latest data)
    return incoming;
  }
};

/**
 * Attempt to merge an existing note with new content
 *
 * Uses `git notes add -f` for the write, which correctly handles
 * git notes fan-out (2-character subdirectories).
 *
 * @param notesRef - The notes reference
 * @param object - The object to attach the note to
 * @param content - The new note content to merge
 * @param merge - The merge strategy to apply
 * @returns true if merge succeeded, false on error
 */
function attemptMerge(
  notesRef: NotesRef,
  object: TreeHash,
  content: string,
  merge: NoteMergeStrategy = mergeAppendRuns
): boolean {
  // Step 1: Read existing note
  const existingNote = readNote(notesRef, object);
  if (existingNote === null) {
    return false; // Note disappeared (benign race condition)
  }

  // Step 2: Apply merge strategy
  const merged = merge(existingNote, content);

  // Step 3: Force-write merged content (git handles fan-out correctly)
  const result = executeGitCommand(
    ['notes', `--ref=${notesRef}`, 'add', '-f', '-F', '-', object],
    {
      stdin: merged,
      ignoreErrors: true,
      suppressStderr: true,
    }
  );

  return result.success;
}

/**
 * Add or update a git note
 *
 * One code path for all callers:
 * 1. Try `git notes add` (fast path for new notes — no merge needed)
 * 2. If note exists: read → apply merge strategy → `git notes add -f`
 *
 * The merge strategy controls what happens when a note already exists.
 * Default is `mergeReplace` (incoming content wins). Use `mergeAppendRuns`
 * for validation history where runs accumulate per tree hash.
 *
 * Note: There is a small TOCTOU window between read and force-write.
 * This is acceptable for history/cache data.
 *
 * @param notesRef - The notes reference (e.g., 'vibe-validate/validate')
 * @param object - The git tree hash to attach the note to (must be from getGitTreeHash())
 * @param content - The note content
 * @param merge - Strategy for merging with existing note (default: mergeReplace)
 * @returns true if note was added successfully
 *
 * @example
 * ```typescript
 * // Run cache: replace existing (default)
 * addNote('vibe-validate/run/abc/key', treeHash, cacheYaml);
 *
 * // Validation history: append runs
 * addNote('vibe-validate/validate', treeHash, historyYaml, mergeAppendRuns);
 * ```
 */
export function addNote(
  notesRef: NotesRef,
  object: TreeHash,
  content: string,
  merge: NoteMergeStrategy = mergeReplace
): boolean {
  validateNotesRef(notesRef);
  validateTreeHash(object);

  // Fast path: Try to add note (works for new notes — no merge needed)
  const addResult = executeGitCommand(
    ['notes', `--ref=${notesRef}`, 'add', '-F', '-', object],
    {
      stdin: content,
      ignoreErrors: true,
      suppressStderr: true,
    }
  );

  if (addResult.success) {
    return true; // Note didn't exist, added cleanly
  }

  // Note exists — read, apply merge strategy, force-write
  return attemptMerge(notesRef, object, content, merge);
}

/**
 * Read a git note
 *
 * @param notesRef - The notes reference
 * @param object - The git tree hash to read the note from (must be from getGitTreeHash())
 * @returns The note content, or null if no note exists
 *
 * @example
 * ```typescript
 * const treeHash = await getGitTreeHash();
 * const note = readNote('vibe-validate/validate', treeHash);
 * if (note) {
 *   console.log('Note content:', note);
 * }
 * ```
 */
export function readNote(notesRef: NotesRef, object: TreeHash): string | null {
  validateNotesRef(notesRef);
  validateTreeHash(object);

  const result = executeGitCommand(['notes', `--ref=${notesRef}`, 'show', object], {
    ignoreErrors: true,
    suppressStderr: true,
  });

  return result.success ? result.stdout : null;
}

/**
 * Remove a git note
 *
 * @param notesRef - The notes reference
 * @param object - The git tree hash to remove the note from (must be from getGitTreeHash())
 * @returns true if note was removed, false if it didn't exist
 *
 * @example
 * ```typescript
 * const treeHash = await getGitTreeHash();
 * const removed = removeNote('vibe-validate/validate', treeHash);
 * console.log(removed ? 'Removed' : 'Did not exist');
 * ```
 */
export function removeNote(notesRef: NotesRef, object: TreeHash): boolean {
  validateNotesRef(notesRef);
  validateTreeHash(object);

  return tryGitCommand(['notes', `--ref=${notesRef}`, 'remove', object], {
    suppressStderr: true,
  });
}

/**
 * List all note object hashes in a notes reference (O(1) - single git spawn)
 *
 * Returns only the object hashes that have notes attached, without reading
 * any note content. Use readNote() to read individual note content when needed.
 *
 * @param notesRef - The notes reference
 * @returns Array of tree hashes that have notes, or empty array if no notes
 *
 * @example
 * ```typescript
 * const hashes = listNoteObjects('vibe-validate/validate');
 * console.log(`${hashes.length} notes exist`);
 * ```
 */
export function listNoteObjects(notesRef: NotesRef): TreeHash[] {
  validateNotesRef(notesRef);

  const objectsResult = executeGitCommand(['notes', `--ref=${notesRef}`, 'list'], {
    ignoreErrors: true,
    suppressStderr: true,
  });

  if (!objectsResult.success || !objectsResult.stdout) {
    return [];
  }

  const objects: TreeHash[] = [];

  for (const line of objectsResult.stdout.split('\n')) {
    const [, objectSha] = line.split(/\s+/);
    if (!objectSha) continue;
    objects.push(objectSha as TreeHash);
  }

  return objects;
}

/**
 * Check if a note exists
 *
 * @param notesRef - The notes reference
 * @param object - The git tree hash to check
 * @returns true if note exists, false otherwise
 *
 * @example
 * ```typescript
 * const treeHash = await getGitTreeHash();
 * if (hasNote('vibe-validate/validate', treeHash)) {
 *   console.log('Note exists');
 * }
 * ```
 */
export function hasNote(notesRef: NotesRef, object: TreeHash): boolean {
  validateNotesRef(notesRef);
  validateTreeHash(object);

  return tryGitCommand(['notes', `--ref=${notesRef}`, 'show', object], {
    suppressStderr: true,
  });
}

/**
 * List all refs under a notes namespace
 *
 * This is useful for finding all notes under a particular path,
 * such as all run cache entries under refs/notes/vibe-validate/run/
 *
 * @param notesPath - The notes path (e.g., 'refs/notes/vibe-validate/run')
 * @returns Array of full ref names
 *
 * @example
 * ```typescript
 * const refs = listNotesRefs('refs/notes/vibe-validate/run');
 * for (const ref of refs) {
 *   console.log('Found note ref:', ref);
 * }
 * ```
 */
export function listNotesRefs(notesPath: string): string[] {
  // Normalize path
  const fullPath = toForwardSlash(notesPath).startsWith('refs/') ? notesPath : `refs/notes/${notesPath}`;

  const result = executeGitCommand(
    ['for-each-ref', '--format=%(refname)', fullPath],
    { ignoreErrors: true, suppressStderr: true }
  );

  if (!result.success || !result.stdout) {
    return [];
  }

  return result.stdout.split('\n').filter(Boolean);
}

/**
 * Remove all notes refs under a namespace
 *
 * This is used for bulk cleanup operations, such as pruning all
 * run cache entries under a tree hash.
 *
 * SECURITY: This function validates each ref before deletion to prevent
 * accidental deletion of non-notes refs.
 *
 * @param notesPath - The notes path (e.g., 'refs/notes/vibe-validate/run/abc123')
 * @returns Number of refs deleted
 *
 * @example
 * ```typescript
 * const deleted = removeNotesRefs('refs/notes/vibe-validate/run/abc123');
 * console.log(`Deleted ${deleted} refs`);
 * ```
 */
export function removeNotesRefs(notesPath: string): number {
  // Normalize path
  const fullPath = toForwardSlash(notesPath).startsWith('refs/') ? notesPath : `refs/notes/${notesPath}`;

  // Security: Only allow deletion under refs/notes/vibe-validate/
  if (!toForwardSlash(fullPath).startsWith('refs/notes/vibe-validate/')) {
    throw new Error(
      `Refusing to delete refs outside vibe-validate namespace: ${fullPath}`
    );
  }

  // Get list of refs
  const refs = listNotesRefs(fullPath);

  let deleted = 0;
  for (const ref of refs) {
    // Double-check each ref is under the expected namespace
    if (!toForwardSlash(ref).startsWith('refs/notes/vibe-validate/')) {
      console.warn(`Skipping ref outside vibe-validate namespace: ${ref}`);
      continue;
    }

    const success = tryGitCommand(['update-ref', '-d', ref], {
      suppressStderr: true,
    });

    if (success) {
      deleted++;
    }
  }

  return deleted;
}

/**
 * Check if a notes ref exists
 *
 * @param notesRef - The notes reference
 * @returns true if the notes ref exists, false otherwise
 *
 * @example
 * ```typescript
 * if (hasNotesRef('vibe-validate/validate')) {
 *   console.log('Notes ref exists');
 * }
 * ```
 */
export function hasNotesRef(notesRef: string): boolean {
  validateNotesRef(notesRef);

  // Convert short form to full form if needed
  const fullRef = notesRef.startsWith('refs/')
    ? notesRef
    : `refs/notes/${notesRef}`;

  return tryGitCommand(['rev-parse', '--verify', fullRef], {
    suppressStderr: true,
  });
}

/**
 * Get the commit SHA that a notes ref points to
 *
 * @param notesRef - The notes reference
 * @returns The commit SHA, or null if ref doesn't exist
 */
export function getNotesRefSha(notesRef: string): string | null {
  validateNotesRef(notesRef);

  const fullRef = notesRef.startsWith('refs/')
    ? notesRef
    : `refs/notes/${notesRef}`;

  const result = executeGitCommand(['rev-parse', '--verify', fullRef], {
    ignoreErrors: true,
    suppressStderr: true,
  });

  return result.success ? result.stdout : null;
}
