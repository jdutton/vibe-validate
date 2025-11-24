/**
 * Git Command Utilities
 *
 * Standardized git command execution with consistent options and error handling.
 * Consolidates scattered git rev-parse usage across packages.
 */

import { execSync } from 'node:child_process';

/**
 * Standard options for git command execution
 */
const GIT_OPTIONS = {
  encoding: 'utf8' as const,
  timeout: 30000, // 30 seconds
  stdio: 'pipe' as const,
} as const;

/**
 * Execute a git command with standard options
 * @param command - The git command to execute
 * @param options - Optional overrides for execution options
 * @returns The command output, trimmed of whitespace
 * @throws Error if the command fails
 */
function execGitCommand(command: string, options?: Partial<typeof GIT_OPTIONS>): string {
  try {
    const result = execSync(command, { ...GIT_OPTIONS, ...options });
    return result.trim();
  } catch (error) {
    throw new Error(`Git command failed: ${command}`, { cause: error });
  }
}

/**
 * Check if the current directory is inside a git repository
 * @returns true if inside a git repository, false otherwise
 */
export function isGitRepository(): boolean {
  try {
    execGitCommand('git rev-parse --is-inside-work-tree');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the path to the .git directory
 * @returns The absolute path to the .git directory
 * @throws Error if not in a git repository
 */
export function getGitDir(): string {
  return execGitCommand('git rev-parse --git-dir');
}

/**
 * Get the root directory of the git repository
 * @returns The absolute path to the repository root
 * @throws Error if not in a git repository
 */
export function getRepositoryRoot(): string {
  return execGitCommand('git rev-parse --show-toplevel');
}

/**
 * Get the current branch name
 * @returns The name of the current branch
 * @throws Error if not on a branch (detached HEAD)
 */
export function getCurrentBranch(): string {
  return execGitCommand('git rev-parse --abbrev-ref HEAD');
}

/**
 * Get the commit SHA of HEAD
 * @returns The full SHA of the current commit
 * @throws Error if not in a git repository or HEAD is invalid
 */
export function getHeadCommitSha(): string {
  return execGitCommand('git rev-parse HEAD');
}

/**
 * Get the tree hash of the current HEAD commit
 * @returns The tree hash of HEAD
 * @throws Error if not in a git repository or HEAD is invalid
 */
export function getHeadTreeSha(): string {
  return execGitCommand('git rev-parse HEAD^{tree}');
}

/**
 * Verify that a git reference exists
 * @param ref - The reference to verify (branch, tag, commit SHA, etc.)
 * @returns true if the reference exists, false otherwise
 */
export function verifyRef(ref: string): boolean {
  try {
    execGitCommand(`git rev-parse --verify ${ref}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify that a git reference exists (alternate form for backwards compatibility)
 * @param ref - The reference to verify
 * @returns The SHA of the reference if it exists
 * @throws Error if the reference doesn't exist
 */
export function verifyRefOrThrow(ref: string): string {
  return execGitCommand(`git rev-parse --verify ${ref}`);
}

/**
 * Check if git notes exist for a specific ref
 * @param notesRef - The notes reference to check (e.g., 'refs/notes/vibe-validate/validate')
 * @returns true if the notes ref exists, false otherwise
 */
export function hasNotesRef(notesRef: string): boolean {
  try {
    // Use || true to prevent error when notes don't exist
    const result = execSync(`git rev-parse --verify ${notesRef} 2>/dev/null || true`, {
      encoding: 'utf8',
      timeout: GIT_OPTIONS.timeout,
    }).trim();
    return result.length > 0;
  } catch {
    return false;
  }
}
