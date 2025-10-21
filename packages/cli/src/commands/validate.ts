/**
 * Validate Command
 *
 * Runs validation phases with git tree hash caching and history recording.
 */

import type { Command } from 'commander';
import { runValidation } from '@vibe-validate/core';
import { getGitTreeHash } from '@vibe-validate/git';
import {
  recordValidationHistory,
  checkWorktreeStability,
  checkHistoryHealth,
} from '@vibe-validate/history';
import { loadConfig } from '../utils/config-loader.js';
import { createRunnerConfig } from '../utils/runner-adapter.js';
import { detectContext } from '../utils/context-detector.js';
import chalk from 'chalk';

export function validateCommand(program: Command): void {
  program
    .command('validate')
    .description('Run validation with git tree hash caching')
    .option('-f, --force', 'Force validation even if already passed')
    .option('-v, --verbose', 'Show detailed progress and output')
    .option('-c, --check', 'Check if validation has already passed (do not run)')
    .action(async (options) => {
      try {
        // Load configuration
        const config = await loadConfig();
        if (!config) {
          console.error(chalk.red('❌ No configuration found'));
          process.exit(1);
        }

        // If --check flag is used, only check validation state without running
        if (options.check) {
          const { checkValidationStatus } = await import('../utils/check-validation.js');
          await checkValidationStatus(config);
          return; // Exit handled by checkValidationStatus
        }

        // Detect context (Claude Code, CI, etc.)
        const context = detectContext();

        // Verbose mode is ONLY enabled via explicit --verbose flag
        const verbose = options.verbose ?? false;

        // Create runner config
        const runnerConfig = createRunnerConfig(config, {
          force: options.force,
          verbose,
          context,
        });

        // Get tree hash BEFORE validation (for stability check)
        let treeHashBefore: string | null = null;
        try {
          treeHashBefore = await getGitTreeHash();
        } catch (_error) {
          // Not in git repo or git command failed - continue without history
          if (verbose) {
            console.warn(chalk.yellow('⚠️  Could not get git tree hash - history recording disabled'));
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
        }

        // Exit with appropriate code
        process.exit(result.passed ? 0 : 1);
      } catch (error) {
        console.error(chalk.red('❌ Validation failed with error:'), error);
        process.exit(1);
      }
    });
}
