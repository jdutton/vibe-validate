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
 * Git tree entry for mktree
 */
interface TreeEntry {
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  name: string;
}

/**
 * Create a blob from content using git hash-object
 *
 * @param content - The content to store as a blob
 * @returns The blob SHA
 */
function createBlob(content: string): string {
  const result = executeGitCommand(['hash-object', '-w', '--stdin'], {
    stdin: content,
  });
  return result.stdout;
}

/**
 * Read tree entries from a commit
 *
 * @param commitSha - The commit SHA to read the tree from
 * @returns Array of tree entries
 */
function readTreeEntries(commitSha: string): TreeEntry[] {
  const result = executeGitCommand(['ls-tree', commitSha], {
    ignoreErrors: true,
  });

  if (!result.success || !result.stdout) {
    return [];
  }

  const entries: TreeEntry[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line) continue;

    // Format: "MODE TYPE SHA\tNAME" (note: TAB before name, not space)
    // Use split to avoid backtracking regex issues
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;

    const mode = parts[0];
    const type = parts[1];
    const sha = parts[2];
    // Name may contain spaces, so join the rest
    const name = parts.slice(3).join(' ');

    // Validate format
    if (!/^\d+$/.test(mode)) continue;
    if (type !== 'blob' && type !== 'tree') continue;
    if (!/^[0-9a-f]+$/.test(sha)) continue;

    entries.push({
      mode,
      type,
      sha,
      name,
    });
  }

  return entries;
}

/**
 * Create a tree from entries using git mktree
 *
 * @param entries - Array of tree entries
 * @returns The tree SHA
 */
function createTree(entries: TreeEntry[]): string {
  // Format for mktree: "MODE TYPE SHA\tNAME"
  const input = entries
    .map((e) => `${e.mode} ${e.type} ${e.sha}\t${e.name}`)
    .join('\n');

  const result = executeGitCommand(['mktree'], {
    stdin: input,
  });

  return result.stdout;
}

/**
 * Create a notes commit using git commit-tree
 *
 * @param treeSha - The tree SHA
 * @param parentSha - The parent commit SHA (or null for first commit)
 * @param message - Commit message
 * @returns The commit SHA
 */
function createNotesCommit(
  treeSha: string,
  parentSha: string | null,
  message: string
): string {
  const args = ['commit-tree', treeSha, '-m', message];
  if (parentSha) {
    args.push('-p', parentSha);
  }

  const result = executeGitCommand(args);
  return result.stdout;
}

/**
 * Atomically update a ref using compare-and-swap
 *
 * @param ref - The ref to update (e.g., 'refs/notes/vibe-validate/validate')
 * @param newSha - The new commit SHA
 * @param oldSha - The expected current commit SHA (or null for new ref)
 * @returns true if update succeeded, false if ref changed (CAS failure)
 */
function atomicUpdateRef(ref: string, newSha: string, oldSha: string | null): boolean {
  const args = ['update-ref', ref, newSha];
  if (oldSha) {
    args.push(oldSha);
  }

  const result = executeGitCommand(args, {
    ignoreErrors: true,
    suppressStderr: true,
  });

  return result.success;
}

/**
 * Attempt atomic merge of a note (single retry attempt)
 *
 * @param notesRef - The notes reference
 * @param fullRef - The full ref path (refs/notes/...)
 * @param object - The object to attach the note to
 * @param content - The new note content to merge
 * @returns true if merge succeeded, false if CAS failed or error occurred
 */
function attemptAtomicMerge(
  notesRef: NotesRef,
  fullRef: string,
  object: TreeHash,
  content: string
): boolean {
  // Step 1: Get current notes ref commit SHA (snapshot for compare-and-swap)
  const currentCommitSha = getNotesRefSha(notesRef);
  if (!currentCommitSha) {
    return false; // Ref disappeared (benign race condition)
  }

  // Step 2: Read existing note and merge
  const existingNote = readNote(notesRef, object);
  if (existingNote === null) {
    return false; // Note disappeared (benign race condition)
  }

  const merged = mergeNotes(existingNote, content);

  // Step 3: Build new notes commit atomically
  try {
    // Read current tree entries
    const entries = readTreeEntries(currentCommitSha);

    // Create blob with merged content
    const blobSha = createBlob(merged);

    // Update or add entry for this object
    const existingEntryIndex = entries.findIndex((e) => e.name === object);
    const newEntry: TreeEntry = {
      mode: '100644',
      type: 'blob',
      sha: blobSha,
      name: object,
    };

    if (existingEntryIndex >= 0) {
      entries[existingEntryIndex] = newEntry;
    } else {
      entries.push(newEntry);
    }

    // Create new tree
    const treeSha = createTree(entries);

    // Create new commit
    const commitSha = createNotesCommit(
      treeSha,
      currentCommitSha,
      'Notes added by vibe-validate'
    );

    // Step 4: Atomically update ref (compare-and-swap)
    return atomicUpdateRef(fullRef, commitSha, currentCommitSha);
  } catch {
    return false; // Git plumbing operation failed (will retry)
  }
}

