/**
 * Validation Status Checker
 *
 * Provides programmatic interface to check if validation has already passed
 * for the current working tree state using git notes.
 */

import { getGitTreeHash } from '@vibe-validate/git';
import { readHistoryNote } from '@vibe-validate/history';
import type { VibeValidateConfig } from '@vibe-validate/config';
import chalk from 'chalk';

/**
 * Check validation status for current working tree
 *
 * Exit codes:
 *   0 = Validation already passed (skip validation)
 *   1 = Validation not passed or needed (run validation)
 *   2 = No history found (run validation)
 *   3 = Git tree hash changed (run validation)
 */
export async function checkValidationStatus(_config: VibeValidateConfig): Promise<void> {
  // Get current tree hash
  let currentTreeHash: string;
  try {
    currentTreeHash = await getGitTreeHash();
  } catch (_error) {
    console.log(chalk.yellow('⚠️  Not in git repository'));
    console.log(chalk.blue('\n💡 Run validation:'), chalk.white('npx vibe-validate validate'));
    process.exit(2);
  }

  // Check git notes for validation history
  let historyNote;
  try {
    historyNote = await readHistoryNote(currentTreeHash);
  } catch (_error) {
    console.log(chalk.yellow('⚠️  Failed to read validation history'));
    console.log(chalk.blue('\n💡 Run validation:'), chalk.white('npx vibe-validate validate'));
    process.exit(2);
  }

  // Check if history exists
  if (!historyNote || historyNote.runs.length === 0) {
    console.log(chalk.yellow('⚠️  No validation history for current working tree'));
    console.log(chalk.gray(`   Tree hash: ${currentTreeHash.substring(0, 12)}...`));
    console.log(chalk.blue('\n💡 Run validation:'), chalk.white('npx vibe-validate validate'));
    process.exit(2);
  }

  // Find most recent passing run
  const passingRun = [...historyNote.runs].reverse().find(run => run.passed);

  if (!passingRun) {
    console.log(chalk.red('❌ Last validation failed'));
    console.log(chalk.gray(`   Tree hash: ${currentTreeHash.substring(0, 12)}...`));

    const mostRecent = historyNote.runs[historyNote.runs.length - 1];
    console.log(chalk.gray(`   Last validated: ${mostRecent.timestamp}`));
    console.log(chalk.gray(`   Branch: ${mostRecent.branch}`));

    console.log(chalk.blue('\n💡 Fix errors and run validation:'), chalk.white('npx vibe-validate validate'));
    process.exit(1);
  }

  // Validation passed!
  console.log(chalk.green('✅ Validation already passed for current working tree'));
  console.log(chalk.gray(`   Tree hash: ${currentTreeHash.substring(0, 12)}...`));
  console.log(chalk.gray(`   Last validated: ${passingRun.timestamp}`));
  console.log(chalk.gray(`   Duration: ${passingRun.duration}ms`));
  console.log(chalk.gray(`   Branch: ${passingRun.branch}`));

  if (passingRun.result?.phases) {
    const totalSteps = passingRun.result.phases.reduce((sum, phase) => sum + (phase.steps?.length || 0), 0);
    console.log(chalk.gray(`   Phases: ${passingRun.result.phases.length}, Steps: ${totalSteps}`));
  }

  process.exit(0);
}
