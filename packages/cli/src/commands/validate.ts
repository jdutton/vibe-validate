/**
 * Validate Command
 *
 * Runs validation phases with git tree hash caching.
 */

import type { Command } from 'commander';
import { runValidation } from '@vibe-validate/core';
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

        // Run validation
        const result = await runValidation(runnerConfig);

        // If validation failed, show agent-friendly error details
        if (!result.passed) {
          console.error(chalk.blue('\n📋 Error details:'), chalk.white(runnerConfig.stateFilePath || '.vibe-validate-state.yaml'));
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
