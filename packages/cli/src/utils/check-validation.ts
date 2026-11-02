/**
 * Validation Status Checker
 *
 * Provides programmatic interface to check if validation has already passed
 * for the current working tree state using git notes.
 */

import { getLevels, type VibeValidateConfig } from '@vibe-validate/config';
import { findFailedStepResult, type ValidationResult } from '@vibe-validate/core';
import { getGitTreeHash } from '@vibe-validate/git';
import { findDecidingRun, readHistoryNote } from '@vibe-validate/history';
import chalk from 'chalk';

import { displayCachedResult } from './display-cached-result.js';
import { stateCommandFor, validateCommandFor } from './level-commands.js';
import { outputYamlResult } from './yaml-output.js';

// Constants (extracted to avoid duplication warnings)
const RUN_VALIDATION_HINT = '\n💡 Run validation:';

/**
 * Display information about failed phase and step
 *
 * @param phases - The validation phases from result
 */
function displayFailedPhaseInfo(result: Pick<ValidationResult, 'failedStep' | 'phases'> | undefined): void {
  const phases = result?.phases;
  if (!phases) return;

  const failedPhase = phases.find(p => !p.passed);
  if (!failedPhase) return;

  console.log(chalk.red(`\n   Failed phase: ${failedPhase.name}`));
  const failedStepName = findFailedStepResult(result, () => true)?.name ?? result.failedStep;
  if (failedStepName) {
    console.log(chalk.red(`   Failed step: ${failedStepName}`));
  }
}

/**
 * Check validation status for current working tree
 *
 * The verdict is the run that decides a cache lookup at `level` (findDecidingRun):
 * the newest run on this tree, skipping passes at earlier levels.
 *
 * Exit codes:
 *   0 = That run passed (validation at `level` would be a cache hit)
 *   1 = That run failed, at `level` or another level (fix it, then run validation)
 *   2 = Nothing recorded that bears on `level` for this tree, or not in a git repository
 *
 * @param config - vibe-validate configuration (supplies the levels in order)
 * @param level - The level to check
 * @param yaml - If true, output YAML to stdout instead of human-readable text
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 36 acceptable for validation state checking (handles multiple output formats, git state retrieval, and comprehensive error scenarios)
export async function checkValidationStatus(config: VibeValidateConfig, level: string, yaml = false): Promise<void> {
  // Get current tree hash
  let treeHashResult;
  try {
    treeHashResult = await getGitTreeHash();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (yaml) {
      // YAML mode: Output structured error
      const errorOutput = {
        exists: false,
        error: `Not in git repository: ${errorMessage}`,
      };
      await outputYamlResult(errorOutput);
    } else {
      // Human mode: Colored output
      console.log(chalk.yellow('⚠️  Not in git repository'));
      console.log(chalk.gray(`   ${errorMessage}`));
      console.log(chalk.blue(RUN_VALIDATION_HINT), chalk.white(validateCommandFor(config, level)));
    }
    process.exit(2);
  }

  // readHistoryNote returns null for a missing or unreadable note, never throws
  const note = await readHistoryNote(treeHashResult.hash);
  const decidingRun = findDecidingRun(note, treeHashResult, { level, levels: getLevels(config) });

  if (decidingRun?.passed && decidingRun.result.passed) {
    if (yaml) {
      await outputYamlResult({ ...decidingRun.result, isCachedResult: true });
    } else {
      displayCachedResult(decidingRun, treeHashResult.hash, level);
    }
    process.exit(0);
  }

  // The newest run that bears on this level failed. --check reports that record;
  // it is not a cache verdict (no isCachedResult), and `vv validate` will run the steps again.
  if (decidingRun) {
    if (yaml) {
      await outputYamlResult(decidingRun.result);
    } else {
      console.log(chalk.red(`❌ The newest run bearing on level ${level} failed for this code`));
      if (decidingRun.level !== level) {
        console.log(chalk.gray(`   It ran at level ${decidingRun.level}; a failure at any level overturns every older pass covering level ${level}`));
      }
      console.log(chalk.gray(`   Tree hash: ${treeHashResult.hash.substring(0, 12)}...`));
      console.log(chalk.gray(`   Recorded: ${decidingRun.timestamp} on branch ${decidingRun.branch}`));

      displayFailedPhaseInfo(decidingRun.result);

      console.log(chalk.blue('\n📋 View full error details:'), chalk.white(stateCommandFor(level)));
      console.log(chalk.blue('💡 Fix errors and run validation:'), chalk.white(validateCommandFor(config, level)));
    }
    process.exit(1);
  }

  // Nothing recorded that bears on this level (a pass at an earlier level answers nothing here)
  if (yaml) {
    // YAML mode: Output structured no-history response
    const noHistoryOutput = {
      exists: false,
      treeHash: treeHashResult.hash,
      level,
    };
    await outputYamlResult(noHistoryOutput);
  } else {
    // Human mode: Colored output
    console.log(chalk.yellow(`⚠️  No validation at level ${level} for current working tree`));
    console.log(chalk.gray(`   Tree hash: ${treeHashResult.hash.substring(0, 12)}...`));
    console.log(chalk.blue(RUN_VALIDATION_HINT), chalk.white(validateCommandFor(config, level)));
  }
  process.exit(2);
}
