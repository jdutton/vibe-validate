/**
 * Validation Status Checker
 *
 * Provides programmatic interface to check if validation has already passed
 * for the current working tree state, without exposing state file implementation details.
 */

import { existsSync, readFileSync } from 'fs';
import { getGitTreeHash } from '@vibe-validate/git';
import type { VibeValidateConfig } from '@vibe-validate/config';
import type { ValidationResult } from '@vibe-validate/core';
import chalk from 'chalk';
import yaml from 'yaml';

/**
 * Check validation status for current working tree
 *
 * Exit codes:
 *   0 = Validation already passed (skip validation)
 *   1 = Validation not passed or needed (run validation)
 *   2 = State file missing (run validation)
 *   3 = Git tree hash mismatch (run validation)
 */
export async function checkValidationStatus(config: VibeValidateConfig): Promise<void> {
  const stateFilePath = config.validation.caching?.statePath || '.vibe-validate-state.yaml';

  // Check if state file exists
  if (!existsSync(stateFilePath)) {
    console.log(chalk.yellow('⚠️  Validation state file not found'));
    console.log(chalk.gray(`   Expected: ${stateFilePath}`));
    console.log(chalk.blue('\n💡 Run validation:'), chalk.white('npx vibe-validate validate'));
    process.exit(2);
  }

  // Get current tree hash
  const currentTreeHash = await getGitTreeHash();

  // Read state file
  let state: ValidationResult;
  try {
    const content = readFileSync(stateFilePath, 'utf8');

    // Try parsing as YAML first (CLI default), fallback to JSON
    try {
      state = yaml.parse(content) as ValidationResult;
    } catch {
      state = JSON.parse(content) as ValidationResult;
    }
  } catch (error) {
    console.error(chalk.red('❌ Failed to parse validation state file'));
    console.error(chalk.gray(`   File: ${stateFilePath}`));
    console.error(chalk.gray(`   Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(2);
  }

  // Check if tree hash matches
  if (state.treeHash !== currentTreeHash) {
    console.log(chalk.yellow('⚠️  Working tree has changed since last validation'));
    console.log(chalk.gray(`   Last validated:  ${state.treeHash.substring(0, 12)}...`));
    console.log(chalk.gray(`   Current state:   ${currentTreeHash.substring(0, 12)}...`));
    console.log(chalk.blue('\n💡 Run validation:'), chalk.white('npx vibe-validate validate'));
    process.exit(3);
  }

  // Check if validation passed
  if (!state.passed) {
    console.log(chalk.red('❌ Last validation failed'));
    console.log(chalk.gray(`   Tree hash: ${state.treeHash.substring(0, 12)}...`));
    console.log(chalk.gray(`   Last validated: ${state.timestamp}`));
    if (state.failedStep) {
      console.log(chalk.gray(`   Failed step: ${state.failedStep}`));
    }
    console.log(chalk.blue('\n💡 Fix errors and run validation:'), chalk.white('npx vibe-validate validate'));
    process.exit(1);
  }

  // Validation passed!
  console.log(chalk.green('✅ Validation already passed for current working tree'));
  console.log(chalk.gray(`   Tree hash: ${state.treeHash.substring(0, 12)}...`));
  console.log(chalk.gray(`   Last validated: ${state.timestamp}`));

  if (state.phases) {
    const totalSteps = state.phases.reduce((sum, phase) => sum + (phase.steps?.length || 0), 0);
    console.log(chalk.gray(`   Phases: ${state.phases.length}, Steps: ${totalSteps}`));
  }

  process.exit(0);
}
