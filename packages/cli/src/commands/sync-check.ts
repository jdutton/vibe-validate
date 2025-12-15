/**
 * Sync-Check Command
 *
 * Check if current branch is behind remote main branch without auto-merging.
 */

import { getRemoteBranch, getMainBranch } from '@vibe-validate/config';
import { checkBranchSync } from '@vibe-validate/git';
import chalk from 'chalk';
import type { Command } from 'commander';

import { loadConfig } from '../utils/config-loader.js';
import { outputYamlResult } from '../utils/yaml-output.js';


export function syncCheckCommand(program: Command): void {
  program
    .command('sync-check')
    .description('Check if branch is behind remote main branch')
    .option('--main-branch <branch>', 'Main branch name (overrides config)')
    .option('--remote-origin <remote>', 'Remote origin name (overrides config)')
    .option('--yaml', 'Output YAML only (no human-friendly display)')
    .action(async (options) => {
      try {
        // Load config to get defaults
        const config = await loadConfig();

        // Build git config with CLI option overrides
        const gitConfig = {
          ...config?.git,
          ...(options.mainBranch && { mainBranch: options.mainBranch }),
          ...(options.remoteOrigin && { remoteOrigin: options.remoteOrigin }),
        };

        // Construct remote branch using config + overrides
        const remoteBranch = getRemoteBranch(gitConfig);
        const mainBranch = getMainBranch(gitConfig); // Used in display function below

        // Check branch sync
        const result = await checkBranchSync({
          remoteBranch,
        });

        // Output based on yaml flag
        if (options.yaml) {
          await outputYamlResult(result);
        } else {
          // Human-friendly format
          displayHumanSyncCheck(result, mainBranch);
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

/**
 * Show verbose help with detailed documentation
 */
export function showSyncCheckVerboseHelp(): void {
  console.log(`# sync-check Command Reference

> Check if branch is behind remote main branch

## Overview

The \`sync-check\` command verifies that your current branch is up to date with the remote main branch (usually origin/main). It compares local and remote commit histories without making any changes to your repository.

## How It Works

1. Checks if current branch has a remote tracking branch
2. Compares local and remote commit histories
3. Reports sync status (up to date, behind, or no remote)

## Options

- \`--main-branch <branch>\` - Main branch name (overrides config, default: main)
- \`--remote-origin <remote>\` - Remote origin name (overrides config, default: origin)
- \`--yaml\` - Output YAML only (no human-friendly display)

## Exit Codes

- \`0\` - Up to date or no remote tracking
- \`1\` - Branch is behind (needs merge)
- \`2\` - Git command failed

## Examples

\`\`\`bash
# Check sync with default main branch
vibe-validate sync-check

# Check sync with custom main branch
vibe-validate sync-check --main-branch develop

# YAML output only
vibe-validate sync-check --yaml
\`\`\`

## Common Workflows

### Before starting work

\`\`\`bash
# Check if your branch is behind
vibe-validate sync-check

# If behind, merge latest
git merge origin/main
\`\`\`

### In CI/CD pipeline

\`\`\`bash
# Check sync as YAML for parsing
vibe-validate sync-check --yaml
\`\`\`

## Error Recovery

### If branch is behind (exit 1)

**Merge the remote branch:**
\`\`\`bash
# Fetch latest changes
git fetch origin

# Merge origin/main (or git rebase origin/main)
git merge origin/main

# Resolve conflicts if any

# Retry sync check
vibe-validate sync-check
\`\`\`
`);
}
