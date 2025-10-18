/**
 * Git Configuration Helper Functions
 *
 * Centralized utilities for working with git configuration.
 * These functions provide defaults and construct git references consistently.
 *
 * @packageDocumentation
 */

import type { GitConfig } from './schema.js';
import { GIT_DEFAULTS } from './constants.js';

/**
 * Construct remote branch reference from git config
 *
 * @param config - Git configuration (optional)
 * @returns Remote branch reference (e.g., "origin/main", "upstream/develop")
 *
 * @example
 * ```typescript
 * // Uses defaults
 * getRemoteBranch()
 * // Returns: "origin/main"
 *
 * // Custom configuration
 * getRemoteBranch({ mainBranch: 'develop', remoteOrigin: 'upstream' })
 * // Returns: "upstream/develop"
 *
 * // Partial configuration (uses defaults for missing values)
 * getRemoteBranch({ mainBranch: 'master' })
 * // Returns: "origin/master"
 * ```
 */
export function getRemoteBranch(config?: Partial<GitConfig>): string {
  const mainBranch = config?.mainBranch ?? GIT_DEFAULTS.MAIN_BRANCH;
  const remoteOrigin = config?.remoteOrigin ?? GIT_DEFAULTS.REMOTE_ORIGIN;
  return `${remoteOrigin}/${mainBranch}`;
}

/**
 * Get main branch name with fallback to default
 *
 * @param config - Git configuration (optional)
 * @returns Main branch name
 *
 * @example
 * ```typescript
 * getMainBranch({ mainBranch: 'develop' })
 * // Returns: "develop"
 *
 * getMainBranch()
 * // Returns: "main"
 * ```
 */
export function getMainBranch(config?: Partial<GitConfig>): string {
  return config?.mainBranch ?? GIT_DEFAULTS.MAIN_BRANCH;
}

/**
 * Get remote origin name with fallback to default
 *
 * @param config - Git configuration (optional)
 * @returns Remote origin name
 *
 * @example
 * ```typescript
 * getRemoteOrigin({ remoteOrigin: 'upstream' })
 * // Returns: "upstream"
 *
 * getRemoteOrigin()
 * // Returns: "origin"
 * ```
 */
export function getRemoteOrigin(config?: Partial<GitConfig>): string {
  return config?.remoteOrigin ?? GIT_DEFAULTS.REMOTE_ORIGIN;
}
