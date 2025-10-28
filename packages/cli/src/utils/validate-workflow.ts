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
 * Execute validation workflow with caching, history recording, and output formatting.
 *
 * This is the shared implementation used by both `validate` and `pre-commit` commands.
 *
 * @param config - Loaded vibe-validate configuration
 * @param options - Validation options (force, verbose, yaml, check, context)
 * @returns Validation result
 * @throws Error if validation encounters fatal error
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 81 acceptable for main validation orchestration function (coordinates caching, validation execution, and result recording in a clear workflow)
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
      // checkValidationStatus calls process.exit, so this line never executes
      // But TypeScript doesn't know that, so we need to satisfy the return type
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
      // Not in git repo or git command failed - continue without history
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (verbose) {
        console.warn(chalk.yellow(`⚠️  Could not get git tree hash - history recording disabled: ${errorMsg}`));
      }
    }

    // Check cache: if validation already passed for this tree hash, skip re-running
    if (treeHashBefore && !options.force) {
      try {
        const historyNote = await readHistoryNote(treeHashBefore);

        if (historyNote && historyNote.runs.length > 0) {
          // Find most recent passing run
          const passingRun = [...historyNote.runs]
            .reverse()
            .find(run => run.passed);

          if (passingRun) {
            if (yaml) {
              // YAML mode: Output cached result as YAML to stdout
              await new Promise(resolve => setTimeout(resolve, 10));

              // Output YAML document separator (RFC 4627)
              process.stdout.write('---\n');

              process.stdout.write(yamlStringify(passingRun.result));

              // Wait for stdout to flush before exiting
              await new Promise<void>(resolve => {
                if (process.stdout.write('')) {
                  resolve();
                } else {
                  process.stdout.once('drain', resolve);
                }
              });
            } else {
              // Human-readable mode: Display cache hit message
              const durationSecs = (passingRun.duration / 1000).toFixed(1);
              console.log(chalk.green('✅ Validation already passed for current working tree'));
              console.log(chalk.gray(`   Tree hash: ${treeHashBefore.substring(0, 12)}...`));
              console.log(chalk.gray(`   Last validated: ${passingRun.timestamp}`));
              console.log(chalk.gray(`   Duration: ${durationSecs}s`));
              console.log(chalk.gray(`   Branch: ${passingRun.branch}`));

              if (passingRun.result.phases) {
                const totalSteps = passingRun.result.phases.reduce((sum, phase) => sum + phase.steps.length, 0);
                console.log(chalk.gray(`   Phases: ${passingRun.result.phases.length}, Steps: ${totalSteps}`));
              }
            }

            // Cache hit - return early without calling process.exit
            // This allows tests to complete without throwing process.exit errors
            // In production, Commander will exit with code 0
            // Mark result as from cache so caller knows not to call process.exit
            const result = passingRun.result as ValidationResult & { _fromCache?: boolean };
            result._fromCache = true;
            return result;
          }
        }
      } catch (error) {
        // Cache check failed - proceed with validation
        // This is expected for first-time validation
        console.debug(`Cache check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Display tree hash before running validation (debugging/transparency aid)
    // This goes to stderr, so it's visible even in YAML mode
    if (treeHashBefore) {
      console.error(chalk.gray(`🌳 Working tree: ${treeHashBefore.slice(0, 12)}...`));
      if (!yaml) {
        console.log(''); // Blank line for readability (human mode only)
      }
    }

    // Run validation
    const result = await runValidation(runnerConfig);

    // Record validation history (if in git repo and stability check passes)
    if (treeHashBefore) {
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
      console.error(chalk.blue('\n📋 View error details:'), chalk.white('vibe-validate state'));
      if (result.rerunCommand) {
        console.error(chalk.blue('🔄 To retry:'), chalk.white(result.rerunCommand));
      }
      if (result.fullLogFile) {
        console.error(chalk.blue('📄 Full log:'), chalk.gray(result.fullLogFile));
      }

      // Context-aware extraction quality feedback (only when developerFeedback is enabled)
      if (config.developerFeedback) {
        // Check if any steps had poor extraction quality
        const poorExtractionSteps = result.phases
          ?.flatMap(phase => phase.steps)
          .filter(step => !step.passed && step.extractionQuality && step.extractionQuality.score < 50);

        if (poorExtractionSteps && poorExtractionSteps.length > 0) {
          // Detect if we're dogfooding (in the vibe-validate project itself)
          const isDogfooding = process.cwd().includes('vibe-validate');

          console.error('');
          console.error(chalk.yellow('⚠️  Poor extraction quality detected'));

          if (isDogfooding) {
            // Developing vibe-validate itself: direct contributor call-to-action
            console.error(chalk.yellow('   💡 vibe-validate improvement opportunity: Improve extractors in packages/extractors/'));
            console.error(chalk.gray('   See packages/extractors/test/samples/ for how to add test cases'));
          } else {
            // External project: user feedback to improve vibe-validate
            console.error(chalk.yellow('   💡 Help improve vibe-validate by reporting this extraction issue'));
            console.error(chalk.gray('   https://github.com/anthropics/vibe-validate/issues/new?template=extractor-improvement.yml'));
          }
        }
      }
    }

    // Output YAML validation result if --yaml flag is set
    if (yaml) {
      // Small delay to ensure stderr is flushed before writing to stdout
      await new Promise(resolve => setTimeout(resolve, 10));

      // Output YAML document separator (RFC 4627) to mark transition from stderr to stdout
      process.stdout.write('---\n');

      // Output pure YAML without headers (workflow provides display framing)
      process.stdout.write(yamlStringify(result));

      // CRITICAL: Wait for stdout to flush before exiting
      // When stdout is redirected to a file (CI), process.exit() can kill the process
      // before the write buffer is flushed, causing truncated output
      await new Promise<void>(resolve => {
        if (process.stdout.write('')) {
          // Write buffer is empty, can exit immediately
          resolve();
        } else {
          // Wait for drain event
          process.stdout.once('drain', resolve);
        }
      });
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

      // Small delay to ensure stderr is flushed before writing to stdout
      await new Promise(resolve => setTimeout(resolve, 10));

      // Output YAML document separator
      process.stdout.write('---\n');
      process.stdout.write(yamlStringify(errorResult));

      // Wait for stdout to flush before exiting
      await new Promise<void>(resolve => {
        if (process.stdout.write('')) {
          resolve();
        } else {
          process.stdout.once('drain', resolve);
        }
      });
    }

    // Re-throw to allow caller to handle exit
    throw error;
  }
}
