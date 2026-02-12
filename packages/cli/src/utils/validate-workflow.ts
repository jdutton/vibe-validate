/**
 * Shared Validation Workflow
 *
 * Core validation logic used by both validate and pre-commit commands.
 * Handles caching, history recording, and output formatting.
 */

import type { VibeValidateConfig } from '@vibe-validate/config';
import type { ValidationResult } from '@vibe-validate/core';
import { runValidation } from '@vibe-validate/core';
import { getGitTreeHash, getRepositoryRoot, type TreeHashResult } from '@vibe-validate/git';
import {
  recordValidationHistory,
  checkWorktreeStability,
  checkHistoryHealth,
  findCachedValidation,
  type ValidationRun,
} from '@vibe-validate/history';
import { runDependencyCheck } from '@vibe-validate/utils';
import chalk from 'chalk';
import { stringify as yamlStringify } from 'yaml';

import type { AgentContext } from './context-detector.js';
import { displayCachedResult } from './display-cached-result.js';
import { formatWorktreeDisplay } from './format-worktree.js';
import { createPerfTimer } from './logger.js';
import { createRunnerConfig } from './runner-adapter.js';
import { outputYamlResult } from './yaml-output.js';

export interface ValidateWorkflowOptions {
  force?: boolean;
  verbose?: boolean;
  yaml?: boolean;
  check?: boolean;
  debug?: boolean;
  context: AgentContext;
  /** Pre-computed tree hash from lock wrapper (avoids redundant computation) */
  treeHashResult?: TreeHashResult;
}

/**
 * Determine if dependency check should run based on configuration and context
 *
 * @param config - Dependency lock check configuration
 * @param isPreCommit - Whether running in pre-commit context
 * @returns True if dependency check should run
 * @internal
 */
function shouldRunDependencyCheck(
  config: NonNullable<VibeValidateConfig['ci']>['dependencyLockCheck'] | undefined,
  isPreCommit: boolean
): boolean {
  if (!config) {
    // Undefined config = implicit 'pre-commit' behavior
    return isPreCommit;
  }

  if (!config.runOn) {
    // Undefined runOn = implicit 'pre-commit' behavior
    return isPreCommit;
  }

  switch (config.runOn) {
    case 'validate':
      return true; // Always run
    case 'pre-commit':
      return isPreCommit; // Only when pre-commit invoked
    case 'disabled':
      return false; // Never run
  }
}

/**
 * Display dependency check skip reason
 *
 * @param linkedPackages - List of linked packages (if npm link detected)
 * @internal
 */
function displayNpmLinkSkipMessage(linkedPackages: string[]): void {
  console.log(chalk.yellow('⚠️  Dependency lock check skipped (npm link detected)'));
  if (linkedPackages.length > 0) {
    console.log(chalk.gray('   Linked packages:'));
    for (const pkg of linkedPackages) {
      console.log(chalk.gray(`   - ${pkg}`));
    }
    console.log(chalk.gray('   To restore normal mode: npm unlink <package> && npm install'));
  }
}

/**
 * Display dependency check failure error
 *
 * @param error - Error message from dependency check
 * @param command - Command that was run
 * @internal
 */
function displayDependencyCheckFailure(error: string | undefined, command: string | undefined): void {
  console.error(chalk.red('❌ Dependency lock check failed'));
  if (error) {
    console.error(chalk.yellow(error));
  }
  console.error(chalk.yellow('\n💡 To fix:'));
  console.error(chalk.gray(`   1. Run: ${command ?? 'npm install'}`));
  console.error(chalk.gray('   2. Commit the updated lock file'));
  console.error(chalk.gray('   3. Try again'));
  console.error(chalk.yellow('\n⚠️  To skip temporarily: VV_SKIP_DEPENDENCY_CHECK=1'));
}

/**
 * Run dependency lock file check before validation
 *
 * @param config - Vibe validate configuration
 * @param verbose - Whether verbose output is enabled
 * @returns Validation result if check failed, null if passed/skipped
 * @internal
 */
async function runDependencyLockCheck(
  config: VibeValidateConfig,
  verbose: boolean
): Promise<ValidationResult | null> {
  let gitRoot: string;
  try {
    gitRoot = getRepositoryRoot();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (verbose) {
      console.warn(chalk.yellow(`⚠️  Could not get repository root - dependency check skipped: ${errorMsg}`));
    }
    return null;
  }

  const depCheckConfig = config.ci?.dependencyLockCheck;
  const depCheckResult = await runDependencyCheck(
    gitRoot,
    {
      packageManager: depCheckConfig?.packageManager ?? config.ci?.packageManager,
      command: depCheckConfig?.command,
    },
    verbose
  );

  // Handle failure
  if (!depCheckResult.passed && !depCheckResult.skipped) {
    displayDependencyCheckFailure(depCheckResult.error, depCheckResult.command);
    return {
      passed: false,
      timestamp: new Date().toISOString(),
      failedStep: 'Dependency Lock Check',
      summary: 'Dependency lock check failed',
      phases: [],
    };
  }

  // Handle skip
  if (depCheckResult.skipped && depCheckResult.skipReason === 'npm-link') {
    displayNpmLinkSkipMessage(depCheckResult.linkedPackages ?? []);
  } else if (depCheckResult.skipped && depCheckResult.skipReason === 'env-var') {
    console.log(chalk.yellow('⚠️  Dependency lock check skipped (VV_SKIP_DEPENDENCY_CHECK set)'));
  }

  return null;
}

