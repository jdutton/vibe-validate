/**
 * Validation Lock Wrapper
 *
 * Provides a reusable locking mechanism for validation workflows.
 * Extracts the locking logic from validate.ts to enable consistent
 * lock management across commands (validate, pre-commit, etc.).
 */

import { basename } from 'node:path';

import type { VibeValidateConfig } from '@vibe-validate/config';
import { getGitTreeHash, type TreeHashResult } from '@vibe-validate/git';
import chalk from 'chalk';

import { displayConfigErrors } from './config-error-reporter.js';
import { loadConfigWithErrors, loadConfigWithDir } from './config-loader.js';
import type { AgentContext } from './context-detector.js';
import { detectContext } from './context-detector.js';
import { createPerfTimer } from './logger.js';
import {
  acquireLock,
  checkLock,
  waitForLock,
  type LockOptions,
} from './pid-lock.js';
import { detectProjectId } from './project-id.js';

/**
 * Options for validation lock wrapper
 */
export interface ValidationLockOptions {
  /** Whether locking is enabled (CLI flag override) */
  lockEnabled?: boolean;
  /** Whether to wait for existing locks */
  waitEnabled?: boolean;
  /** Maximum time to wait for lock (seconds) */
  waitTimeout?: number;
  /** Whether in YAML output mode (suppresses display output) */
  yaml?: boolean;
}

/**
 * Context passed to callback
 */
export interface ValidationLockContext {
  /** Loaded configuration */
  config: VibeValidateConfig;
  /** Directory where config was found */
  configDir: string;
  /** Agent context (Claude Code, CI, etc.) */
  context: AgentContext;
  /** Pre-computed tree hash (avoids redundant computation in workflow) */
  treeHashResult?: TreeHashResult;
}

/**
 * Display the result of waiting for validation lock
 *
 * @param timedOut - Whether the wait timed out
 * @param yamlMode - Whether in YAML output mode
 */
function displayWaitResult(timedOut: boolean, yamlMode: boolean): void {
  if (yamlMode) return; // No output in YAML mode

  if (timedOut) {
    console.log(chalk.yellow('⏱️  Wait timed out, proceeding with validation'));
  } else {
    console.log(chalk.green('✓ Background validation completed'));
  }
}

/**
 * Display information about existing validation lock
 *
 * @param existingLock - The existing lock information
 * @param currentTreeHash - Current git tree hash
 * @param yamlMode - Whether in YAML output mode
 */
function displayExistingLockInfo(
  existingLock: { directory: string; treeHash: string; pid: number; startTime: string },
  currentTreeHash: string,
  yamlMode: boolean
): void {
  if (yamlMode) return; // No output in YAML mode

  const isCurrentHash = existingLock.treeHash === currentTreeHash;
  const hashStatus = isCurrentHash
    ? 'same as current'
    : `stale - current is ${currentTreeHash.substring(0, 7)}`;

  const elapsed = Math.floor(
    (Date.now() - new Date(existingLock.startTime).getTime()) / 1000,
  );
  const elapsedStr =
    elapsed < 60
      ? `${elapsed} seconds ago`
      : `${Math.floor(elapsed / 60)} minutes ago`;

  console.log(chalk.yellow('⚠️  Validation already running'));
  console.log(`  Directory: ${existingLock.directory}`);
  console.log(`  Tree Hash: ${existingLock.treeHash.substring(0, 7)} (${hashStatus})`);
  console.log(`  PID: ${existingLock.pid}`);
  console.log(`  Started: ${elapsedStr}`);
}

