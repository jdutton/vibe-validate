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

  let mainBranch: string = GIT_DEFAULTS.MAIN_BRANCH;
  let remoteOrigin: string = GIT_DEFAULTS.REMOTE_ORIGIN;
  let detected = false;

  // Try to detect main branch from remote HEAD
  try {
    // First, get list of remotes
    const remotesOutput = execSync('git remote', { encoding: 'utf8', stdio: 'pipe' }).trim();
    const remotes = remotesOutput.split('\n').filter(Boolean);

    if (remotes.length > 0) {
      // Prefer 'upstream' if it exists (forked repo workflow), otherwise use first remote
      if (remotes.includes('upstream')) {
        remoteOrigin = 'upstream';
      } else if (remotes.includes('origin')) {
        remoteOrigin = 'origin';
      } else {
        remoteOrigin = remotes[0]; // Use first available remote
      }

      // Try to detect main branch from remote HEAD
      try {
        const headRef = execSync(`git symbolic-ref refs/remotes/${remoteOrigin}/HEAD`, {
          encoding: 'utf8',
          stdio: 'pipe',
        }).trim();
        mainBranch = headRef.replace(`refs/remotes/${remoteOrigin}/`, '');
        detected = true;
      } catch {
        // Remote HEAD not set, try to detect from common branch names
        try {
          const branches = execSync(`git ls-remote --heads ${remoteOrigin}`, {
            encoding: 'utf8',
            stdio: 'pipe',
          }).trim();

          // Check for common main branch names in order of preference
          if (branches.includes('refs/heads/main')) {
            mainBranch = 'main';
            detected = true;
          } else if (branches.includes('refs/heads/master')) {
            mainBranch = 'master';
            detected = true;
          } else if (branches.includes('refs/heads/develop')) {
            mainBranch = 'develop';
            detected = true;
          }
        } catch {
          // Failed to list remote branches - use defaults
        }
      }
    }
  } catch {
    // Failed to detect - use defaults
  }

  return {
    mainBranch,
    remoteOrigin,
    detected,
  };
}
