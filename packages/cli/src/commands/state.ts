/**
 * State Command
 *
 * Display current validation state from git notes cache.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { stringify as stringifyYaml } from 'yaml';
import { getGitTreeHash } from '@vibe-validate/git';
import { readHistoryNote, hasHistoryForTree } from '@vibe-validate/history';
import type { ValidationResult } from '@vibe-validate/core';

export function stateCommand(program: Command): void {
  program
    .command('state')
    .description('Show current validation state from git notes')
    .option('-v, --verbose', 'Show full error output without truncation')
    .action(async (options) => {
      try {
        // Get current tree hash
        const treeHash = await getGitTreeHash();

        // Check if history exists for current tree
        const hasHistory = await hasHistoryForTree(treeHash);

        if (!hasHistory) {
          console.log('exists: false');
          if (options.verbose) {
            console.log(chalk.gray('\nℹ️  No validation state found for current worktree'));
            console.log(chalk.gray(`   Tree hash: ${treeHash.substring(0, 12)}...`));
            console.log(chalk.gray('   Run: vibe-validate validate'));
          }
          process.exit(0);
        }

        // Read history note
        const historyNote = await readHistoryNote(treeHash);

        if (!historyNote || historyNote.runs.length === 0) {
          console.log('exists: false');
          if (options.verbose) {
            console.log(chalk.gray('\nℹ️  No validation runs found for current worktree'));
          }
          process.exit(0);
        }

        // Get most recent run
        const mostRecentRun = historyNote.runs[historyNote.runs.length - 1];
        const result = mostRecentRun.result;

        // Convert to state format (compatible with old format)
        const state: ValidationResult = {
          passed: result.passed,
          timestamp: result.timestamp,
          treeHash: result.treeHash,
          failedStep: result.failedStep,
          failedStepOutput: result.failedStepOutput,
          phases: result.phases,
          rerunCommand: result.rerunCommand,
        };

        // Output YAML format (always)
        const yamlContent = stringifyYaml(state);

        if (options.verbose) {
          // Verbose mode: show full output with colors and explanations
          displayVerboseState(state, yamlContent, mostRecentRun.branch);
        } else {
          // Minimal mode: just the YAML content
          console.log(yamlContent);
        }

        process.exit(0);
      } catch (error) {
        if (error instanceof Error && error.message.includes('not a git repository')) {
          console.log('exists: false');
          if (options.verbose) {
            console.log(chalk.gray('\nℹ️  Not in a git repository'));
            console.log(chalk.gray('   Validation history requires git'));
          }
          process.exit(0);
        }

        console.error(chalk.red('❌ Failed to read validation state:'), error);
        process.exit(1);
      }
    });
}

/**
 * Display validation state in verbose format with colors and explanations
 */
function displayVerboseState(state: ValidationResult, yamlContent: string, branch: string): void {
  // First show the raw YAML
  console.log(yamlContent);

  // Then add colored summary and explanations
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.blue('📊 Validation State Summary'));
  console.log(chalk.gray('─'.repeat(50)));

  // Status
  if (state.passed) {
    console.log(chalk.green('✅ Status: PASSED'));
  } else {
    console.log(chalk.red('❌ Status: FAILED'));
  }

  // Timestamp
  const timestamp = new Date(state.timestamp);
  console.log(chalk.gray(`⏰ Last Run: ${timestamp.toLocaleString()}`));

  // Tree hash
  console.log(chalk.gray(`🌳 Git Tree Hash: ${state.treeHash.substring(0, 12)}...`));

  // Branch
  console.log(chalk.gray(`🌿 Branch: ${branch}`));

  // Failed step details (if any)
  if (!state.passed && state.failedStep) {
    console.log(chalk.red(`\n❌ Failed Step: ${state.failedStep}`));

    if (state.failedStepOutput) {
      console.log(chalk.red('\nError Output (included in YAML above):'));
      console.log(chalk.gray('  See failedStepOutput field for complete error details'));
    }
  }

  console.log(chalk.gray('─'.repeat(50)));

  // Next steps
  if (!state.passed) {
    console.log(chalk.yellow('\nNext Steps:'));
    console.log(chalk.gray('  1. Fix the failed step'));
    console.log(chalk.gray('  2. Re-run: vibe-validate validate'));
    console.log(chalk.gray('  3. Or force re-validation: vibe-validate validate --force'));

    // Suggest reporting extractor issues
    console.log(chalk.gray('\n💡 Error output unclear or missing details?'));
    console.log(
      chalk.gray(
        '   Help improve extraction: https://github.com/jdutton/vibe-validate/issues/new?template=extractor-improvement.yml',
      ),
    );
  } else {
    console.log(chalk.green('\n✅ Validation passed! Safe to commit.'));
  }

  console.log(chalk.gray('\n💡 Tip: View full history with: vibe-validate history list'));
}
