/**
 * Sync-Check Command
 *
 * Check if current branch is behind origin/main without auto-merging.
 */

import type { Command } from 'commander';
import { checkBranchSync } from '@vibe-validate/git';
import chalk from 'chalk';

export function syncCheckCommand(program: Command): void {
  program
    .command('sync-check')
    .description('Check if branch is behind origin/main')
    .option('--main-branch <branch>', 'Main branch name', 'main')
    .option('--format <format>', 'Output format (human|yaml|json)', 'human')
    .action(async (options) => {
      try {
        // Check branch sync
        const result = await checkBranchSync({
          remoteBranch: `origin/${options.mainBranch}`,
        });

        // Output based on format
        if (options.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else if (options.format === 'yaml') {
          console.log(`hasRemote: ${result.hasRemote}`);
          console.log(`isUpToDate: ${result.isUpToDate}`);
          if (result.currentBranch) {
            console.log(`currentBranch: ${result.currentBranch}`);
          }
          if (result.behindBy !== undefined) {
            console.log(`behindBy: ${result.behindBy}`);
          }
        } else {
          // Human-friendly format
          displayHumanSyncCheck(result, options.mainBranch);
        }

        // Exit codes:
        // 0 = up to date or no remote
        // 1 = needs sync
        // 2 = error
        process.exit(!result.isUpToDate && result.hasRemote ? 1 : 0);
      } catch (error) {
        console.error(chalk.red('❌ Sync check failed with error:'), error);
        process.exit(2);
      }
    });
}

/**
 * Display sync check results in human-friendly format
 */
function displayHumanSyncCheck(
  result: { hasRemote: boolean; isUpToDate: boolean; currentBranch?: string; behindBy?: number },
  mainBranch: string
): void {
  console.log(chalk.blue('🔄 Branch Sync Check'));
  console.log(chalk.gray('─'.repeat(50)));

  if (result.currentBranch) {
    console.log(chalk.gray(`Current Branch: ${result.currentBranch}`));
  }

  if (!result.hasRemote) {
    console.log(chalk.gray('ℹ️  No remote tracking branch'));
    console.log(chalk.gray('   (New branch or no remote configured)'));
    console.log(chalk.green('\n✅ Safe to proceed'));
  } else if (!result.isUpToDate) {
    console.log(chalk.red(`❌ Branch is behind origin/${mainBranch}`));
    if (result.behindBy !== undefined) {
      console.log(chalk.yellow(`   Behind by ${result.behindBy} commit(s)`));
    }
    console.log(chalk.yellow('\n⚠️  Please merge before committing:'));
    console.log(chalk.gray(`   git merge origin/${mainBranch}`));
  } else {
    console.log(chalk.green(`✅ Up to date with origin/${mainBranch}`));
    console.log(chalk.green('\n✅ Safe to proceed'));
  }

  console.log(chalk.gray('─'.repeat(50)));
}
