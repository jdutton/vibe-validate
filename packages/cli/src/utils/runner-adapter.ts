/**
 * Runner Adapter
 *
 * Adapts structured VibeValidateConfig to ValidationConfig for the core runner.
 */

import type { VibeValidateConfig } from '@vibe-validate/config';
import type { ValidationConfig, ValidationPhase, ValidationStep, PhaseResult, StepResult } from '@vibe-validate/core';
import type { AgentContext } from './context-detector.js';
import chalk from 'chalk';

export interface RunnerOptions {
  force?: boolean;
  verbose: boolean;
  context: AgentContext;
}

/**
 * Create a runner configuration from loaded config
 *
 * @param config Loaded vibe-validate configuration
 * @param options Runner options (force, format, context)
 * @returns ValidationConfig ready for the runner
 */
export function createRunnerConfig(
  config: VibeValidateConfig,
  options: RunnerOptions
): ValidationConfig {
  // Convert process.env to Record<string, string> by filtering out undefined values
  const envVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      envVars[key] = value;
    }
  }

  // Choose callbacks based on verbosity
  const callbacks = options.verbose
    ? createVerboseCallbacks()
    : createMinimalCallbacks();

  return {
    phases: config.validation?.phases || [],
    enableFailFast: true, // Default to fail-fast (individual phases can override)
    forceRun: options.force, // Pass force flag to runner
    verbose: options.verbose, // Pass verbose flag to runner for output streaming
    env: envVars,
    stateFilePath: '.vibe-validate-state.yaml',
    ...callbacks,
  };
}

/**
 * Create verbose console callbacks (colorful, detailed progress)
 */
function createVerboseCallbacks() {
  return {
    onPhaseStart: (phase: ValidationPhase) => {
      console.log(chalk.blue(`\n🔄 Running phase: ${phase.name}`));
    },
    onPhaseComplete: (phase: ValidationPhase, result: PhaseResult) => {
      if (result.passed) {
        console.log(chalk.green(`✅ Phase ${phase.name} completed successfully`));
      } else {
        console.log(chalk.red(`❌ Phase ${phase.name} failed`));
      }
    },
    onStepStart: (step: ValidationStep) => {
      console.log(chalk.gray(`  ⏳ ${step.name}...`));
    },
    onStepComplete: (step: ValidationStep, result: StepResult) => {
      if (result.passed) {
        console.log(chalk.green(`  ✅ ${step.name} (${result.durationSecs}s)`));
      } else {
        console.log(chalk.red(`  ❌ ${step.name} failed (${result.durationSecs}s)`));
        if (result.output) {
          console.log(chalk.red(`     Error: ${result.output}`));
        }
      }
    },
  };
}

/**
 * Create minimal callbacks (agent-friendly YAML output)
 */
function createMinimalCallbacks() {
  // Minimal YAML-structured progress output
  return {
    onPhaseStart: (phase: ValidationPhase) => {
      console.log(`phase_start: ${phase.name}`);
    },
    onPhaseComplete: (phase: ValidationPhase, result: PhaseResult) => {
      console.log(`phase_complete: ${phase.name} (${result.passed ? 'passed' : 'failed'})`);
    },
    onStepStart: (step: ValidationStep) => {
      console.log(`  step_start: ${step.name}`);
    },
    onStepComplete: (step: ValidationStep, result: StepResult) => {
      console.log(`  step_complete: ${step.name} (${result.passed ? 'passed' : 'failed'}, ${result.durationSecs}s)`);
    },
  };
}
