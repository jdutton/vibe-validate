/**
 * Cleanup Command
 *
 * Branch cleanup and temp file management.
 *
 * v0.18.0: Complete redesign with comprehensive fact-gathering,
 * GitHub API integration, and LLM-optimized YAML-only output.
 */

import { cleanupBranches } from '@vibe-validate/git';
import chalk from 'chalk';
import type { Command } from 'commander';

import { getCommandName } from '../utils/command-name.js';
import { cleanupOldTempFiles, getTempStorageInfo, formatBytes } from '../utils/temp-files.js';
import { outputYamlResult } from '../utils/yaml-output.js';


export function cleanupCommand(program: Command): void {
  // Branch cleanup - YAML-only output (no options)
  program
    .command('cleanup')
    .description('Comprehensive branch cleanup with GitHub integration')
    .action(async () => {
      try {
        // Run comprehensive branch cleanup
        const result = await cleanupBranches();

        // Always output YAML (LLM-optimized)
        await outputYamlResult(result);

        // Success if no errors
        process.exit(0);
      } catch (error) {
        // Format error for YAML output
        const errorResult = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          guidance: error instanceof Error && error.message.includes('GitHub CLI')
            ? 'Install GitHub CLI: https://cli.github.com/'
            : 'Check git repository status and permissions',
        };

        await outputYamlResult(errorResult);
        process.exit(1);
      }
    });

  // Temp files cleanup command
  program
    .command('cleanup-temp')
    .description('Clean up old temporary output files')
    .option('--older-than <days>', 'Delete files older than N days', '7')
    .option('--all', 'Delete all temp files regardless of age')
    .option('--dry-run', 'Show what would be deleted without actually deleting')
    .option('--yaml', 'Output YAML only (no human-friendly display)')
    .action(async (options) => {
      try {
        const olderThanDays = options.all ? 0 : Number.parseInt(options.olderThan, 10);
        const storageBefore = await getTempStorageInfo();
        const result = await cleanupOldTempFiles({
          olderThanDays,
          deleteAll: options.all,
          dryRun: options.dryRun,
        });
        const storageAfter = options.dryRun ? storageBefore : await getTempStorageInfo();

        const outputResult = {
          success: result.errors.length === 0,
          deletedCount: result.deletedCount,
          freedBytes: result.freedBytes,
          errors: result.errors,
          storage: {
            before: {
              bytes: storageBefore.sizeBytes,
              formatted: formatBytes(storageBefore.sizeBytes),
              runCount: storageBefore.runCount,
            },
            after: {
              bytes: storageAfter.sizeBytes,
              formatted: formatBytes(storageAfter.sizeBytes),
              runCount: storageAfter.runCount,
            },
          },
          dryRun: options.dryRun,
        };

        if (options.yaml) {
          await outputYamlResult(outputResult);
        } else {
          displayTempCleanup(outputResult);
        }

        process.exit(outputResult.success ? 0 : 1);
      } catch (error) {
        console.error(chalk.red('❌ Temp cleanup failed:'), error);
        process.exit(1);
      }
    });
}

/**
 * Display temp cleanup results in human-friendly format
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Display logic is inherently complex with multiple conditional branches
function displayTempCleanup(result: {
  success: boolean;
  deletedCount: number;
  freedBytes: number;
  errors: Array<{ path: string; error: string }>;
  storage: {
    before: { bytes: number; formatted: string; runCount: number };
    after: { bytes: number; formatted: string; runCount: number };
  };
  dryRun: boolean;
}): void {
  const title = result.dryRun ? '🔍 Temp Cleanup Preview (Dry Run)' : '🧹 Temp File Cleanup';
  console.log(chalk.blue(title));
  console.log(chalk.gray('─'.repeat(50)));

  // Storage before
  console.log(chalk.cyan('\n📊 Storage Usage:'));
  console.log(chalk.gray(`   Before: ${result.storage.before.formatted} (${result.storage.before.runCount} runs)`));

  if (!result.dryRun) {
    console.log(chalk.gray(`   After:  ${result.storage.after.formatted} (${result.storage.after.runCount} runs)`));
  }

  // Deleted count
  if (result.deletedCount > 0) {
    const icon = result.dryRun ? '→' : '✅';
    console.log(chalk.green(`\n${icon} ${result.deletedCount} run${result.deletedCount > 1 ? 's' : ''} would be deleted`));
    console.log(chalk.gray(`   Freed space: ${formatBytes(result.freedBytes)}`));
  } else {
    console.log(chalk.gray('\nℹ️  No temp files to delete'));
  }

  // Errors
  if (result.errors.length > 0) {
    console.log(chalk.red('\n⚠️  Errors encountered:'));
    for (const error of result.errors.slice(0, 5)) {
      console.log(chalk.red(`   ${error.path}: ${error.error}`));
    }
    if (result.errors.length > 5) {
      console.log(chalk.gray(`   ... and ${result.errors.length - 5} more errors`));
    }
  }

  console.log(chalk.gray('─'.repeat(50)));

  if (result.dryRun) {
    const cmd = getCommandName();
    console.log(chalk.yellow('\n💡 This was a dry run. To actually clean up:'));
    console.log(chalk.gray(`   ${cmd} cleanup temp`));
  } else if (result.success && result.deletedCount > 0) {
    console.log(chalk.green('\n✅ Cleanup complete!'));
  }
}

/**
 * Show verbose help with detailed documentation
 */
