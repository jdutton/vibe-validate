/**
 * Git Notes Operations
 *
 * High-level abstraction for git notes operations. All notes-related
 * commands in vibe-validate must use these functions.
 *
 * @packageDocumentation
 */

import {
  executeGitCommand,
  tryGitCommand,
  validateNotesRef,
  validateTreeHash,
} from './git-executor.js';
import type { TreeHash, NotesRef } from './types.js';

/**
 * Add or update a git note
 *
 * @param notesRef - The notes reference (e.g., 'vibe-validate/validate')
 * @param object - The git tree hash to attach the note to (must be from getGitTreeHash())
 * @param content - The note content
 * @param force - Whether to overwrite existing note
 * @returns true if note was added successfully
 *
 * @example
 * ```typescript
 * const treeHash = await getGitTreeHash();
 * addNote('vibe-validate/validate', treeHash, noteContent, true);
 * ```
 */
export function addNote(
  notesRef: NotesRef,
  object: TreeHash,
  content: string,
  force: boolean = false
): boolean {
  validateNotesRef(notesRef);
  validateTreeHash(object);

  const args = ['notes', `--ref=${notesRef}`, 'add'];
  if (force) {
    args.push('-f');
  }
  args.push('-F', '-', object);

  const result = executeGitCommand(args, {
    stdin: content,
    ignoreErrors: true,
    suppressStderr: true,
  });

  return result.success;
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
 * List all notes in a notes reference
 *
 * @param notesRef - The notes reference
 * @returns Array of [object, content] pairs, or empty array if no notes
 *
 * @example
 * ```typescript
 * const notes = listNotes('vibe-validate/validate');
 * for (const [treeHash, content] of notes) {
 *   console.log(`${treeHash}: ${content}`);
 * }
 * ```
 */
export function listNotes(notesRef: NotesRef): Array<[TreeHash, string]> {
  validateNotesRef(notesRef);

  // Get list of objects that have notes
  const objectsResult = executeGitCommand(['notes', `--ref=${notesRef}`, 'list'], {
    ignoreErrors: true,
    suppressStderr: true,
  });

  if (!objectsResult.success || !objectsResult.stdout) {
    return [];
  }

  const notes: Array<[TreeHash, string]> = [];

  // Parse "note_sha object_sha" pairs
  for (const line of objectsResult.stdout.split('\n')) {
    const [, objectSha] = line.split(/\s+/);
    if (!objectSha) continue;

    // Read the note content
    const content = readNote(notesRef, objectSha as TreeHash);
    if (content !== null) {
      notes.push([objectSha as TreeHash, content]);
    }
  }

  return notes;
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
  const fullPath = notesPath.startsWith('refs/') ? notesPath : `refs/notes/${notesPath}`;

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
  const fullPath = notesPath.startsWith('refs/') ? notesPath : `refs/notes/${notesPath}`;

  // Security: Only allow deletion under refs/notes/vibe-validate/
  if (!fullPath.startsWith('refs/notes/vibe-validate/')) {
    throw new Error(
      `Refusing to delete refs outside vibe-validate namespace: ${fullPath}`
    );
  }

  // Get list of refs
  const refs = listNotesRefs(fullPath);

  let deleted = 0;
  for (const ref of refs) {
    // Double-check each ref is under the expected namespace
    if (!ref.startsWith('refs/notes/vibe-validate/')) {
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