/**
 * Merge two git notes containing validation run history
 *
 * Strategy: Parse both notes as YAML, append new runs to existing runs.
 * No conflict resolution needed - each run is independent and timestamped.
 *
 * @param existingNote - Existing note content (YAML)
 * @param newNote - New note content to merge (YAML)
 * @returns Merged note content
 */
function mergeNotes(existingNote: string, newNote: string): string {
  try {
    const existing = parseYaml(existingNote);
    const newData = parseYaml(newNote);

    // Extract runs arrays (handle both single object and array formats)
    const existingRuns = Array.isArray(existing.runs) ? existing.runs : [];
    const newRuns = Array.isArray(newData.runs) ? newData.runs : [];

    // Merge: append new runs to existing
    const merged = {
      ...existing,
      runs: [...existingRuns, ...newRuns],
    };

    return stringifyYaml(merged);
  } catch {
    // If parsing fails, prefer new note (latest data)
    return newNote;
  }
}

/**
 * Add or update a git note with atomic compare-and-swap
 *
 * Implements atomic optimistic locking using git plumbing commands.
 * When a conflict is detected:
 * 1. Read the current notes ref commit SHA (snapshot)
 * 2. Read and merge the existing note
 * 3. Build a new notes commit with merged content
 * 4. Atomically update the ref only if it hasn't changed (compare-and-swap)
 * 5. If ref changed, retry from step 1
 *
 * This prevents data loss when multiple worktrees validate simultaneously.
 *
 * @param notesRef - The notes reference (e.g., 'vibe-validate/validate')
 * @param object - The git tree hash to attach the note to (must be from getGitTreeHash())
 * @param content - The note content
 * @param force - Whether to skip optimistic locking and force overwrite
 * @returns true if note was added successfully
 *
 * @example
 * ```typescript
 * const treeHash = await getGitTreeHash();
 * addNote('vibe-validate/validate', treeHash, noteContent, false);
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

  // Convert short ref to full ref
  const fullRef = notesRef.startsWith('refs/')
    ? notesRef
    : `refs/notes/${notesRef}`;

  // If force is true, skip optimistic locking (legacy behavior)
  if (force) {
    const args = ['notes', `--ref=${notesRef}`, 'add', '-f', '-F', '-', object];
    const result = executeGitCommand(args, {
      stdin: content,
      ignoreErrors: true,
      suppressStderr: true,
    });
    return result.success;
  }

  // Fast path: Try to add note without force (for new notes)
  const addResult = executeGitCommand(
    ['notes', `--ref=${notesRef}`, 'add', '-F', '-', object],
    {
      stdin: content,
      ignoreErrors: true,
      suppressStderr: true,
    }
  );

  if (addResult.success) {
    return true; // Success! Note didn't exist, added cleanly
  }

  // Fast path failed - assume conflict and try atomic merge
  // No need to parse stderr strings (fragile, locale-dependent, breaks across git versions)
  // The atomic merge will fail safely if it's not actually a conflict

  // Try atomic merge path with retry
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const success = attemptAtomicMerge(notesRef, fullRef, object, content);

    if (success) {
      // Success! Log for debugging if we had to retry (indicates concurrent writes)
      if (attempt > 1) {
        console.error(`[vibe-validate] Atomic merge succeeded on attempt ${attempt}/${maxRetries}`);
      }
      return true;
    }

    // Failed - retry if not last attempt
    if (attempt === maxRetries) {
      // All retries exhausted - log for debugging
      console.error(`[vibe-validate] Atomic merge failed after ${maxRetries} attempts for ${object.slice(0, 12)}`);
      return false;
    }
  }

  return false;
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
