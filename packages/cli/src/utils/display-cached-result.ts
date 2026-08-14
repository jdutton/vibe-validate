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

import { getCommandName } from './command-name.js';

/**
 * Display cached validation result in human-readable format
 *
 * A cached FAILURE is disclosed as a replay (issue #169). Without that, a stored
 * failure is indistinguishable from one computed just now, and a user who fixed
 * the cause has no signal that the step never re-ran. Cached passes keep their
 * original wording - the happy path needs no caveat.
 *
 * @param cachedRun - The cached run to display (pass or fail)
 * @param treeHash - Git tree hash (will be truncated to 12 chars)
 */
export function displayCachedResult(cachedRun: ValidationRun, treeHash: string): void {
  const durationSecs = (cachedRun.duration / 1000).toFixed(1);
  const truncatedHash = treeHash.substring(0, 12);
  const provenance = `${cachedRun.timestamp} on branch ${cachedRun.branch}`;

  // Display status line (color and message vary by pass/fail)
  const statusLine = cachedRun.passed
    ? chalk.green('✅ Validation passed for this code')
    : chalk.red('❌ Validation failed for this code');
  console.log(statusLine);

  // Display metadata (failures disclose that nothing was re-executed)
  console.log(chalk.gray(`   Tree hash: ${truncatedHash}...`));
  console.log(chalk.gray(
    cachedRun.passed
      ? `   Validated: ${provenance}`
      : `   Replayed from ${provenance} (not re-run just now)`
  ));

  if (cachedRun.result?.phases) {
    const totalSteps = cachedRun.result.phases.reduce((sum: number, phase: PhaseResult) => sum + (phase.steps?.length ?? 0), 0);
    console.log(chalk.gray(`   Phases: ${cachedRun.result.phases.length}, Steps: ${totalSteps} (${durationSecs}s)`));
  } else {
    console.log(chalk.gray(`   Duration: ${durationSecs}s`));
  }
}

/**
 * Explain what the cache key covers, and how to re-run when it cannot see the fix
 *
 * Shown only when a FAILURE was replayed from cache - never on a fresh failure,
 * where the result was just computed and re-running would change nothing.
 *
 * The wording deliberately names the one condition the key genuinely cannot
 * observe (gitignored working-tree state, or state outside the repo) rather than
 * suggesting the cache is unreliable in general. See issue #169.
 *
 * @param write - Where to emit. Defaults to stderr, alongside displayFailureInfo,
 *   which keeps the whole "what now" block on one stream - and is the stream
 *   agents capture for the YAML failure dump. Callers that write their report to
 *   stdout (e.g. `--check`) should pass console.log so output stays on one stream.
 */
export function displayCachedFailureHint(write: (message: string) => void = console.error): void {
  const cmd = getCommandName();
  write(chalk.gray('\n   Keyed on your tracked + untracked files; ignored paths are excluded'));
  write(chalk.gray('   (.gitignore, .git/info/exclude, or your global excludes file).'));
  write(chalk.gray('   If your fix was to an ignored path or to state outside the repo, this'));
  write(chalk.gray(`   result can't see it. Re-run with: ${cmd} validate --force`));
}
