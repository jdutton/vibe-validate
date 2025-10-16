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
    .option('--format <format>', 'Output format (human|yaml|json|auto)', 'auto')
    .action(async (options) => {
      try {
        // Load configuration
        const config = await loadConfig();
        if (!config) {
          console.error(chalk.red('❌ No configuration found'));
          process.exit(1);
        }

        // Detect context (Claude Code, CI, etc.)
        const context = detectContext();

        // Determine output format
        const format = options.format === 'auto'
          ? (context.isAgent ? 'yaml' : 'human')
          : options.format;

        // Create runner config
        const runnerConfig = createRunnerConfig(config, {
          force: options.force,
          format,
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
