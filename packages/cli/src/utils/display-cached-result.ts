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
  const truncatedHash = treeHash.substring(0, 12);

  // Display status line (color and message vary by pass/fail)
  const statusLine = cachedRun.passed
    ? chalk.green('✅ Validation passed for this code')
    : chalk.red('❌ Validation failed for this code');
  console.log(statusLine);

  // Display metadata (same format for both pass and fail)
  console.log(chalk.gray(`   Tree hash: ${truncatedHash}...`));
  console.log(chalk.gray(`   Validated: ${cachedRun.timestamp} on branch ${cachedRun.branch}`));

  if (cachedRun.result?.phases) {
    const totalSteps = cachedRun.result.phases.reduce((sum: number, phase: PhaseResult) => sum + (phase.steps?.length ?? 0), 0);
    console.log(chalk.gray(`   Phases: ${cachedRun.result.phases.length}, Steps: ${totalSteps} (${durationSecs}s)`));
  } else {
    console.log(chalk.gray(`   Duration: ${durationSecs}s`));
  }
}
