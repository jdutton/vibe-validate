/**
 * Cleanup Command
 *
 * Post-merge branch cleanup - switches to main and deletes merged branches.
 */

import type { Command } from 'commander';
import { cleanupMergedBranches } from '@vibe-validate/git';
import { stringify as stringifyYaml } from 'yaml';
import chalk from 'chalk';

export function cleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description('Post-merge cleanup (switch to main, delete merged branches)')
    .option('--main-branch <branch>', 'Main branch name', 'main')
    .option('--dry-run', 'Show what would be deleted without actually deleting')
    .option('--yaml', 'Output YAML only (no human-friendly display)')
    .action(async (options) => {
      try {
        // Run post-merge cleanup
        const result = await cleanupMergedBranches({
          mainBranch: options.mainBranch,
          dryRun: options.dryRun,
        });

        // Output based on yaml flag
        if (options.yaml) {
          // YAML mode: Output structured result to stdout
          // Small delay to ensure stderr is flushed
          await new Promise(resolve => setTimeout(resolve, 10));

          // RFC 4627 separator
          process.stdout.write('---\n');

          // Write pure YAML
          process.stdout.write(stringifyYaml(result));

          // CRITICAL: Wait for stdout to flush before exiting
          await new Promise<void>(resolve => {
            if (process.stdout.write('')) {
              resolve();
            } else {
              process.stdout.once('drain', resolve);
            }
          });
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
 * Get icon based on dry-run mode
 */
function getIcon(dryRun: boolean): string {
  // eslint-disable-next-line sonarjs/no-selector-parameter -- dryRun is idiomatic for preview mode in CLI tools
  return dryRun ? '→' : '✅';
}

/**
 * Display header for cleanup results
 */
function displayHeader(dryRun: boolean): void {
  const title = dryRun ? '🔍 Cleanup Preview (Dry Run)' : '🧹 Post-Merge Cleanup';
  console.log(chalk.blue(title));
  console.log(chalk.gray('─'.repeat(50)));
}

/**
 * Display footer message based on cleanup results
 */
function displayFooter(dryRun: boolean, success: boolean, branchesDeleted: number): void {
  console.log(chalk.gray('─'.repeat(50)));

  if (dryRun) {
    console.log(chalk.yellow('\n💡 This was a dry run. To actually clean up:'));
    console.log(chalk.gray('   vibe-validate cleanup'));
  } else if (success && branchesDeleted > 0) {
    console.log(chalk.green('\n✅ Cleanup complete!'));
  }
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
  displayHeader(dryRun);

  const icon = getIcon(dryRun);

  // Current branch
  if (result.currentBranch) {
    console.log(chalk.green(`${icon} Current branch: ${result.currentBranch}`));
  }

  // Synced with remote
  if (result.mainSynced) {
    console.log(chalk.green(`${icon} Synced with remote`));
  }

  // Deleted branches
  if (result.branchesDeleted.length > 0) {
    console.log(chalk.green(`\n${icon} Deleted branches:`));
    for (const branch of result.branchesDeleted) {
      console.log(chalk.gray(`   • ${branch}`));
    }
  } else {
    console.log(chalk.gray('\nℹ️  No merged branches to delete'));
  }

  // Error
  if ('error' in result && result.error) {
    console.log(chalk.red('\n❌ Error encountered:'));
    console.log(chalk.red(`   ${result.error}`));
  }

  displayFooter(dryRun, result.success, result.branchesDeleted.length);
}

/**
 * Show verbose help with detailed documentation
 */
export function showCleanupVerboseHelp(): void {
  console.log(`# cleanup Command Reference

> Post-merge cleanup (switch to main, delete merged branches)

## Overview

The \`cleanup\` command automates post-merge branch cleanup. After a PR is merged, this command switches to the main branch, pulls the latest changes, identifies merged branches, and deletes them locally.

## How It Works

1. Switches to main branch
2. Pulls latest from origin/main
3. Identifies merged branches (via git log)
4. Deletes confirmed-merged branches
5. Reports cleanup summary

## Options

- \`--main-branch <branch>\` - Main branch name (default: main)
- \`--dry-run\` - Show what would be deleted without actually deleting
- \`--yaml\` - Output YAML only (no human-friendly display)

## Exit Codes

- \`0\` - Cleanup successful
- \`1\` - Failed (not on deletable branch, git errors)

## Examples

\`\`\`bash
# Preview what would be cleaned up
vibe-validate cleanup --dry-run

# Execute cleanup
vibe-validate cleanup

# Cleanup with custom main branch
vibe-validate cleanup --main-branch develop
\`\`\`

## Common Workflows

### After PR merge

\`\`\`bash
# Merge PR on GitHub

# Switch to main and cleanup
vibe-validate cleanup

# Start new feature
git checkout -b feature/new-work
\`\`\`

### Preview before cleanup

\`\`\`bash
# See what would be deleted
vibe-validate cleanup --dry-run

# If looks good, execute
vibe-validate cleanup
\`\`\`

## Error Recovery

**If cleanup fails:**
1. Ensure you're not on the main branch
2. Verify remote connection: \`git fetch origin\`
3. Check for uncommitted changes: \`git status\`
4. Manually delete branches if needed: \`git branch -d <branch-name>\`
`);
}
