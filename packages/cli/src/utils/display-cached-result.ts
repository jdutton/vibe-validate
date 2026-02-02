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
 * @param cachedRun - The cached run to display (pass or fail)
 * @param treeHash - Git tree hash (will be truncated to 12 chars)
 */
export function displayCachedResult(cachedRun: ValidationRun, treeHash: string): void {
  const durationSecs = (cachedRun.duration / 1000).toFixed(1);

  if (cachedRun.passed) {
    console.log(chalk.green('✅ Validation already passed for current working tree'));
  } else {
    console.log(chalk.red('❌ Validation already failed for current working tree'));
  }

  console.log(chalk.gray(`   Tree hash: ${treeHash.substring(0, 12)}...`));
  console.log(chalk.gray(`   Last validated: ${cachedRun.timestamp}`));
  console.log(chalk.gray(`   Duration: ${durationSecs}s`));
  console.log(chalk.gray(`   Branch: ${cachedRun.branch}`));

  if (cachedRun.result?.phases) {
    const totalSteps = cachedRun.result.phases.reduce((sum: number, phase: PhaseResult) => sum + (phase.steps?.length ?? 0), 0);
    console.log(chalk.gray(`   Phases: ${cachedRun.result.phases.length}, Steps: ${totalSteps}`));
  }
}
