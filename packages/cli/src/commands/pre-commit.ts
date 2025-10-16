/**
 * Pre-Commit Command
 *
 * Runs branch sync check + validation before allowing commit.
 * This is the recommended workflow before committing code.
 */

import type { Command } from 'commander';
import { runValidation } from '@vibe-validate/core';
import { checkBranchSync } from '@vibe-validate/git';
import { loadConfig } from '../utils/config-loader.js';
import { createRunnerConfig } from '../utils/runner-adapter.js';
import { detectContext } from '../utils/context-detector.js';
import chalk from 'chalk';

export function preCommitCommand(program: Command): void {
  program
    .command('pre-commit')
    .description('Run branch sync check + validation (recommended before commit)')
    .option('--skip-sync', 'Skip branch sync check')
    .option('--format <format>', 'Output format (human|yaml|json|auto)', 'auto')
    .action(async (options) => {
      try {
        // Step 1: Check branch sync (unless skipped)
        if (!options.skipSync) {
          console.log(chalk.blue('🔄 Checking branch sync with origin/main...'));

          const syncResult = await checkBranchSync({
            remoteBranch: 'origin/main',
          });

          if (!syncResult.isUpToDate && syncResult.hasRemote) {
            console.error(chalk.red('❌ Branch is behind origin/main'));
            console.error(chalk.yellow(`   Behind by ${syncResult.behindBy} commit(s)`));
            console.error(chalk.yellow('   Please merge origin/main before committing:'));
            console.error(chalk.gray('   git merge origin/main'));
            process.exit(1);
          }

          if (syncResult.hasRemote) {
            console.log(chalk.green('✅ Branch is up to date with origin/main'));
          } else {
            console.log(chalk.gray('ℹ️  No remote tracking branch (new branch or no remote)'));
          }
        }

        // Step 2: Load configuration
        const config = await loadConfig();
        if (!config) {
          console.error(chalk.red('❌ No configuration found'));
          console.error(chalk.gray('   Run: vibe-validate init'));
          process.exit(1);
        }

        // Step 3: Detect context
        const context = detectContext();

        // Step 4: Determine output format
        const format = options.format === 'auto'
          ? (context.isAgent ? 'yaml' : 'human')
          : options.format;

        // Step 5: Run validation
        console.log(chalk.blue('\n🔄 Running validation...'));

        const runnerConfig = createRunnerConfig(config, {
          force: false, // Respect cache by default
          format,
          context,
        });

        const result = await runValidation(runnerConfig);

        // Step 6: Report results
        if (result.passed) {
          console.log(chalk.green('\n✅ Pre-commit checks passed!'));
          console.log(chalk.gray('   Safe to commit.'));
          process.exit(0);
        } else {
          console.error(chalk.red('\n❌ Pre-commit checks failed'));
          console.error(chalk.yellow('   Fix errors before committing.'));

          // Show agent-friendly error details
          console.error(chalk.blue('\n📋 Error details:'), chalk.white(runnerConfig.stateFilePath || '.vibe-validate-state.yaml'));
          if (result.rerunCommand) {
            console.error(chalk.blue('🔄 To retry:'), chalk.white(result.rerunCommand));
          }
          if (result.fullLogFile) {
            console.error(chalk.blue('📄 Full log:'), chalk.gray(result.fullLogFile));
          }

          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red('❌ Pre-commit checks failed with error:'), error);
        process.exit(1);
      }
    });
}
