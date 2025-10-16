/**
 * Validation Runner - Core validation orchestration with state caching
 *
 * This module provides the core validation engine that:
 * 1. Executes validation steps in parallel for speed
 * 2. Tracks state using git tree hashes for caching
 * 3. Provides fail-fast execution with proper cleanup
 * 4. Handles signals (SIGTERM/SIGINT) gracefully
 *
 * @packageDocumentation
 */

import { spawn, execSync } from 'child_process';
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import { stopProcessGroup } from './process-utils.js';
import type {
  ValidationStep,
  ValidationResult,
  ValidationConfig,
  StepResult,
  PhaseResult,
} from './types.js';

/**
 * Git tree hash calculator
 *
 * IMPORTANT: Current implementation uses `git stash create` which includes timestamps.
 * This makes hashes non-deterministic - identical code produces different hashes.
 *
 * TODO: Replace with deterministic git write-tree approach:
 *   git add --intent-to-add .  # Mark untracked (no staging)
 *   git write-tree              # Content-based hash (no timestamps)
 *   git reset                   # Restore index
 *
 * @returns SHA-1 hash representing working tree state (currently non-deterministic)
 */
export function getWorkingTreeHash(): string {
  try {
    // Use git stash create to include ALL working tree changes
    // WARNING: This creates commit objects with timestamps (non-deterministic)
    const stashHash = execSync('git stash create', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    // If no changes, fall back to HEAD tree
    if (!stashHash) {
      return execSync('git rev-parse HEAD^{tree}', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
    }

    // Extract tree hash from stash commit
    return execSync(`git rev-parse ${stashHash}^{tree}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
  } catch (error) {
    // Fallback for non-git repos or git command failures
    return `nogit-${Date.now()}`;
  }
}

/**
 * Check if validation has already passed for current working tree state
 */
export function checkExistingValidation(
  currentTreeHash: string,
  stateFilePath: string
): { alreadyPassed: boolean; previousState?: ValidationResult } {
  if (!existsSync(stateFilePath)) {
    return { alreadyPassed: false };
  }

  try {
    const content = readFileSync(stateFilePath, 'utf8');
    // Parse as JSON (will support YAML in CLI package)
    const state = JSON.parse(content) as ValidationResult;

    // Check if validation passed and tree hash matches
    if (state.passed && state.treeHash === currentTreeHash) {
      return { alreadyPassed: true, previousState: state };
    }

    return { alreadyPassed: false, previousState: state };
  } catch (error) {
    return { alreadyPassed: false };
  }
}

/**
 * Parse test output to extract specific failures
 * This is a basic implementation - formatters package will have more sophisticated parsing
 */
export function parseFailures(output: string): string[] {
  const failures: string[] = [];

  // Vitest test failures - extract test names
  const vitestFailures = output.match(/❌ .+/g);
  if (vitestFailures) {
    failures.push(...vitestFailures.slice(0, 10)); // Limit to first 10
  }

  // TypeScript errors - extract file:line
  const tsErrors = output.match(/[^(]+\(\d+,\d+\): error TS\d+:.+/g);
  if (tsErrors) {
    failures.push(...tsErrors.slice(0, 10).map(e => e.trim()));
  }

  // ESLint errors - extract file:line
  const eslintErrors = output.match(/\S+\.ts\(\d+,\d+\): .+/g);
  if (eslintErrors) {
    failures.push(...eslintErrors.slice(0, 10).map(e => e.trim()));
  }

  return failures;
}

/**
 * Run validation steps in parallel with smart fail-fast
 *
 * @param steps - Array of validation steps to execute
 * @param phaseName - Name of the current phase (for logging)
 * @param logPath - Path to log file for output capture
 * @param enableFailFast - If true, kills remaining processes on first failure
 * @param env - Environment variables to pass to child processes
 */
export async function runStepsInParallel(
  steps: ValidationStep[],
  phaseName: string,
  enableFailFast: boolean = false,
  env: Record<string, string> = {}
): Promise<{
  success: boolean;
  failedStep?: ValidationStep;
  outputs: Map<string, string>;
  stepResults: StepResult[];
}> {
  console.log(`\n🔍 Running ${phaseName} (${steps.length} steps in parallel)...`);

  // Find longest step name for alignment
  const maxNameLength = Math.max(...steps.map(s => s.name.length));

  const outputs = new Map<string, string>();
  const stepResults: StepResult[] = [];
  const processes: Array<{ proc: any; step: ValidationStep }> = [];
  let firstFailure: { step: ValidationStep; output: string } | null = null;

  const results = await Promise.allSettled(
    steps.map(step =>
      new Promise<{ step: ValidationStep; output: string; duration: number }>((resolve, reject) => {
        const paddedName = step.name.padEnd(maxNameLength);
        console.log(`   ⏳ ${paddedName}  →  ${step.command}`);

        const startTime = Date.now();
        const proc = spawn('sh', ['-c', step.command], {
          stdio: 'pipe',
          detached: true,  // Create new process group for easier cleanup
          env: {
            ...process.env,
            ...env,
          }
        });

        // Track process for potential kill
        processes.push({ proc, step });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => { stdout += data.toString(); });
        proc.stderr.on('data', data => { stderr += data.toString(); });

        proc.on('close', code => {
          const duration = Date.now() - startTime;
          const output = stdout + stderr;
          outputs.set(step.name, output);

          const durationSec = (duration / 1000).toFixed(1);
          const status = code === 0 ? '✅' : '❌';
          const result = code === 0 ? 'PASSED' : 'FAILED';
          console.log(`      ${status} ${step.name.padEnd(maxNameLength)} - ${result} (${durationSec}s)`);

          stepResults.push({ name: step.name, passed: code === 0, duration });

          if (code === 0) {
            resolve({ step, output, duration });
          } else {
            // On first failure, kill other processes if fail-fast enabled
            if (enableFailFast && !firstFailure) {
              firstFailure = { step, output };
              console.log(`\n⚠️  Fail-fast enabled: Killing remaining processes...`);

              // Kill all other running processes
              for (const { proc: otherProc, step: otherStep } of processes) {
                if (otherStep !== step && otherProc.exitCode === null) {
                  stopProcessGroup(otherProc, otherStep.name).catch(() => {
                    // Process may have already exited, ignore errors
                  });
                }
              }
            }
            reject({ step, output, duration });
          }
        });
      })
    )
  );

  // Check for failures
  for (const result of results) {
    if (result.status === 'rejected') {
      const { step } = result.reason;
      return { success: false, failedStep: step, outputs, stepResults };
    }
  }

  return { success: true, outputs, stepResults };
}

/**
 * Validation runner with state tracking and caching
 *
 * Main entry point for running validation with git tree hash caching
 */
export async function runValidation(config: ValidationConfig): Promise<ValidationResult> {
  const {
    phases,
    stateFilePath = '.validate-state.json',
    logPath = `/tmp/validation-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
    enableFailFast = false,
    forceRun = false,
    env = {},
    onPhaseStart,
    onPhaseComplete,
  } = config;

  // Get current working tree hash
  const currentTreeHash = getWorkingTreeHash();

  // Check if validation already passed for this exact code state
  if (!forceRun) {
    const { alreadyPassed, previousState } = checkExistingValidation(currentTreeHash, stateFilePath);

    if (alreadyPassed && previousState) {
      console.log('✅ Validation already passed for current working tree state');
      console.log(`   Tree hash: ${currentTreeHash.substring(0, 12)}...`);
      console.log(`   Last validated: ${previousState.timestamp}`);
      return previousState;
    }
  }

  // Initialize log file
  writeFileSync(logPath, `Validation started at ${new Date().toISOString()}\n\n`);

  let fullOutput = '';
  let failedStep: ValidationStep | null = null;
  const phaseResults: PhaseResult[] = [];

  // Run each phase
  for (const phase of phases) {
    if (onPhaseStart) {
      onPhaseStart(phase);
    }

    const phaseStartTime = Date.now();
    const result = await runStepsInParallel(
      phase.steps,
      phase.name,
      enableFailFast,
      env
    );
    const phaseDuration = Date.now() - phaseStartTime;

    // Append all outputs to log file
    for (const [stepName, output] of result.outputs) {
      appendFileSync(logPath, `\n${'='.repeat(60)}\n`);
      appendFileSync(logPath, `${stepName}${result.failedStep?.name === stepName ? ' - FAILED' : ''}\n`);
      appendFileSync(logPath, `${'='.repeat(60)}\n`);
      appendFileSync(logPath, output);
      fullOutput += output;
    }

    // Record phase result
    const phaseResult: PhaseResult = {
      name: phase.name,
      duration: phaseDuration,
      passed: result.success,
      steps: result.stepResults,
    };

    // If phase failed, include output
    if (!result.success && result.failedStep) {
      phaseResult.output = result.outputs.get(result.failedStep.name);
    }

    phaseResults.push(phaseResult);

    if (onPhaseComplete) {
      onPhaseComplete(phase, phaseResult);
    }

    // If phase failed, stop here
    if (!result.success && result.failedStep) {
      failedStep = result.failedStep;

      const failedOutput = result.outputs.get(failedStep.name) || '';
      const failures = parseFailures(failedOutput);

      const validationResult: ValidationResult = {
        passed: false,
        timestamp: new Date().toISOString(),
        treeHash: currentTreeHash,
        phases: phaseResults,
        failedStep: failedStep.name,
        rerunCommand: failedStep.command,
        failedStepOutput: failedOutput,
        failedTests: failures.length > 0 ? failures : undefined,
        fullLogFile: logPath,
      };

      // Write state file
      writeFileSync(stateFilePath, JSON.stringify(validationResult, null, 2));

      return validationResult;
    }
  }

  // All steps passed!
  const validationResult: ValidationResult = {
    passed: true,
    timestamp: new Date().toISOString(),
    treeHash: currentTreeHash,
    phases: phaseResults,
    fullLogFile: logPath,
  };

  // Write state file
  writeFileSync(stateFilePath, JSON.stringify(validationResult, null, 2));

  return validationResult;
}

/**
 * Setup signal handlers for graceful cleanup
 *
 * Ensures all child processes are killed when validation runner is interrupted
 */
export function setupSignalHandlers(activeProcesses: Set<any>): void {
  const cleanup = async (signal: string) => {
    console.log(`\n⚠️  Received ${signal}, cleaning up ${activeProcesses.size} active processes...`);

    // Kill all active processes
    const cleanupPromises = Array.from(activeProcesses).map(proc =>
      stopProcessGroup(proc, 'Validation step')
    );

    await Promise.all(cleanupPromises);
    process.exit(1);
  };

  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('SIGINT', () => cleanup('SIGINT'));
}
