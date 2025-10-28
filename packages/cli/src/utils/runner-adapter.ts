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
  yaml?: boolean;
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
    ? createVerboseCallbacks(options.yaml)
    : createMinimalCallbacks(options.yaml);

  return {
    phases: (config.validation?.phases ?? []) as ValidationPhase[],
    enableFailFast: true, // Default to fail-fast (individual phases can override)
    verbose: options.verbose, // Pass verbose flag to runner for output streaming
    yaml: options.yaml, // Pass yaml flag to runner for stdout/stderr routing
    developerFeedback: config.developerFeedback ?? false, // Enable extraction quality alerts for dogfooding
    env: envVars,
    ...callbacks,
  };
}

/**
 * Create verbose console callbacks (colorful, detailed progress)
 */
function createVerboseCallbacks(yaml: boolean = false): Pick<ValidationConfig, 'onPhaseStart' | 'onPhaseComplete' | 'onStepStart' | 'onStepComplete'> {
  // When yaml mode is on, write to stderr to keep stdout clean for YAML data
  const log = yaml ?
    (msg: string) => process.stderr.write(msg + '\n') :
    (msg: string) => console.log(msg);

  return {
    onPhaseStart: (phase: ValidationPhase) => {
      log(chalk.blue(`\n🔄 Running phase: ${phase.name}`));
    },
    onPhaseComplete: (phase: ValidationPhase, result: PhaseResult) => {
      if (result.passed) {
        log(chalk.green(`✅ Phase ${phase.name} completed successfully`));
      } else {
        log(chalk.red(`❌ Phase ${phase.name} failed`));
      }
    },
    onStepStart: (step: ValidationStep) => {
      log(chalk.gray(`  ⏳ ${step.name}...`));
    },
    onStepComplete: (step: ValidationStep, result: StepResult) => {
      if (result.passed) {
        log(chalk.green(`  ✅ ${step.name} (${result.durationSecs}s)`));
      } else {
        log(chalk.red(`  ❌ ${step.name} failed (${result.durationSecs}s)`));
        if (result.output) {
          log(chalk.red(`     Error: ${result.output}`));
        }
      }
    },
  };
}

/**
 * Create minimal callbacks (agent-friendly YAML output)
 */
function createMinimalCallbacks(yaml: boolean = false): Pick<ValidationConfig, 'onPhaseStart' | 'onPhaseComplete' | 'onStepStart' | 'onStepComplete'> {
  // Minimal YAML-structured progress output
  // When yaml mode is on, write to stderr to keep stdout clean for YAML data
  const log = yaml ?
    (msg: string) => process.stderr.write(msg + '\n') :
    (msg: string) => console.log(msg);

  return {
    onPhaseStart: (phase: ValidationPhase) => {
      log(`phase_start: ${phase.name}`);
    },
    onPhaseComplete: (phase: ValidationPhase, result: PhaseResult) => {
      log(`phase_complete: ${phase.name} (${result.passed ? 'passed' : 'failed'})`);
    },
    onStepStart: (step: ValidationStep) => {
      log(`  step_start: ${step.name}`);
    },
    onStepComplete: (step: ValidationStep, result: StepResult) => {
      log(`  step_complete: ${step.name} (${result.passed ? 'passed' : 'failed'}, ${result.durationSecs}s)`);
    },
  };
}