/**
 * Execute a callback with validation lock management
 *
 * This function handles the complete locking workflow:
 * 1. Load configuration with directory detection
 * 2. Detect agent context
 * 3. Determine lock options from config
 * 4. Wait for existing locks (if enabled)
 * 5. Acquire lock (if enabled)
 * 6. Execute callback with context
 * 7. Release lock in finally block
 *
 * @param options - Lock options
 * @param callback - Function to execute with lock held
 * @returns Result from callback
 *
 * @example
 * ```typescript
 * await withValidationLock(
 *   { lockEnabled: true, waitEnabled: true },
 *   async ({ config, configDir, context }) => {
 *     // Run validation workflow
 *     return runValidateWorkflow(config, options);
 *   }
 * );
 * ```
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 26 acceptable for validation lock wrapper (orchestrates config, context, locking, wait, and acquire logic)
export async function withValidationLock<T>(
  options: ValidationLockOptions,
  callback: (_ctx: ValidationLockContext) => Promise<T>
): Promise<T> {
  let lockRelease: (() => Promise<void>) | null = null;
  const timer = createPerfTimer('withValidationLock');

  try {
    // Load configuration first (needed for lock config)
    // Use loadConfigWithDir to get config directory for locking
    const configResult = await loadConfigWithDir();
    timer.mark('config loaded');
    if (!configResult) {
      // Get detailed error information to distinguish between missing file and validation errors
      const configWithErrors = await loadConfigWithErrors();

      if (configWithErrors.errors && configWithErrors.filePath) {
        // Config file exists but has validation errors
        const fileName = basename(configWithErrors.filePath);
        displayConfigErrors({
          fileName,
          errors: configWithErrors.errors
        });
      } else {
        // Config file doesn't exist
        console.error(chalk.red('❌ No configuration found'));
      }

      process.exit(1);
    }

    const { config, configDir } = configResult;

    // Detect context (Claude Code, CI, etc.)
    const context = detectContext();
    timer.mark('context detected');

    // Determine lock options from config
    const lockConfig = config.locking ?? { enabled: true, concurrencyScope: 'directory' };

    // Determine if locking should be enabled
    let shouldLock = options.lockEnabled ?? true;

    // If config disables locking, override CLI flag
    if (!lockConfig.enabled) {
      shouldLock = false;
    }

    let lockOptions: LockOptions = {};
    if (lockConfig.concurrencyScope === 'project') {
      // Project-scoped locking - need projectId
      const projectId = lockConfig.projectId ?? detectProjectId();
      if (!projectId) {
        console.error(chalk.red('❌ ERROR: concurrencyScope=project but projectId cannot be detected'));
        console.error(chalk.yellow('Solutions:'));
        console.error('  1. Add locking.projectId to vibe-validate.config.yaml');
        console.error('  2. Ensure git remote is configured');
        console.error('  3. Ensure package.json has name field');
        process.exit(1);
      }
      lockOptions = { scope: 'project', projectId };
    } else {
      // Directory-scoped locking (default)
      lockOptions = { scope: 'directory' };
    }

    // Default behavior: wait is enabled (wait for running validation)
    // Users can opt out with waitEnabled: false (--no-wait) for background hooks
    // Waiting is independent of locking:
    // - You can wait for a running validation without acquiring a lock yourself (e.g., --check)
    // - You can skip waiting even if you would acquire a lock (e.g., --no-wait for hooks)
    const shouldWait = options.waitEnabled !== false;
    const yamlMode = options.yaml ?? false;

    // Handle wait mode (default: wait for running validation to complete)
    if (shouldWait) {
      // Use config directory for lock (not process.cwd()) - ensures same lock regardless of invocation directory
      const existingLock = await checkLock(configDir, lockOptions);

      if (existingLock) {
        const waitTimeout = options.waitTimeout ?? 300;

        if (!yamlMode) {
          console.log(chalk.yellow('⏳ Waiting for running validation to complete...'));
          console.log(`  PID: ${existingLock.pid}`);
          console.log(`  Started: ${new Date(existingLock.startTime).toLocaleTimeString()}`);
          console.log(`  Timeout: ${waitTimeout}s`);
        }

        const waitResult = await waitForLock(configDir, waitTimeout, 1000, lockOptions);
        timer.markWithThreshold('waitForLock', 5000);

        displayWaitResult(waitResult.timedOut, yamlMode);
      }
      // If no lock exists, proceed normally
    }

    // Handle lock mode (single-instance execution)
    let treeHashResult: TreeHashResult | undefined;
    if (shouldLock) {
      // Use config directory for lock (not process.cwd()) - ensures same lock regardless of invocation directory
      treeHashResult = await getGitTreeHash();
      timer.markWithThreshold('getGitTreeHash (lock)', 2000);
      const treeHash = treeHashResult.hash;

      const lockResult = await acquireLock(configDir, treeHash, lockOptions);
      timer.mark('acquireLock');

      if (!lockResult.acquired && lockResult.existingLock) {
        // Another validation is already running

        // If --no-wait specified, exit immediately (for background hooks)
        if (!shouldWait) {
          displayExistingLockInfo(lockResult.existingLock, treeHash, yamlMode);
          process.exit(0); // Exit 0 to not trigger errors in hooks
        }

        // If wait is enabled (default), the wait logic above already handled it
        // Just don't try to acquire lock again
      } else if (lockResult.release) {
        // Lock acquired successfully - store release function
        lockRelease = lockResult.release;
      }
    }

    // Execute callback with context (pass pre-computed tree hash to avoid redundant computation)
    const result = await callback({ config, configDir, context, treeHashResult });
    timer.mark('callback done');
    return result;
  } finally {
    // Always release lock when done
    if (lockRelease) {
      await lockRelease();
    }
    timer.done();
  }
}
