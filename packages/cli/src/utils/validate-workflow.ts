/**
 * Shared Validation Workflow
 *
 * Core validation logic used by both validate and pre-commit commands.
 * Handles caching, history recording, and output formatting.
 */

import type { VibeValidateConfig } from '@vibe-validate/config';
import type { ValidationResult } from '@vibe-validate/core';
import { runValidation } from '@vibe-validate/core';
import { getGitTreeHash } from '@vibe-validate/git';
import {
  recordValidationHistory,
  checkWorktreeStability,
  checkHistoryHealth,
  readHistoryNote,
} from '@vibe-validate/history';
import chalk from 'chalk';
import { stringify as yamlStringify } from 'yaml';

import type { AgentContext } from './context-detector.js';
import { displayCachedResult } from './display-cached-result.js';
import { createRunnerConfig } from './runner-adapter.js';
import { outputYamlResult } from './yaml-output.js';

export interface ValidateWorkflowOptions {
  force?: boolean;
  verbose?: boolean;
  yaml?: boolean;
  check?: boolean;
  debug?: boolean;
  context: AgentContext;
}


/**
 * Check cache for passing validation run
 *
 * @param treeHash - Git tree hash to check
 * @param yaml - Whether YAML output mode is enabled
 * @returns Cached result if found, null otherwise
 * @internal
 */
async function checkCache(
  treeHash: string,
  yaml: boolean
): Promise<ValidationResult | null> {
  try {
    const historyNote = await readHistoryNote(treeHash);

    if (historyNote && historyNote.runs.length > 0) {
      // Find most recent passing run
      const passingRun = [...historyNote.runs]
        .reverse()
        .find(run => run.passed);

      if (passingRun) {
        // Mark result as from cache (v0.15.0+ schema field)
        const result = passingRun.result as ValidationResult;
        result.isCachedResult = true;

        if (yaml) {
          await outputYamlResult(result);
        } else {
          displayCachedResult(passingRun, treeHash);
        }

        return result;
      }
    }
  } catch {
    // Cache check failed - proceed with validation
  }

  return null;
}

/**
 * Record validation history with stability check
 *
 * @param treeHashBefore - Tree hash before validation
 * @param result - Validation result to record
 * @param verbose - Whether verbose output is enabled
 * @internal
 */
async function recordHistory(
  treeHashBefore: string,
  result: ValidationResult,
  verbose: boolean
): Promise<void> {
  try {
    // Check if worktree changed during validation
    const stability = await checkWorktreeStability(treeHashBefore);

    if (stability.stable) {
      // Record to git notes
      const recordResult = await recordValidationHistory(treeHashBefore, result);

      if (recordResult.recorded) {
        if (verbose) {
          console.log(chalk.gray(`\n📝 History recorded (tree: ${treeHashBefore.slice(0, 12)})`));
        }
      } else if (verbose) {
        console.warn(chalk.yellow(`⚠️  History recording failed: ${recordResult.reason}`));
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
    let treeHashBefore: string | null = null;
    try {
      treeHashBefore = await getGitTreeHash();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (verbose) {
        console.warn(chalk.yellow(`⚠️  Could not get git tree hash - history recording disabled: ${errorMsg}`));
      }
    }

    // Check cache: if validation already passed for this tree hash, skip re-running
    // Skip cache if --force flag is set OR VV_FORCE_EXECUTION env var is set
    const forceExecution = (options.force ?? false) || process.env.VV_FORCE_EXECUTION === '1';
    if (treeHashBefore && !forceExecution) {
      const cachedResult = await checkCache(treeHashBefore, yaml);
      if (cachedResult) {
        return cachedResult;
      }
    }

    // Display tree hash before running validation
    if (treeHashBefore) {
      console.error(chalk.gray(`🌳 Working tree: ${treeHashBefore.slice(0, 12)}...`));
      if (!yaml) {
        console.log(''); // Blank line for readability (human mode only)
      }
    }

    // Set VV_FORCE_EXECUTION environment variable when --force flag is present
    // This propagates the force flag to nested vv run commands naturally
    if (options.force) {
      process.env.VV_FORCE_EXECUTION = '1';
    }

    // Run validation
    const result = await runValidation(runnerConfig);

    // Record validation history (if in git repo)
    if (treeHashBefore) {
      await recordHistory(treeHashBefore, result, verbose);
    }

    // Proactive health check (non-blocking)
    try {
      const health = await checkHistoryHealth();
      if (health.shouldWarn) {
        console.log('');
        console.log(chalk.blue(health.warningMessage));
      }
    } catch {
      // Silent failure - don't block validation
    }

    // If validation failed, show agent-friendly error details
    if (!result.passed) {
      displayFailureInfo(result, config);

      // Auto-output YAML on failure (to stderr) unless --yaml flag is set (which outputs to stdout)
      if (!yaml) {
        // Small delay to ensure stderr error messages are flushed first
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

    // Output YAML validation result if --yaml flag is set (to stdout)
    if (yaml) {
      await outputYamlResult(result);
    }

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