/**
 * Check cache for validation run (pass or fail)
 *
 * Returns the most recent validation result for the current tree hash,
 * whether it passed or failed. This enables fast feedback loops without
 * re-running expensive validation steps.
 *
 * Note: This function only returns the cached result without displaying it.
 * Display logic is handled by the caller to avoid duplication.
 *
 * @param treeHash - Git tree hash to check
 * @returns Cached result with metadata if found, null otherwise
 * @internal
 */
async function checkCache(
  treeHashResult: TreeHashResult
): Promise<{ result: ValidationResult; run: ValidationRun } | null> {
  try {
    const cachedRun = await findCachedValidation(treeHashResult);

    if (cachedRun) {
      // Mark result as from cache (v0.15.0+ schema field)
      const result = cachedRun.result as ValidationResult;
      result.isCachedResult = true;

      return { result, run: cachedRun };
    }
  } catch {
    // Cache check failed - proceed with validation
  }

  return null;
}

/**
 * Record validation history with stability check
 *
 * @param treeHashResultBefore - Tree hash result before validation
 * @param result - Validation result to record
 * @param verbose - Whether verbose output is enabled
 * @internal
 */
async function recordHistory(
  treeHashResultBefore: TreeHashResult,
  result: ValidationResult,
  verbose: boolean
): Promise<void> {
  try {
    // Check if worktree changed during validation
    const stability = await checkWorktreeStability(treeHashResultBefore.hash);

    if (stability.stable) {
      // Record to git notes
      const recordResult = await recordValidationHistory(treeHashResultBefore, result);

      if (recordResult.recorded) {
        if (verbose) {
          console.log(chalk.gray(`\n📝 History recorded (tree: ${treeHashResultBefore.hash.slice(0, 12)})`));
        }
      } else {
        // Always warn on stderr when history recording fails (not just in verbose mode)
        console.error(chalk.yellow(`⚠️  History recording failed: ${recordResult.reason ?? 'Unknown reason'}`));
        console.error(chalk.gray(`   Tree hash: ${treeHashResultBefore.hash.slice(0, 12)}`));
      }
    } else {
      console.warn(chalk.yellow('\n⚠️  Worktree changed during validation'));
      console.warn(chalk.yellow(`   Before: ${stability.treeHashBefore.slice(0, 12)}...`));
      console.warn(chalk.yellow(`   After:  ${stability.treeHashAfter.slice(0, 12)}...`));
      console.warn(chalk.yellow('   Results valid but history not recorded (unstable state)'));
    }
  } catch (error) {
    // Silent failure - don't block validation
    if (verbose) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(chalk.yellow(`⚠️  History recording error: ${errorMessage}`));
    }
  }
}

/**
 * Display failure information and extraction quality feedback
 *
 * @param result - Validation result (failed)
 * @param config - Vibe validate configuration
 * @internal
 */
function displayFailureInfo(result: ValidationResult, config: VibeValidateConfig): void {
  console.error(chalk.blue('\n📋 View error details:'), chalk.white('vibe-validate state'));

  // Find the failed step's command (v0.15.0+: rerunCommand removed, use step.command)
  const failedStep = result.phases
    ?.flatMap(phase => phase.steps)
    .find(step => step.name === result.failedStep);

  if (failedStep?.command) {
    console.error(chalk.blue('🔄 To retry:'), chalk.white(failedStep.command));
  }

  // Context-aware extraction quality feedback (only when developerFeedback is enabled)
  if (config.developerFeedback) {
    const poorExtractionSteps = result.phases
      ?.flatMap(phase => phase.steps)
      .filter(step => !step.passed && step.extraction?.metadata && step.extraction.metadata.confidence < 50);

    if (poorExtractionSteps && poorExtractionSteps.length > 0) {
      // VV_CONTEXT is set by the smart wrapper (vibe-validate/vv)
      // 'dev' = developer mode (working on vibe-validate itself)
      const isDevMode = process.env.VV_CONTEXT === 'dev';

      console.error('');
      console.error(chalk.yellow('⚠️  Poor extraction quality detected'));

      if (isDevMode) {
        console.error(chalk.yellow('   💡 Developer mode: Improve extractors in packages/extractors/'));
        console.error(chalk.gray('   See packages/extractors/test/samples/ for how to add test cases'));
      } else {
        console.error(chalk.yellow('   💡 Help improve vibe-validate by reporting this extraction issue'));
        console.error(chalk.gray('   https://github.com/anthropics/vibe-validate/issues/new?template=extractor-improvement.yml'));
      }
    }
  }
}

