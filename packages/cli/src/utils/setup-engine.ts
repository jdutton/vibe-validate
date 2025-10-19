/**
 * Setup Engine - Core types and interfaces for idempotent setup operations
 *
 * This module provides the foundation for focused init modes that can be run
 * independently and repeatedly without side effects.
 *
 * Design principles:
 * - Idempotent: Running a setup check multiple times produces the same result
 * - Composable: Setup checks can be combined and run together
 * - Previewable: All changes can be previewed before applying
 * - Testable: All setup checks are fully unit-testable
 *
 * @example
 * ```typescript
 * const gitignoreCheck = new GitignoreSetupCheck();
 *
 * // Check current state
 * const result = await gitignoreCheck.check();
 * if (!result.passed) {
 *   // Preview changes
 *   const preview = await gitignoreCheck.preview();
 *   console.log(preview.description);
 *
 *   // Apply fix
 *   const fixResult = await gitignoreCheck.fix();
 *   console.log(fixResult.message);
 * }
 * ```
 */

/**
 * Result of a setup check operation
 */
export interface CheckResult {
  /**
   * Whether the check passed (setup is already complete)
   */
  passed: boolean;

  /**
   * Human-readable message describing the check result
   */
  message: string;

  /**
   * Optional suggestion for how to fix the issue (if check failed)
   */
  suggestion?: string;

  /**
   * Optional details about what was found
   */
  details?: Record<string, unknown>;
}

/**
 * Result of a fix operation
 */
export interface FixResult {
  /**
   * Whether the fix was successful
   */
  success: boolean;

  /**
   * Human-readable message describing what was done
   */
  message: string;

  /**
   * List of files that were created or modified
   */
  filesChanged: string[];

  /**
   * Optional error if fix failed
   */
  error?: string;
}

/**
 * Result of a preview operation
 */
export interface PreviewResult {
  /**
   * Human-readable description of changes that would be made
   */
  description: string;

  /**
   * List of files that would be created or modified
   */
  filesAffected: string[];

  /**
   * Optional preview of file contents that would be created/modified
   */
  changes?: Array<{
    file: string;
    action: 'create' | 'modify';
    content?: string;
    diff?: string;
  }>;
}

/**
 * Options for fix operations
 */
export interface FixOptions {
  /**
   * Working directory (defaults to process.cwd())
   */
  cwd?: string;

  /**
   * Whether to force the fix even if check passes
   */
  force?: boolean;

  /**
   * Dry-run mode: preview changes without applying
   */
  dryRun?: boolean;
}

/**
 * Base interface for all setup checks
 *
 * Each setup check represents a specific aspect of the vibe-validate
 * setup that can be verified, previewed, and fixed independently.
 */
export interface SetupCheck {
  /**
   * Unique identifier for this setup check
   */
  readonly id: string;

  /**
   * Human-readable name for this setup check
   */
  readonly name: string;

  /**
   * Check if the setup is complete
   *
   * This operation should be read-only and have no side effects.
   *
   * @param _options - Optional configuration
   * @returns Result indicating whether setup is complete
   */
  check(_options?: FixOptions): Promise<CheckResult>;

  /**
   * Preview what changes would be made by fix()
   *
   * This operation should be read-only and have no side effects.
   *
   * @param _options - Optional configuration
   * @returns Description of changes that would be made
   */
  preview(_options?: FixOptions): Promise<PreviewResult>;

  /**
   * Apply the fix to complete the setup
   *
   * This operation should be idempotent - running it multiple times
   * should produce the same result.
   *
   * @param _options - Optional configuration
   * @returns Result of the fix operation
   */
  fix(_options?: FixOptions): Promise<FixResult>;
}
