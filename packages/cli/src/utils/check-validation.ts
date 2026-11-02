/**
 * Validation Status Checker
 *
 * Provides programmatic interface to check if validation has already passed
 * for the current working tree state using git notes.
 */

import { getLevels, type VibeValidateConfig } from '@vibe-validate/config';
import { findFailedStepResult, type ValidationResult } from '@vibe-validate/core';
import { getGitTreeHash } from '@vibe-validate/git';
import { findCachedValidation, findRetryRun, readHistoryNote, type HistoryNote } from '@vibe-validate/history';
import chalk from 'chalk';

import { getCommandName } from './command-name.js';
import { displayCachedResult } from './display-cached-result.js';
import { outputYamlResult } from './yaml-output.js';

// Constants (extracted to avoid duplication warnings)
const RUN_VALIDATION_HINT = '\n💡 Run validation:';
const VALIDATE_COMMAND = 'npx vibe-validate validate';

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
 * Exit codes:
 *   0 = A pass at `level` or a later level is recorded for this tree (skip validation)
 *   1 = The last run at `level` failed (fix it, then run validation)
 *   2 = Nothing recorded at `level` for this tree, or history unreadable (run validation)
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
      console.log(chalk.blue(RUN_VALIDATION_HINT), chalk.white(VALIDATE_COMMAND));
    }
    process.exit(2);
  }

  // Read the tree's history note once; both lookups below share it
  let note: HistoryNote | null;
  try {
    note = await readHistoryNote(treeHashResult.hash);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (yaml) {
      // YAML mode: Output structured error
      const errorOutput = {
        exists: false,
        treeHash: treeHashResult.hash,
        error: `Failed to read validation history: ${errorMessage}`,
      };
      await outputYamlResult(errorOutput);
    } else {
      // Human mode: Colored output
      console.log(chalk.yellow('⚠️  Failed to read validation history'));
      console.log(chalk.blue(RUN_VALIDATION_HINT), chalk.white(VALIDATE_COMMAND));
    }
    process.exit(2);
  }

  const cachedRun = findCachedValidation(note, treeHashResult, { level, levels: getLevels(config) });
  const lastRunAtLevel = cachedRun ? null : findRetryRun(note, treeHashResult, level);

  if (cachedRun) {
    if (yaml) {
      await outputYamlResult({ ...cachedRun.result, isCachedResult: true });
    } else {
      displayCachedResult(cachedRun, treeHashResult.hash, level);
    }
    process.exit(0);
  }

  // The last run at this level failed. --check reports that record; it is not a
  // cache verdict, and `vv validate` will run the steps again.
  if (lastRunAtLevel && !lastRunAtLevel.passed) {
    if (yaml) {
      await outputYamlResult({ ...lastRunAtLevel.result, isCachedResult: true });
    } else {
      console.log(chalk.red(`❌ Last validation at level ${level} failed for this code`));
      console.log(chalk.gray(`   Tree hash: ${treeHashResult.hash.substring(0, 12)}...`));
      console.log(chalk.gray(`   Recorded: ${lastRunAtLevel.timestamp} on branch ${lastRunAtLevel.branch}`));

      displayFailedPhaseInfo(lastRunAtLevel.result);

      const cmd = getCommandName();
      console.log(chalk.blue('\n📋 View full error details:'), chalk.white(`${cmd} state`));
      console.log(chalk.blue('💡 Fix errors and run validation:'), chalk.white(`${cmd} validate`));
    }
    process.exit(1);
  }

  // Nothing recorded at this level (a pass at an earlier level answers nothing here)
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
    console.log(chalk.blue(RUN_VALIDATION_HINT), chalk.white(VALIDATE_COMMAND));
  }
  process.exit(2);
}
