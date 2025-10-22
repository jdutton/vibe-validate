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
  readHistoryNote,
} from '@vibe-validate/history';
import { loadConfig } from '../utils/config-loader.js';
import { createRunnerConfig } from '../utils/runner-adapter.js';
import { detectContext } from '../utils/context-detector.js';
import chalk from 'chalk';
import { stringify as yamlStringify } from 'yaml';

export function validateCommand(program: Command): void {
  program
    .command('validate')
    .description('Run validation with git tree hash caching')
    .option('-f, --force', 'Force validation even if already passed')
    .option('-v, --verbose', 'Show detailed progress and output')
    .option('-y, --yaml', 'Output validation result as YAML to stdout')
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
        const yaml = options.yaml ?? false;

        // Create runner config
        const runnerConfig = createRunnerConfig(config, {
          force: options.force,
          verbose,
          yaml,
          context,
        });

        // Get tree hash BEFORE validation (for caching and stability check)
        let treeHashBefore: string | null = null;
        try {
          treeHashBefore = await getGitTreeHash();
        } catch (_error) {
          // Not in git repo or git command failed - continue without history
          if (verbose) {
            console.warn(chalk.yellow('⚠️  Could not get git tree hash - history recording disabled'));
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
                // When yaml mode is on, write to stderr to keep stdout clean
                const log = yaml ? process.stderr.write.bind(process.stderr) : console.log.bind(console);
                log(chalk.green('✅ Validation already passed for current working tree state') + '\n');
                log(chalk.gray(`   Tree hash: ${treeHashBefore.slice(0, 12)}...`) + '\n');
                log(chalk.gray(`   Last validated: ${passingRun.timestamp}`) + '\n');
                log(chalk.gray(`   Duration: ${passingRun.duration}ms`) + '\n');
                log(chalk.gray(`   Branch: ${passingRun.branch}`) + '\n');

                // Return cached result (construct from history note)
                process.exit(0);
              }
            }
          } catch (_error) {
            // Cache check failed - proceed with validation
            // This is expected for first-time validation
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

        // Output YAML validation result if --yaml flag is set
        if (yaml) {
          // Small delay to ensure stderr is flushed before writing to stdout
          await new Promise(resolve => setTimeout(resolve, 10));

          process.stdout.write('==========================================\n');
          process.stdout.write('VALIDATION RESULT\n');
          process.stdout.write('==========================================\n');
          process.stdout.write(yamlStringify(result));
          process.stdout.write('==========================================\n');
        }

        // Exit with appropriate code
        process.exit(result.passed ? 0 : 1);
      } catch (error) {
        console.error(chalk.red('❌ Validation failed with error:'), error);
        process.exit(1);
      }
    });
}