export function showCleanupVerboseHelp(): void {
  console.log(`# cleanup Command Reference

> Comprehensive branch cleanup with GitHub integration (v0.18.0)

## Overview

The \`cleanup\` command provides LLM-optimized branch cleanup with comprehensive fact-gathering. It analyzes all local branches, detects squash merges via GitHub API, and provides complete context for safe decision-making.

## Key Features (v0.18.0)

- **GitHub Integration**: Detects squash/rebase merges via PR data (requires \`gh\` CLI)
- **Smart Categorization**: Auto-deletes 100% safe branches, shows complete context for others
- **Current Branch Handling**: Automatically switches away if current branch needs cleanup
- **YAML-Only Output**: LLM-optimized structured data (no human-readable mode)
- **No Options**: Simple, opinionated design - just run \`cleanup\`

## How It Works

1. Detects default branch (main/master/develop)
2. Switches away from current branch if needed (safety)
3. Gathers git facts for all local branches:
   - Merge status (git branch --merged)
   - Remote tracking status (exists/deleted/never_pushed)
   - Unpushed commit count
   - Last commit date and author
4. Enriches with GitHub PR data:
   - Associated PR number and state
   - Merge method (merge/squash/rebase)
   - Merged by whom and when
5. Categorizes branches:
   - **auto_deleted**: Merged + no unpushed work (100% safe)
   - **needs_review**: Squash merged, old abandoned, etc.
6. Auto-deletes safe branches
7. Returns structured YAML with complete verification context

## Requirements

- **GitHub CLI (\`gh\`)**: Required for squash merge detection
  - Install: https://cli.github.com/
  - Authenticate: \`gh auth login\`
- Git repository with remote configured
- Not on a protected branch (main/master/develop)

## Output Format

\`\`\`yaml
context:
  repository: owner/repo
  remote: origin
  default_branch: main
  current_branch: main
  switched_branch: false

auto_deleted:
  - name: feature/old-work
    reason: merged_to_main
    recovery_command: "git reflog | grep 'feature/old-work'"

needs_review:
  - name: feature/squash-merged
    verification:
      merged_to_main: false
      remote_status: deleted
      unpushed_commit_count: 0
      pr_number: 92
      pr_state: merged
      merge_method: squash
    assessment: |
      Remote deleted by GitHub
      PR #92 merged 2 days ago by jdutton
      squash merge explains why git branch --merged returned false
      No unpushed commits (safe to delete)
    delete_command: "git branch -D feature/squash-merged"
    recovery_command: "git reflog | grep 'feature/squash-merged'"

summary:
  auto_deleted_count: 1
  needs_review_count: 1
  total_branches_analyzed: 15

recovery_info: |
  Deleted branches are recoverable for 30 days via git reflog:
    git reflog
    git checkout -b <branch-name> <SHA>
\`\`\`

## Exit Codes

- \`0\` - Cleanup successful (even if no branches deleted)
- \`1\` - Error (gh CLI missing, git errors, etc.)

## Examples

\`\`\`bash
# Run cleanup (always YAML output)
vibe-validate cleanup

# Parse YAML output
vibe-validate cleanup | yq '.needs_review[].name'

# Check if any branches need review
vibe-validate cleanup | yq '.summary.needs_review_count'
\`\`\`

## Common Workflows

### After merging a squash-merged PR

\`\`\`bash
# PR #92 was squash-merged on GitHub
vibe-validate cleanup

# Output shows:
# needs_review:
#   - name: feature/my-pr
#     pr_number: 92
#     pr_state: merged
#     merge_method: squash

# Verify and delete
git branch -D feature/my-pr
\`\`\`

### Review old branches

\`\`\`bash
# See all branches flagged for review
vibe-validate cleanup | yq '.needs_review'

# Delete specific branch
git branch -D feature/old-branch

# Recover if needed (within 30 days)
git reflog | grep 'feature/old-branch'
git checkout -b feature/old-branch <SHA>
\`\`\`

## Safety Principles

1. **NEVER deletes branches with unpushed work** (non-negotiable)
2. **Auto-deletes only 100% safe branches** (merged + no unpushed commits)
3. **All deletions recoverable** via git reflog for 30 days
4. **Complete context upfront** (no follow-up questions needed)
5. **Switches away from current branch** if it needs cleanup

## Breaking Changes from v0.17.x

- **Removed options**: No --main-branch, --dry-run, --yaml (always YAML now)
- **GitHub CLI required**: No graceful degradation (error if missing)
- **Output format changed**: New structured YAML format
- **No human-readable mode**: YAML-only for LLM consumption

## Error Recovery

**If \`gh\` CLI not found:**
\`\`\`bash
# Install GitHub CLI
brew install gh  # macOS
# or: https://cli.github.com/

# Authenticate
gh auth login
\`\`\`

**If branch has unpushed work:**
- Push work first: \`git push\`
- Or commit locally: \`git commit -am "WIP"\`
- Branch will not appear in cleanup output (safety)

**If accidentally deleted:**
\`\`\`bash
# Find in reflog
git reflog | grep 'branch-name'

# Recover
git checkout -b branch-name <SHA>
\`\`\`
`);
}
