/**
 * Cleanup Command
 *
 * Post-merge branch cleanup - switches to main and deletes merged branches.
 */

import type { Command } from 'commander';
import { cleanupMergedBranches } from '@vibe-validate/git';
import chalk from 'chalk';

export function cleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description('Post-merge cleanup (switch to main, delete merged branches)')
    .option('--main-branch <branch>', 'Main branch name', 'main')
    .option('--dry-run', 'Show what would be deleted without actually deleting')
    .option('--format <format>', 'Output format (human|yaml|json)', 'human')
    .action(async (options) => {
      try {
        // Run post-merge cleanup
        const result = await cleanupMergedBranches({
          mainBranch: options.mainBranch,
          dryRun: options.dryRun,
        });

        // Output based on format
        if (options.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else if (options.format === 'yaml') {
          console.log(`success: ${result.success}`);
          console.log(`currentBranch: ${result.currentBranch}`);
          console.log(`mainSynced: ${result.mainSynced}`);
          console.log(`branchesDeleted:`);
          result.branchesDeleted.forEach((branch: string) => {
            console.log(`  - ${branch}`);
          });
          if ('error' in result && result.error) {
            console.log(`error: ${result.error}`);
          }
        } else {
          // Human-friendly format
          displayHumanCleanup(result, options.dryRun);
        }

        // Exit with error code if there was an error
        process.exit(result.success ? 0 : 1);
      } catch (error) {
        console.error(chalk.red('❌ Cleanup failed with error:'), error);
        process.exit(1);
      }
    });
}

/**
 * Display cleanup results in human-friendly format
 */
function displayHumanCleanup(
  result: {
    success: boolean;
    error?: string;
    branchesDeleted: string[];
    currentBranch: string;
    mainSynced: boolean;
  },
  dryRun: boolean
): void {
  if (dryRun) {
    console.log(chalk.blue('🔍 Cleanup Preview (Dry Run)'));
  } else {
    console.log(chalk.blue('🧹 Post-Merge Cleanup'));
  }
  console.log(chalk.gray('─'.repeat(50)));

  // Current branch
  if (result.currentBranch) {
    const icon = dryRun ? '→' : '✅';
    console.log(chalk.green(`${icon} Current branch: ${result.currentBranch}`));
  }

  // Synced with remote
  if (result.mainSynced) {
    const icon = dryRun ? '→' : '✅';
    console.log(chalk.green(`${icon} Synced with remote`));
  }

  // Deleted branches
  if (result.branchesDeleted.length > 0) {
    const icon = dryRun ? '→' : '✅';
    console.log(chalk.green(`\n${icon} Deleted branches:`));
    result.branchesDeleted.forEach(branch => {
      console.log(chalk.gray(`   • ${branch}`));
    });
  } else {
    console.log(chalk.gray('\nℹ️  No merged branches to delete'));
  }

  // Error
  if ('error' in result && result.error) {
    console.log(chalk.red('\n❌ Error encountered:'));
    console.log(chalk.red(`   ${result.error}`));
  }

  console.log(chalk.gray('─'.repeat(50)));

  if (dryRun) {
    console.log(chalk.yellow('\n💡 This was a dry run. To actually clean up:'));
    console.log(chalk.gray('   vibe-validate cleanup'));
  } else if (result.success && result.branchesDeleted.length > 0) {
    console.log(chalk.green('\n✅ Cleanup complete!'));
  }
}
