/**
 * Git Command Utilities
 *
 * High-level git operations built on top of the secure git-executor.
 * These functions provide convenient access to common git commands.
 */

import { execGitCommand, tryGitCommand } from './git-executor.js';

/**
 * Check if the current directory is inside a git repository
 * @returns true if inside a git repository, false otherwise
 */
export function isGitRepository(): boolean {
  return tryGitCommand(['rev-parse', '--is-inside-work-tree']);
}

/**
 * Get the path to the .git directory
 * @returns The absolute path to the .git directory
 * @throws Error if not in a git repository
 */
export function getGitDir(): string {
  return execGitCommand(['rev-parse', '--git-dir']);
}

/**
 * Get the root directory of the git repository
 * @returns The absolute path to the repository root
 * @throws Error if not in a git repository
 */
export function getRepositoryRoot(): string {
  return execGitCommand(['rev-parse', '--show-toplevel']);
}

/**
 * Get the current branch name
 * @returns The name of the current branch
 * @throws Error if not on a branch (detached HEAD)
 */
export function getCurrentBranch(): string {
  return execGitCommand(['rev-parse', '--abbrev-ref', 'HEAD']);
}

/**
 * Get the commit SHA of HEAD
 * @returns The full SHA of the current commit
 * @throws Error if not in a git repository or HEAD is invalid
 */
export function getHeadCommitSha(): string {
  return execGitCommand(['rev-parse', 'HEAD']);
}

/**
 * Get the tree hash of the current HEAD commit
 * @returns The tree hash of HEAD
 * @throws Error if not in a git repository or HEAD is invalid
 */
export function getHeadTreeSha(): string {
  return execGitCommand(['rev-parse', 'HEAD^{tree}']);
}

/**
 * Verify that a git reference exists
 * @param ref - The reference to verify (branch, tag, commit SHA, etc.)
 * @returns true if the reference exists, false otherwise
 */
export function verifyRef(ref: string): boolean {
  return tryGitCommand(['rev-parse', '--verify', ref]);
}

/**
 * Verify that a git reference exists (alternate form for backwards compatibility)
 * @param ref - The reference to verify
 * @returns The SHA of the reference if it exists
 * @throws Error if the reference doesn't exist
 */
export function verifyRefOrThrow(ref: string): string {
  return execGitCommand(['rev-parse', '--verify', ref]);
}

/**
 * Check if git notes exist for a specific ref
 * @param notesRef - The notes reference to check (e.g., 'refs/notes/vibe-validate/validate')
 * @returns true if the notes ref exists, false otherwise
 */
export function hasNotesRef(notesRef: string): boolean {
  return tryGitCommand(['rev-parse', '--verify', notesRef]);
}
