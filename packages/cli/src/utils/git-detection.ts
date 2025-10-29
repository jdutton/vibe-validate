/**
 * Git Detection Utilities
 *
 * Shared utilities for detecting git configuration (main branch, remote origin).
 * Used by both init and doctor commands.
 */

import { execSync } from 'node:child_process';
import { GIT_DEFAULTS } from '@vibe-validate/config';

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
    const headRef = execSync(`git symbolic-ref refs/remotes/${remote}/HEAD`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    return headRef.replace(`refs/remotes/${remote}/`, '');
  } catch {
    return null;
  }
}

/**
 * Detect main branch from common branch names
 */
function detectMainBranchFromRemote(remote: string): string | null {
  try {
    const branches = execSync(`git ls-remote --heads ${remote}`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

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

  try {
    // Check if we're in a git repository
    execSync('git rev-parse --git-dir', { stdio: 'pipe' });
  } catch {
    // Not a git repository - use defaults
    return defaults;
  }

  try {
    // Get list of remotes
    const remotesOutput = execSync('git remote', { encoding: 'utf8', stdio: 'pipe' }).trim();
    const remotes = remotesOutput.split('\n').filter(Boolean);

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
