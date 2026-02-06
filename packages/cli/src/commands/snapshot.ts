/**
 * Snapshot Command
 *
 * Display current worktree snapshot and recovery instructions.
 * Helps users understand their work protection state and how to recover if needed.
 */

import { getGitTreeHash } from '@vibe-validate/git';
import { hasHistoryForTree, readHistoryNote } from '@vibe-validate/history';
import chalk from 'chalk';
import type { Command } from 'commander';

export function snapshotCommand(program: Command): void {
  program
    .command('snapshot')
    .description('Show current worktree snapshot and recovery instructions')
    .option('-v, --verbose', 'Show detailed snapshot information')
    .action(async (options) => {
      try {
        await executeSnapshotCommand(options, program.name());
      } catch (error) {
        // Re-throw if this is from process.exit (test mock)
        if (error instanceof Error && error.message.startsWith('process.exit')) {
          throw error;
        }
        console.error(chalk.red('❌ Failed to get snapshot:'), error);
        process.exit(1);
      }
    });
}

/**
 * Display validation history for a tree hash
 */
async function displayValidationHistory(treeHash: string, programName: string): Promise<void> {
  const hasHistory = await hasHistoryForTree(treeHash);
  if (!hasHistory) {
    console.log(chalk.gray('  Validation Status: Not yet validated'));
    return;
  }

  const historyNote = await readHistoryNote(treeHash);
  if (!historyNote || historyNote.runs.length === 0) {
    console.log(chalk.gray('  Validation Status: Not yet validated'));
    return;
  }

  const mostRecentRun = historyNote.runs.at(-1);
  if (!mostRecentRun) return;

  const passed = mostRecentRun.result.passed;
  const status = passed ? chalk.green('✅ Passed') : chalk.red('❌ Failed');
  console.log(chalk.gray(`  Validation Status: ${status}`));
  console.log(chalk.gray(`  Last validated: ${new Date(mostRecentRun.result.timestamp).toLocaleString()}`));
  if (!passed) {
    console.log(chalk.yellow(`  Run '${programName} state' for detailed error information`));
  }
}

/**
 * Execute the snapshot command logic
 */
async function executeSnapshotCommand(options: { verbose?: boolean }, programName: string): Promise<void> {
  console.log(chalk.blue('📸 Current Worktree Snapshot\n'));

  // Get current snapshot
  const treeHashResult = await getGitTreeHash();
  const treeHash = treeHashResult.hash;
  console.log(chalk.green(`✓ Snapshot: ${treeHash}`));

  // Check if snapshot has validation history
  await displayValidationHistory(treeHash, programName);

  // Show recovery instructions
  console.log(chalk.blue('\n🔧 Recovery Instructions\n'));
  console.log(chalk.yellow('If you need to recover files from this snapshot:'));
  console.log('');
  console.log(chalk.gray('1. View files in snapshot:'));
  console.log(chalk.white(`   git ls-tree -r ${treeHash}`));
  console.log('');
  console.log(chalk.gray('2. Restore a specific file:'));
  console.log(chalk.white(`   git show ${treeHash}:path/to/file > path/to/file`));
  console.log('');
  console.log(chalk.gray('3. Restore all files (CAUTION - overwrites working directory):'));
  console.log(chalk.white(`   git read-tree ${treeHash}`));
  console.log(chalk.white('   git checkout-index -f -a'));
  console.log('');

  if (options.verbose) {
    console.log(chalk.blue('📚 Additional Information\n'));
    console.log(chalk.gray('What is a snapshot?'));
    console.log('A snapshot is a git tree hash that represents the exact state');
    console.log('of all files in your working directory at a specific point in time.');
    console.log('');
    console.log(chalk.gray('When are snapshots created?'));
    console.log('• Before any git operations in vibe-validate pre-commit');
    console.log('• When running vibe-validate validate');
    console.log('• When running vibe-validate state');
    console.log('• Anytime you run this snapshot command');
    console.log('');
    console.log(chalk.gray('Why are snapshots important?'));
    console.log('They protect your work from being lost during merge conflicts,');
    console.log('rebases, or other git operations that might modify files.');
    console.log('');
  }

  process.exit(0);
}

/**
 * Show verbose help with detailed documentation
 */
