/**
 * Validation Status Checker
 *
 * Provides programmatic interface to check if validation has already passed
 * for the current working tree state using git notes.
 */

import type { VibeValidateConfig } from '@vibe-validate/config';
import { getGitTreeHash } from '@vibe-validate/git';
import { findCachedValidation } from '@vibe-validate/history';
import chalk from 'chalk';

import { getCommandName } from './command-name.js';
import { displayCachedFailureHint, displayCachedResult } from './display-cached-result.js';
import { outputYamlResult } from './yaml-output.js';

// Constants (extracted to avoid duplication warnings)
const RUN_VALIDATION_HINT = '\n💡 Run validation:';
const VALIDATE_COMMAND = 'npx vibe-validate validate';

/**
 * Display information about failed phase and step
 *
 * @param phases - The validation phases from result
 */
function displayFailedPhaseInfo(phases: Array<{ name: string; passed: boolean; steps?: Array<{ name: string; passed: boolean }> }> | undefined): void {
  if (!phases) return;

  const failedPhase = phases.find(p => !p.passed);
  if (!failedPhase) return;

  console.log(chalk.red(`\n   Failed phase: ${failedPhase.name}`));
  const failedStep = failedPhase.steps?.find(s => !s.passed);
  if (failedStep) {
    console.log(chalk.red(`   Failed step: ${failedStep.name}`));
  }
}

/**
 * Check validation status for current working tree
 *
 * Exit codes:
 *   0 = Validation already passed (skip validation)
 *   1 = Validation not passed or needed (run validation)
 *   2 = No history found (run validation)
 *   3 = Git tree hash changed (run validation)
 *
 * @param _config - vibe-validate configuration (unused, kept for API compatibility)
 * @param yaml - If true, output YAML to stdout instead of human-readable text
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 36 acceptable for validation state checking (handles multiple output formats, git state retrieval, and comprehensive error scenarios)
export async function checkValidationStatus(_config: VibeValidateConfig, yaml = false): Promise<void> {
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

  // Check for cached validation using submodule-aware lookup
  let cachedRun;
  try {
    cachedRun = await findCachedValidation(treeHashResult);
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

  // Check if history exists
  if (!cachedRun) {
    if (yaml) {
      // YAML mode: Output structured no-history response
      const noHistoryOutput = {
        exists: false,
        treeHash: treeHashResult.hash,
      };
      await outputYamlResult(noHistoryOutput);
    } else {
      // Human mode: Colored output
      console.log(chalk.yellow('⚠️  No validation history for current working tree'));
      console.log(chalk.gray(`   Tree hash: ${treeHashResult.hash.substring(0, 12)}...`));
      console.log(chalk.blue(RUN_VALIDATION_HINT), chalk.white(VALIDATE_COMMAND));
    }
    process.exit(2);
  }

  // Check if validation passed or failed
  if (!cachedRun.passed) {
    // Last validation failed - show error details (same as fresh failure)
    if (yaml) {
      // YAML mode: Output failed result as YAML to stdout.
      // --check only ever reports a stored result, so flag its provenance the same
      // way the validate workflow does - otherwise an agent parsing this sees a bare
      // failure with no way to tell it was not just computed (issue #169).
      await outputYamlResult({ ...cachedRun.result, isCachedResult: true });
    } else {
      // Human-readable mode: Display failure details
      displayCachedResult(cachedRun, treeHashResult.hash);

      // Show which phase/step failed (actionable info)
      displayFailedPhaseInfo(cachedRun.result?.phases);

      const cmd = getCommandName();
      console.log(chalk.blue('\n📋 View full error details:'), chalk.white(`${cmd} state`));
      console.log(chalk.blue('💡 Fix errors and run validation:'), chalk.white(`${cmd} validate`));

      // --check never runs validation, so this verdict is always a replay (issue #169)
      displayCachedFailureHint(console.log);
    }

    process.exit(1);
  }

  // Validation passed!
  if (yaml) {
    // YAML mode: Output validation result as YAML to stdout
    await outputYamlResult(cachedRun.result);
  } else {
    // Human-readable mode: Display status message
    displayCachedResult(cachedRun, treeHashResult.hash);
  }

  process.exit(0);
}
