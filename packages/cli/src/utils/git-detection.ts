/**
 * Git Detection Utilities
 *
 * Shared utilities for detecting git configuration (main branch, remote origin).
 * Used by both init and doctor commands.
 */

import { join, dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { GIT_DEFAULTS } from '@vibe-validate/config';
import { executeGitCommand, isGitRepository } from '@vibe-validate/git';

/**
 * Find git repository root by walking up directory tree
 *
 * Searches for .git directory starting from startDir and walking up
 * to the root directory. Similar to how findConfigPath() works.
 *
 * This allows doctor and other commands to work correctly from any subdirectory
 * within a project, not just from the repository root.
 *
 * @param startDir Directory to start searching from (defaults to process.cwd())
 * @returns Path to git repository root or null if not found
 *
 * @example
 * ```typescript
 * // From /repo/packages/cli
 * const gitRoot = findGitRoot();
 * // Returns: /repo
 *
 * // From /not-a-repo
 * const gitRoot = findGitRoot();
 * // Returns: null
 * ```
 */
export function findGitRoot(startDir?: string): string | null {
  let currentDir = resolve(startDir ?? process.cwd());
  const root = resolve('/');

  // Walk up directory tree until we find .git or reach root
  while (currentDir !== root) {
    const gitPath = join(currentDir, '.git');
    if (existsSync(gitPath)) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached root (shouldn't happen, but safety check)
      break;
    }
    currentDir = parentDir;
  }

  // Check root directory as final attempt
  const rootGitPath = join(root, '.git');
  if (existsSync(rootGitPath)) {
    return root;
  }

  return null;
}

/**
 * Result of git configuration detection
 */
export interface DetectedGitConfig {
  /** The detected or default main branch name (e.g., 'main', 'master', 'develop') */
  mainBranch: string;
  /** The detected or default remote origin name (e.g., 'origin', 'upstream') */
  remoteOrigin: string;
  /** Whether git configuration was successfully detected (false means defaults were used) */
  detected: boolean;
}

/**
 * Detects git configuration from the current repository.
 *
 * This function attempts to auto-detect the main branch and remote origin
 * by inspecting the git repository. It follows this detection strategy:
 *
 * 1. Check if we're in a git repository
 * 2. Detect available remotes (prefer 'upstream' > 'origin' > first available)
 * 3. Try to detect main branch from remote HEAD reference
 * 4. If remote HEAD is not set, check for common branch names (main > master > develop)
 * 5. Fall back to defaults if detection fails
 *
 * @returns {DetectedGitConfig} The detected or default git configuration
 *
 * @example
 * ```typescript
 * const gitConfig = detectGitConfig();
 * console.log(gitConfig.mainBranch); // 'main'
 * console.log(gitConfig.remoteOrigin); // 'origin'
 * console.log(gitConfig.detected); // true if detected, false if defaults
 * ```
 */
/**
 * Select preferred remote from available remotes
 */
function selectPreferredRemote(remotes: string[]): string {
  if (remotes.includes('upstream')) {
    return 'upstream'; // Forked repo workflow
  }
  if (remotes.includes('origin')) {
    return 'origin'; // Standard workflow
  }
  return remotes[0]; // Use first available
}

/**
 * Detect main branch from remote HEAD
 */
function detectMainBranchFromHead(remote: string): string | null {
  try {
    const result = executeGitCommand(['symbolic-ref', `refs/remotes/${remote}/HEAD`]);
    if (!result.success) {
      return null;
    }
    return result.stdout.trim().replace(`refs/remotes/${remote}/`, '');
  } catch {
    return null;
  }
}

/**
 * Detect main branch from common branch names
 */
function detectMainBranchFromRemote(remote: string): string | null {
  try {
    const result = executeGitCommand(['ls-remote', '--heads', remote]);
    if (!result.success) {
      return null;
    }

    const branches = result.stdout.trim();

    // Check for common main branch names in order of preference
    if (branches.includes('refs/heads/main')) return 'main';
    if (branches.includes('refs/heads/master')) return 'master';
    if (branches.includes('refs/heads/develop')) return 'develop';

    return null;
  } catch {
    return null;
  }
}

export function detectGitConfig(): DetectedGitConfig {
  const defaults = {
    mainBranch: GIT_DEFAULTS.MAIN_BRANCH,
    remoteOrigin: GIT_DEFAULTS.REMOTE_ORIGIN,
    detected: false,
  };

  // Check if we're in a git repository
  if (!isGitRepository()) {
    return defaults;
  }

  try {
    // Get list of remotes
    const result = executeGitCommand(['remote']);
    if (!result.success) {
      return defaults;
    }

    const remotes = result.stdout.trim().split('\n').filter(Boolean);

    if (remotes.length === 0) {
      return defaults;
    }

    const remoteOrigin = selectPreferredRemote(remotes);

    // Try to detect main branch from remote HEAD
    let mainBranch = detectMainBranchFromHead(remoteOrigin);

    // If HEAD not set, try common branch names
    mainBranch ??= detectMainBranchFromRemote(remoteOrigin);

    // Return detected config or defaults
    if (mainBranch) {
      return { mainBranch, remoteOrigin, detected: true };
    }

    return { mainBranch: GIT_DEFAULTS.MAIN_BRANCH, remoteOrigin, detected: false };
  } catch {
    // Failed to detect - use defaults
    return defaults;
  }
}

/**
 * Resolve path relative to git repository root
 *
 * DRY helper for commands that need to find files at git root.
 * Automatically handles git root detection and path joining.
 *
 * @param relativePath - Path relative to git root (e.g., '.github/workflows/validate.yml')
 * @param startDir - Directory to start searching from (defaults to process.cwd())
 * @returns Absolute path or null if not in git repository
 *
 * @example
 * ```typescript
 * const workflowPath = resolveProjectPath('.github/workflows/validate.yml');
 * if (workflowPath && existsSync(workflowPath)) {
 *   // File exists at git root
 * }
 * ```
 */
export function resolveProjectPath(
  relativePath: string,
  startDir?: string
): string | null {
  const gitRoot = findGitRoot(startDir);
  return gitRoot ? join(gitRoot, relativePath) : null;
}

/**
 * Check if file exists relative to git repository root
 *
 * DRY helper that combines git root detection with file existence check.
 * Useful for commands that need to verify files exist at project root.
 *
 * @param relativePath - Path relative to git root
 * @param startDir - Directory to start searching from (defaults to process.cwd())
 * @returns true if file exists, false otherwise (including not in git repo)
 *
 * @example
 * ```typescript
 * if (projectFileExists('.github/workflows/validate.yml')) {
 *   // Workflow file exists at git root
 * }
 * ```
 */
export function projectFileExists(
  relativePath: string,
  startDir?: string
): boolean {
  const absolutePath = resolveProjectPath(relativePath, startDir);
  return absolutePath ? existsSync(absolutePath) : false;
}

/**
 * Read file relative to git repository root
 *
 * DRY helper that combines git root detection with file reading.
 * Useful for commands that need to read config/workflow files at project root.
 *
 * @param relativePath - Path relative to git root
 * @param encoding - File encoding (defaults to 'utf8')
 * @param startDir - Directory to start searching from (defaults to process.cwd())
 * @returns File contents or null if not found or not in git repository
 *
 * @example
 * ```typescript
 * const workflowContent = readProjectFile('.github/workflows/validate.yml');
 * if (workflowContent) {
 *   // Process workflow file
 * }
 * ```
 */
export function readProjectFile(
  relativePath: string,
  encoding: BufferEncoding = 'utf8',
  startDir?: string
): string | null {
  const absolutePath = resolveProjectPath(relativePath, startDir);
  if (!absolutePath || !existsSync(absolutePath)) {
    return null;
  }

  try {
    return readFileSync(absolutePath, encoding);
  } catch {
    return null;
  }
}