export function showSnapshotVerboseHelp(): void {
  console.log(`# snapshot Command Reference

> Show current worktree snapshot and recovery instructions

## Overview

The \`snapshot\` command displays the current state of your working directory as a git tree hash (snapshot) and provides detailed instructions for recovering files if needed. This is particularly useful after git operations that may have caused merge conflicts or data loss.

## How It Works

1. Creates a snapshot of your current working directory (all files, staged and unstaged)
2. Shows the git tree hash that represents this exact state
3. Displays validation status if the snapshot has been validated
4. Provides step-by-step recovery instructions

## What is a Snapshot?

A snapshot is a **git tree hash** - a cryptographic hash that represents the exact state of all files in your working directory at a specific point in time. The same files will always produce the same hash, making snapshots deterministic and reliable.

## When are Snapshots Created?

Snapshots are automatically created:
- **BEFORE** any git operations in \`vibe-validate pre-commit\` (CRITICAL for work protection)
- When running \`vibe-validate validate\`
- When running \`vibe-validate state\`
- When running \`vibe-validate snapshot\`

## Options

- \`-v, --verbose\` - Show detailed snapshot information and educational content

## Recovery Scenarios

### Scenario 1: Merge Conflict Caused File Loss

**Problem**: You ran \`git merge origin/main\` and got conflicts. Some of your work was overwritten.

**Solution**:
\`\`\`bash
# Get your snapshot hash
vibe-validate snapshot

# Restore specific file from snapshot
git show <tree-hash>:path/to/file > path/to/file

# Or view all files in snapshot first
git ls-tree -r <tree-hash>
\`\`\`

### Scenario 2: Rebase Went Wrong

**Problem**: After \`git rebase\`, some files aren't in the state you expected.

**Solution**:
\`\`\`bash
# Get snapshot from before rebase
vibe-validate snapshot

# Compare current file with snapshot version
git diff <tree-hash> -- path/to/file

# Restore if needed
git show <tree-hash>:path/to/file > path/to/file
\`\`\`

### Scenario 3: Complete Working Directory Recovery

**Problem**: You need to restore EVERYTHING to the snapshot state.

**Solution** (CAUTION - overwrites all files):
\`\`\`bash
# Get snapshot hash
vibe-validate snapshot

# Restore all files from snapshot
git read-tree <tree-hash>
git checkout-index -f -a
\`\`\`

## Understanding Validation Status

The \`snapshot\` command shows the validation status for the current snapshot:

- **✅ Passed** - This snapshot passed validation, safe to commit
- **❌ Failed** - This snapshot has validation errors, run \`vv state\` for details
- **Not yet validated** - No validation history for this snapshot

Note: The snapshot itself is always valid (it's a record of your current files). The "Validation Status" tells you whether these files passed validation checks (linting, tests, etc.).

## Examples

\`\`\`bash
# Show current snapshot and recovery instructions
vibe-validate snapshot

# Show detailed information
vibe-validate snapshot --verbose
\`\`\`

## Common Workflows

### After Pre-Commit Failure

\`\`\`bash
# pre-commit failed with "branch behind origin/main"
$ vibe-validate pre-commit
❌ Branch is behind origin/main
✓ Work protected by snapshot: abc123def456...

# View snapshot details
$ vibe-validate snapshot
📸 Current Worktree Snapshot
✓ Snapshot: abc123def456...

# Safe to merge now
$ git merge origin/main
\`\`\`

### Investigating Validation State

\`\`\`bash
# Check if current work has been validated
$ vibe-validate snapshot
📸 Current Worktree Snapshot
✓ Snapshot: abc123def456...
  Validation Status: ✅ Passed
  Last validated: 12/5/2025, 10:30:15 AM

# View detailed validation state
$ vibe-validate state
\`\`\`

## Technical Details

Snapshots use \`git write-tree\` to create deterministic content-based hashes:
- Same files → same hash (no timestamps involved)
- Includes all files (staged and unstaged)
- Does NOT modify your git index
- Stores as temporary git tree object (garbage collected eventually)

## See Also

- \`vibe-validate state\` - View validation state for current snapshot
- \`vibe-validate pre-commit\` - Run pre-commit workflow (creates snapshot automatically)
- \`vibe-validate validate\` - Run validation (creates snapshot automatically)
`);
}
