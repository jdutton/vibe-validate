/**
 * Display Cached Result Utilities
 *
 * Shared utilities for displaying cached validation results in human-readable format.
 *
 * @package @vibe-validate/cli
 */

import type { PhaseResult } from '@vibe-validate/core';
import type { ValidationRun } from '@vibe-validate/history';
import chalk from 'chalk';

/**
 * Display cached validation result in human-readable format
 *
 * @param passingRun - The cached passing run to display
 * @param treeHash - Git tree hash (will be truncated to 12 chars)
 */
export function displayCachedResult(passingRun: ValidationRun, treeHash: string): void {
  const durationSecs = (passingRun.duration / 1000).toFixed(1);
  console.log(chalk.green('✅ Validation already passed for current working tree'));
  console.log(chalk.gray(`   Tree hash: ${treeHash.substring(0, 12)}...`));
  console.log(chalk.gray(`   Last validated: ${passingRun.timestamp}`));
  console.log(chalk.gray(`   Duration: ${durationSecs}s`));
  console.log(chalk.gray(`   Branch: ${passingRun.branch}`));

  if (passingRun.result?.phases) {
    const totalSteps = passingRun.result.phases.reduce((sum: number, phase: PhaseResult) => sum + (phase.steps?.length ?? 0), 0);
    console.log(chalk.gray(`   Phases: ${passingRun.result.phases.length}, Steps: ${totalSteps}`));
  }
}
