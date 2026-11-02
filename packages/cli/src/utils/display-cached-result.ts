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
 * Display a cached PASS in human-readable format
 *
 * Only passes are ever served from cache, so this always reports one.
 *
 * @param cachedRun - The cached passing run
 * @param treeHash - Git tree hash (will be truncated to 12 chars)
 * @param requestedLevel - The level asked for; a later level's pass answers it
 */
export function displayCachedResult(cachedRun: ValidationRun, treeHash: string, requestedLevel: string): void {
  const durationSecs = (cachedRun.duration / 1000).toFixed(1);
  const truncatedHash = treeHash.substring(0, 12);
  const covers = cachedRun.level === requestedLevel ? '' : ` (covers ${requestedLevel})`;

  console.log(chalk.green('✅ Validation passed for this code'));
  console.log(chalk.gray(`   Tree hash: ${truncatedHash}...`));
  console.log(chalk.gray(`   Level: ${cachedRun.level}${covers}`));
  console.log(chalk.gray(`   Validated: ${cachedRun.timestamp} on branch ${cachedRun.branch}`));

  if (cachedRun.result?.phases) {
    const totalSteps = cachedRun.result.phases.reduce((sum: number, phase: PhaseResult) => sum + (phase.steps?.length ?? 0), 0);
    console.log(chalk.gray(`   Phases: ${cachedRun.result.phases.length}, Steps: ${totalSteps} (${durationSecs}s)`));
  } else {
    console.log(chalk.gray(`   Duration: ${durationSecs}s`));
  }
}
