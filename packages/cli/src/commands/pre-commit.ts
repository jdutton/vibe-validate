/**
 * Pre-Commit Command
 *
 * Runs branch sync check + validation before allowing commit.
 * This is the recommended workflow before committing code.
 */

import type { Command } from 'commander';
import { runValidation } from '@vibe-validate/core';
import { checkBranchSync } from '@vibe-validate/git';
import { getRemoteBranch } from '@vibe-validate/config';
import { loadConfig } from '../utils/config-loader.js';
import { createRunnerConfig } from '../utils/runner-adapter.js';
import { detectContext } from '../utils/context-detector.js';
import { execSync } from 'child_process';
import chalk from 'chalk';

export function preCommitCommand(program: Command): void {
  program
    .command('pre-commit')
    .description('Run branch sync check + validation (recommended before commit)')
    .option('--skip-sync', 'Skip branch sync check')
    .option('-v, --verbose', 'Show detailed progress and output')
    .action(async (options) => {
      try {
        // Step 1: Load configuration (needed for git settings)
        const config = await loadConfig();
        if (!config) {
          console.error(chalk.red('❌ No configuration found'));
          console.error(chalk.gray('   Run: vibe-validate init'));
          process.exit(1);
        }

        // Step 2: Check branch sync (unless skipped)
        if (!options.skipSync) {
          // Construct remote branch reference using helper
          const remoteBranch = getRemoteBranch(config.git);

          console.log(chalk.blue(`🔄 Checking branch sync with ${remoteBranch}...`));

          const syncResult = await checkBranchSync({
            remoteBranch,
          });

          if (!syncResult.isUpToDate && syncResult.hasRemote) {
            console.error(chalk.red(`❌ Branch is behind ${remoteBranch}`));
            console.error(chalk.yellow(`   Behind by ${syncResult.behindBy} commit(s)`));
            console.error(chalk.yellow(`   Please merge ${remoteBranch} before committing:`));
            console.error(chalk.gray(`   git merge ${remoteBranch}`));
            process.exit(1);
          }

          if (syncResult.hasRemote) {
            console.log(chalk.green(`✅ Branch is up to date with ${remoteBranch}`));
          } else {
            console.log(chalk.gray('ℹ️  No remote tracking branch (new branch or no remote)'));
          }
        }

        // Step 3: Verbose mode is ONLY enabled via explicit --verbose flag
        const verbose = options.verbose ?? false;

        // Step 4: Run secret scanning if enabled
        const secretScanning = config.hooks?.preCommit?.secretScanning;
        if (secretScanning?.enabled && secretScanning?.scanCommand) {
          console.log(chalk.blue('\n🔒 Running secret scanning...'));

          try {
            const result = execSync(secretScanning.scanCommand, {
              encoding: 'utf8',
              stdio: 'pipe',
            });

            // Show scan output if verbose
            if (verbose && result) {
              console.log(chalk.gray(result));
            }

            console.log(chalk.green('✅ No secrets detected'));
          } catch (error: unknown) {
            // Secret scanning failed (either tool missing or secrets found)
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
              // Tool not found
              const toolName = secretScanning.scanCommand.split(' ')[0];
              console.error(chalk.red('\n❌ Secret scanning tool not found'));
              console.error(chalk.yellow(`   Command: ${chalk.white(secretScanning.scanCommand)}`));
              console.error(chalk.yellow(`   Tool '${toolName}' is not installed or not in PATH`));
              console.error(chalk.blue('\n💡 Fix options:'));
              console.error(chalk.gray('   1. Install the tool (e.g., brew install gitleaks)'));
              console.error(chalk.gray('   2. Disable scanning: set hooks.preCommit.secretScanning.enabled=false'));
              process.exit(1);
            } else if (error && typeof error === 'object' && 'stderr' in error && 'stdout' in error) {
              // Tool ran but found secrets
              const stderr = 'stderr' in error && error.stderr ? String(error.stderr) : '';
              const stdout = 'stdout' in error && error.stdout ? String(error.stdout) : '';

              console.error(chalk.red('\n❌ Secret scanning detected potential secrets in staged files\n'));

              // Show scan output
              if (stdout) {
                console.error(stdout);
              }
              if (stderr) {
                console.error(stderr);
              }

              console.error(chalk.blue('\n💡 Fix options:'));
              console.error(chalk.gray('   1. Remove secrets from staged files'));
              console.error(chalk.gray('   2. Use .gitleaksignore to mark false positives (if using gitleaks)'));
              console.error(chalk.gray('   3. Disable scanning: set hooks.preCommit.secretScanning.enabled=false'));
              process.exit(1);
            } else {
              // Unknown error
              console.error(chalk.red('\n❌ Secret scanning failed with unknown error'));
              console.error(chalk.gray(String(error)));
              process.exit(1);
            }
          }
        }

        // Step 5: Detect context
        const context = detectContext();

        // Step 6: Run validation
        console.log(chalk.blue('\n🔄 Running validation...'));

        const runnerConfig = createRunnerConfig(config, {
          force: false, // Respect cache by default
          verbose,
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
