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
  agentPrompt?: string;
}

export function stateCommand(program: Command): void {
  program
    .command('state')
    .description('Show current validation state')
    .option('--format <format>', 'Output format (human|yaml|json)', 'human')
    .option('--file <path>', 'State file path', '.vibe-validate-state.yaml')
    .action(async (options) => {
      try {
        const cwd = process.cwd();
        const statePath = join(cwd, options.file);

        // Check if state file exists
        if (!existsSync(statePath)) {
          if (options.format === 'human') {
            console.log(chalk.gray('ℹ️  No validation state found'));
            console.log(chalk.gray('   Run: vibe-validate validate'));
          } else if (options.format === 'json') {
            console.log(JSON.stringify({ exists: false }, null, 2));
          } else {
            console.log('exists: false');
          }
          process.exit(0);
        }

        // Read and parse state file
        const stateContent = readFileSync(statePath, 'utf-8');
        const state = parseYaml(stateContent) as ValidationState;

        // Output based on format
        if (options.format === 'json') {
          console.log(JSON.stringify({ exists: true, ...state }, null, 2));
        } else if (options.format === 'yaml') {
          console.log(stateContent);
        } else {
          // Human-friendly format
          displayHumanState(state);
        }

        process.exit(0);
      } catch (error) {
        console.error(chalk.red('❌ Failed to read validation state:'), error);
        process.exit(1);
      }
    });
}

/**
 * Display validation state in human-friendly format
 */
function displayHumanState(state: ValidationState): void {
  console.log(chalk.blue('📊 Validation State'));
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
      console.log(chalk.red('\nError Output:'));
      console.log(chalk.gray('─'.repeat(50)));
      // Limit output to first 20 lines
      const lines = state.failedStepOutput.split('\n').slice(0, 20);
      lines.forEach(line => console.log(chalk.gray(line)));
      if (state.failedStepOutput.split('\n').length > 20) {
        console.log(chalk.gray('... (truncated)'));
      }
    }

    if (state.agentPrompt) {
      console.log(chalk.yellow('\n💡 Agent Prompt:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.gray(state.agentPrompt));
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