/**
 * Execute validation workflow with caching, history recording, and output formatting.
 *
 * This is the shared implementation used by both `validate` and `pre-commit` commands.
 *
 * @param config - Loaded vibe-validate configuration
 * @param options - Validation options (force, verbose, yaml, check, context)
 * @returns Validation result
 * @throws Error if validation encounters fatal error
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 27 acceptable for workflow orchestration (down from 81) - coordinates caching, validation, history recording, and output formatting
export async function runValidateWorkflow(
  config: VibeValidateConfig,
  options: ValidateWorkflowOptions
): Promise<ValidationResult> {
  const timer = createPerfTimer('runValidateWorkflow');
  try {
    // If --check flag is used, only check validation state without running
    if (options.check) {
      const yaml = options.yaml ?? false;
      const { checkValidationStatus } = await import('./check-validation.js');
      await checkValidationStatus(config, yaml);
      throw new Error('checkValidationStatus should have exited');
    }

    const verbose = options.verbose ?? false;
    const yaml = options.yaml ?? false;
    const debug = options.debug ?? false;

    // Create runner config
    const runnerConfig = createRunnerConfig(config, {
      force: options.force,
      verbose,
      yaml,
      debug,
      context: options.context,
    });

    // Get tree hash BEFORE validation (for caching and stability check)
    let treeHashResultBefore: TreeHashResult | null = null;
    let treeHashBefore: string | null = null;
    try {
      treeHashResultBefore = options.treeHashResult ?? await getGitTreeHash();
      treeHashBefore = treeHashResultBefore.hash;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (verbose) {
        console.warn(chalk.yellow(`⚠️  Could not get git tree hash - history recording disabled: ${errorMsg}`));
      }
    }
    timer.markWithThreshold('getGitTreeHash', 2000);

    // Check cache: if validation already passed for this tree hash, skip re-running
    // Skip cache if --force flag is set OR VV_FORCE_EXECUTION env var is set
    const forceExecution = (options.force ?? false) || process.env.VV_FORCE_EXECUTION === '1';
    let result: ValidationResult | undefined;
    let cachedRun: ValidationRun | null = null;

    if (treeHashResultBefore && !forceExecution) {
      const cached = await checkCache(treeHashResultBefore);
      if (cached) {
        result = cached.result;
        cachedRun = cached.run;
      }
    }
    timer.mark('cache check');

    if (!result) {
      // Display tree hash before running validation
      if (treeHashResultBefore) {
        console.error(formatWorktreeDisplay(treeHashResultBefore));
        if (!yaml) {
          console.log(''); // Blank line for readability (human mode only)
        }
      }

      // Run dependency check if configured (cache miss only)
      const depCheckConfig = config.ci?.dependencyLockCheck;
      const isPreCommit = options.context.isPreCommit ?? false;

      if (shouldRunDependencyCheck(depCheckConfig, isPreCommit)) {
        const depCheckFailure = await runDependencyLockCheck(config, verbose);
        if (depCheckFailure) {
          // Dependency check failed - return failure result
          return depCheckFailure;
        }
      }

      // Set VV_FORCE_EXECUTION environment variable when --force flag is present
      // This propagates the force flag to nested vv run commands naturally
      if (options.force) {
        process.env.VV_FORCE_EXECUTION = '1';
      }

      // Run validation
      result = await runValidation(runnerConfig);

      // Record validation history (if in git repo)
      if (treeHashResultBefore) {
        await recordHistory(treeHashResultBefore, result, verbose);
      }
    }

    // Proactive health check (now O(1) — 2 git spawns max)
    timer.mark('validation done');
    try {
      const health = await checkHistoryHealth();
      timer.markWithThreshold('checkHistoryHealth', 500);
      if (health.shouldWarn) {
        console.log('');
        console.log(chalk.blue(health.warningMessage));
      }
    } catch {
      // Silent failure - don't block validation
    }

    // Display result (cached or fresh)
    if (yaml) {
      // YAML mode: output structured result to stdout
      await outputYamlResult(result);
    } else {
      // Human-readable mode
      if (cachedRun && treeHashBefore) {
        // Show cached result message
        displayCachedResult(cachedRun, treeHashBefore);
      } else if (!result.passed) {
        // Show failure info for fresh failures
        displayFailureInfo(result, config);
      }

      // Auto-output YAML on failure (cached or fresh) to stderr
      // This ensures agents see error details immediately
      if (!result.passed) {
        // Small delay to ensure human-readable message is flushed first
        await new Promise(resolve => setTimeout(resolve, 10));

        // Output YAML document with separators to stderr
        process.stderr.write('\n---\n');
        const yamlContent = yamlStringify(result);
        process.stderr.write(yamlContent);
        // Write closing YAML document separator (ensure newline before it)
        if (!yamlContent.endsWith('\n')) {
          process.stderr.write('\n');
        }
        process.stderr.write('---\n');
      }
    }

    timer.done();
    return result;
  } catch (error) {
    console.error(chalk.red('❌ Validation failed with error:'), error);

    // If YAML mode, output error as YAML to stdout for CI extraction
    if (options.yaml) {
      const errorResult = {
        passed: false,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      };

      await outputYamlResult(errorResult);
    }

    // Re-throw to allow caller to handle exit
    throw error;
  }
}
