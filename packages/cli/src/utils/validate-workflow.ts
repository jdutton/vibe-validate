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
import type { AgentContext } from './context-detector.js';
import { createRunnerConfig } from './runner-adapter.js';
import chalk from 'chalk';
import { stringify as yamlStringify } from 'yaml';

export interface ValidateWorkflowOptions {
  force?: boolean;
  verbose?: boolean;
  yaml?: boolean;
  check?: boolean;
  context: AgentContext;
}

/**
 * Wait for stdout to flush before continuing
 *
 * Critical for YAML output when stdout is redirected to a file (CI).
 * Without this, process.exit() can kill the process before the write buffer flushes.
 *
 * @internal
 */
async function flushStdout(): Promise<void> {
  await new Promise<void>(resolve => {
    if (process.stdout.write('')) {
      resolve();
    } else {
      process.stdout.once('drain', resolve);
    }
  });
}

/**
 * Output validation result as YAML
 *
 * @param result - Validation result to output
 * @internal
 */
async function outputYaml(result: unknown): Promise<void> {
  // Small delay to ensure stderr is flushed before writing to stdout
  await new Promise(resolve => setTimeout(resolve, 10));

  // Output YAML document separator (RFC 4627)
  process.stdout.write('---\n');
  process.stdout.write(yamlStringify(result));

  await flushStdout();
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
          await outputYaml(result);
        } else {
          const durationSecs = (passingRun.duration / 1000).toFixed(1);
          console.log(chalk.green('✅ Validation already passed for current working tree'));
          console.log(chalk.gray(`   Tree hash: ${treeHash.substring(0, 12)}...`));
          console.log(chalk.gray(`   Last validated: ${passingRun.timestamp}`));
          console.log(chalk.gray(`   Duration: ${durationSecs}s`));
          console.log(chalk.gray(`   Branch: ${passingRun.branch}`));

          if (passingRun.result.phases) {
            const totalSteps = passingRun.result.phases.reduce((sum, phase) => sum + phase.steps.length, 0);
            console.log(chalk.gray(`   Phases: ${passingRun.result.phases.length}, Steps: ${totalSteps}`));
          }
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

    if (!stability.stable) {
      console.warn(chalk.yellow('\n⚠️  Worktree changed during validation'));
      console.warn(chalk.yellow(`   Before: ${stability.treeHashBefore.slice(0, 12)}...`));
      console.warn(chalk.yellow(`   After:  ${stability.treeHashAfter.slice(0, 12)}...`));
      console.warn(chalk.yellow('   Results valid but history not recorded (unstable state)'));
    } else {
      // Record to git notes
      const recordResult = await recordValidationHistory(treeHashBefore, result);

      if (recordResult.recorded) {
        if (verbose) {
          console.log(chalk.gray(`\n📝 History recorded (tree: ${treeHashBefore.slice(0, 12)})`));
        }
      } else if (verbose) {
        console.warn(chalk.yellow(`⚠️  History recording failed: ${recordResult.reason}`));
      }
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
  if (result.fullLogFile) {
    console.error(chalk.blue('📄 Full log:'), chalk.gray(result.fullLogFile));
  }

  // Context-aware extraction quality feedback (only when developerFeedback is enabled)
  if (config.developerFeedback) {
    const poorExtractionSteps = result.phases
      ?.flatMap(phase => phase.steps)
      .filter(step => !step.passed && step.extraction?.metadata && step.extraction.metadata.confidence < 50);

    if (poorExtractionSteps && poorExtractionSteps.length > 0) {
      const isDogfooding = process.cwd().includes('vibe-validate');

      console.error('');
      console.error(chalk.yellow('⚠️  Poor extraction quality detected'));

      if (isDogfooding) {
        console.error(chalk.yellow('   💡 vibe-validate improvement opportunity: Improve extractors in packages/extractors/'));
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

    // Create runner config
    const runnerConfig = createRunnerConfig(config, {
      force: options.force,
      verbose,
      yaml,
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
    if (treeHashBefore && !options.force) {
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
    }

    // Output YAML validation result if --yaml flag is set
    if (yaml) {
      await outputYaml(result);
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

      await outputYaml(errorResult);
    }

    // Re-throw to allow caller to handle exit
    throw error;
  }
}
