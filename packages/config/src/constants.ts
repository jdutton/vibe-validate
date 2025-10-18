/**
 * Git Configuration Constants
 *
 * Single source of truth for all git-related default values.
 * These constants are used throughout the application to ensure consistency.
 *
 * @packageDocumentation
 */

/**
 * Default git configuration values
 *
 * @example
 * ```typescript
 * import { GIT_DEFAULTS } from '@vibe-validate/config';
 *
 * const mainBranch = config.git?.mainBranch ?? GIT_DEFAULTS.MAIN_BRANCH;
 * ```
 */
export const GIT_DEFAULTS = {
  /**
   * Default main branch name
   * Common alternatives: 'master', 'develop'
   */
  MAIN_BRANCH: 'main' as const,

  /**
   * Default remote name
   * Common alternatives: 'upstream' (for forked repositories)
   */
  REMOTE_ORIGIN: 'origin' as const,

  /**
   * Auto-sync with remote (disabled by default for safety)
   */
  AUTO_SYNC: false as const,

  /**
   * Warn if branch is behind remote
   */
  WARN_IF_BEHIND: true as const,
} as const;

export type GitDefaults = typeof GIT_DEFAULTS;
