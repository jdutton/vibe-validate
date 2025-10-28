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
import { stringify as yamlStringify } from 'yaml';

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
  let currentTreeHash: string;
  try {
    currentTreeHash = await getGitTreeHash();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (yaml) {
      // YAML mode: Output structured error
      const errorOutput = {
        exists: false,
        error: `Not in git repository: ${errorMessage}`,
      };
      process.stdout.write('---\n');
      process.stdout.write(yamlStringify(errorOutput));
    } else {
      // Human mode: Colored output
      console.log(chalk.yellow('⚠️  Not in git repository'));
      console.log(chalk.gray(`   ${errorMessage}`));
      console.log(chalk.blue('\n💡 Run validation:'), chalk.white('npx vibe-validate validate'));
    }
    process.exit(2);
  }

  // Check git notes for validation history
  let historyNote;
  try {
    historyNote = await readHistoryNote(currentTreeHash);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (yaml) {
      // YAML mode: Output structured error
      const errorOutput = {
        exists: false,
        treeHash: currentTreeHash,
        error: `Failed to read validation history: ${errorMessage}`,
      };
      process.stdout.write('---\n');
      process.stdout.write(yamlStringify(errorOutput));
    } else {
      // Human mode: Colored output
      console.log(chalk.yellow('⚠️  Failed to read validation history'));
      console.log(chalk.blue('\n💡 Run validation:'), chalk.white('npx vibe-validate validate'));
    }
    process.exit(2);
  }

  // Check if history exists
  if (!historyNote || historyNote.runs.length === 0) {
    if (yaml) {
      // YAML mode: Output structured no-history response
      const noHistoryOutput = {
        exists: false,
        treeHash: currentTreeHash,
      };
      process.stdout.write('---\n');
      process.stdout.write(yamlStringify(noHistoryOutput));
    } else {
      // Human mode: Colored output
      console.log(chalk.yellow('⚠️  No validation history for current working tree'));
      console.log(chalk.gray(`   Tree hash: ${currentTreeHash.substring(0, 12)}...`));
      console.log(chalk.blue('\n💡 Run validation:'), chalk.white('npx vibe-validate validate'));
    }
    process.exit(2);
  }

  // Find most recent passing run
  const passingRun = [...historyNote.runs].reverse().find(run => run.passed);

  if (!passingRun) {
    // Last validation failed - show error details (same as fresh failure)
    const mostRecent = historyNote.runs[historyNote.runs.length - 1];

    if (yaml) {
      // YAML mode: Output failed result as YAML to stdout
      process.stdout.write('---\n');
      process.stdout.write(yamlStringify(mostRecent.result));

      // Wait for stdout to flush before exiting
      await new Promise<void>(resolve => {
        if (process.stdout.write('')) {
          resolve();
        } else {
          process.stdout.once('drain', resolve);
        }
      });
    } else {
      // Human-readable mode: Display failure details
      console.log(chalk.red('❌ Last validation failed for current working tree'));
      console.log(chalk.gray(`   Tree hash: ${currentTreeHash.substring(0, 12)}...`));
      console.log(chalk.gray(`   Last validated: ${mostRecent.timestamp}`));
      console.log(chalk.gray(`   Branch: ${mostRecent.branch}`));

      // Show which phase/step failed (actionable info)
      if (mostRecent.result?.phases) {
        const failedPhase = mostRecent.result.phases.find(p => !p.passed);
        if (failedPhase) {
          console.log(chalk.red(`\n   Failed phase: ${failedPhase.name}`));
          const failedStep = failedPhase.steps?.find(s => !s.passed);
          if (failedStep) {
            console.log(chalk.red(`   Failed step: ${failedStep.name}`));
          }
        }
      }

      console.log(chalk.blue('\n📋 View full error details:'), chalk.white('vibe-validate state'));
      console.log(chalk.blue('💡 Fix errors and run validation:'), chalk.white('npx vibe-validate validate'));
    }

    process.exit(1);
  }

  // Validation passed!
  if (yaml) {
    // YAML mode: Output validation result as YAML to stdout
    process.stdout.write('---\n');
    process.stdout.write(yamlStringify(passingRun.result));

    // Wait for stdout to flush before exiting
    await new Promise<void>(resolve => {
      if (process.stdout.write('')) {
        resolve();
      } else {
        process.stdout.once('drain', resolve);
      }
    });
  } else {
    // Human-readable mode: Display status message
    const durationSecs = (passingRun.duration / 1000).toFixed(1);
    console.log(chalk.green('✅ Validation already passed for current working tree'));
    console.log(chalk.gray(`   Tree hash: ${currentTreeHash.substring(0, 12)}...`));
    console.log(chalk.gray(`   Last validated: ${passingRun.timestamp}`));
    console.log(chalk.gray(`   Duration: ${durationSecs}s`));
    console.log(chalk.gray(`   Branch: ${passingRun.branch}`));

    if (passingRun.result?.phases) {
      const totalSteps = passingRun.result.phases.reduce((sum, phase) => sum + (phase.steps?.length ?? 0), 0);
      console.log(chalk.gray(`   Phases: ${passingRun.result.phases.length}, Steps: ${totalSteps}`));
    }
  }

  process.exit(0);
}
