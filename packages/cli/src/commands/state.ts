/**
 * State Command
 *
 * Display current validation state from cache file.
 */

import type { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { parse as parseYaml } from 'yaml';

interface ValidationState {
  passed: boolean;
  timestamp: string;
  treeHash: string;
  failedStep?: string;
  failedStepOutput?: string;
}

export function stateCommand(program: Command): void {
  program
    .command('state')
    .description('Show current validation state')
    .option('-v, --verbose', 'Show full error output without truncation')
    .option('--file <path>', 'State file path', '.vibe-validate-state.yaml')
    .action(async (options) => {
      try {
        const cwd = process.cwd();
        const statePath = join(cwd, options.file);

        // Check if state file exists
        if (!existsSync(statePath)) {
          console.log('exists: false');
          if (options.verbose) {
            console.log(chalk.gray('\nℹ️  No validation state found'));
            console.log(chalk.gray('   Run: vibe-validate validate'));
          }
          process.exit(0);
        }

        // Read and parse state file
        const stateContent = readFileSync(statePath, 'utf-8');
        const state = parseYaml(stateContent) as ValidationState;

        // Output YAML format (always)
        if (options.verbose) {
          // Verbose mode: show full output with colors and explanations
          displayVerboseState(state, stateContent);
        } else {
          // Minimal mode: just the YAML content
          console.log(stateContent);
        }

        process.exit(0);
      } catch (error) {
        console.error(chalk.red('❌ Failed to read validation state:'), error);
        process.exit(1);
      }
    });
}

/**
 * Display validation state in verbose format with colors and explanations
 */
function displayVerboseState(state: ValidationState, yamlContent: string): void {
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
  } else {
    console.log(chalk.green('\n✅ Validation passed! Safe to commit.'));
  }
}
