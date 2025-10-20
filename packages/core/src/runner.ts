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

import { spawn, type ChildProcess } from 'child_process';
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { getGitTreeHash } from '@vibe-validate/git';
import { stopProcessGroup } from './process-utils.js';
import type {
  ValidationStep,
  ValidationResult,
  ValidationConfig,
  StepResult,
  PhaseResult,
} from './types.js';

/**
 * Legacy function - REMOVED in favor of @vibe-validate/git package
 *
 * Use `getGitTreeHash()` from '@vibe-validate/git' instead.
 * This provides deterministic, content-based tree hashing.
 *
 * @deprecated Removed in v0.9.11 - Use @vibe-validate/git instead
 */

/**
 * Check if validation has already passed for current working tree state
 *
 * Reads the validation state file and compares the git tree hash to determine
 * if validation can be skipped (cache hit).
 *
 * @param currentTreeHash - Current git tree hash of working directory
 * @param stateFilePath - Path to validation state file
 * @returns Object with alreadyPassed flag and optional previousState
 *
 * @example
 * ```typescript
 * const { alreadyPassed, previousState } = checkExistingValidation(
 *   'abc123...',
 *   '.validate-state.json'
 * );
 *
 * if (alreadyPassed) {
 *   console.log('Validation already passed!');
 *   return previousState;
 * }
 * ```
 *
 * @public
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
    // Parse as YAML (JSON is valid YAML, so this handles both)
    const state = yamlParse(content) as ValidationResult;

    // Check if validation passed and tree hash matches
    if (state.passed && state.treeHash === currentTreeHash) {
      return { alreadyPassed: true, previousState: state };
    }

    return { alreadyPassed: false, previousState: state };
  } catch (_error) {
    return { alreadyPassed: false };
  }
}

/**
 * Parse test output to extract specific failures
 *
 * Extracts failure details from validation step output using pattern matching.
 * Supports Vitest, TypeScript, and ESLint error formats.
 *
 * Note: This is a basic implementation - the formatters package provides
 * more sophisticated parsing with tool-specific formatters.
 *
 * @param output - Raw stdout/stderr output from validation step
 * @returns Array of extracted failure messages (max 10 per failure type)
 *
 * @example
 * ```typescript
 * const output = `
 *   ❌ should validate user input
 *   src/user.ts(42,10): error TS2345: Argument type mismatch
 * `;
 *
 * const failures = parseFailures(output);
 * // ['❌ should validate user input', 'src/user.ts(42,10): error TS2345: ...']
 * ```
 *
 * @public
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
 * Executes multiple validation steps concurrently, capturing output and
 * providing fail-fast termination if enabled. Each step runs in its own
 * detached process group for clean termination.
 *
 * @param steps - Array of validation steps to execute in parallel
 * @param phaseName - Human-readable phase name for logging
 * @param enableFailFast - If true, kills remaining processes on first failure
 * @param env - Additional environment variables for child processes
 * @returns Promise resolving to execution results with outputs and step results
 *
 * @example
 * ```typescript
 * const result = await runStepsInParallel(
 *   [
 *     { name: 'TypeScript', command: 'pnpm typecheck' },
 *     { name: 'ESLint', command: 'pnpm lint' },
 *   ],
 *   'Pre-Qualification',
 *   true,  // Enable fail-fast
 *   { NODE_ENV: 'test' }
 * );
 *
 * if (!result.success) {
 *   console.error(`Step ${result.failedStep?.name} failed`);
 * }
 * ```
 *
 * @public
 */
export async function runStepsInParallel(
  steps: ValidationStep[],
  phaseName: string,
  enableFailFast: boolean = false,
  env: Record<string, string> = {},
  verbose: boolean = false
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
  const processes: Array<{ proc: ChildProcess; step: ValidationStep }> = [];
  let firstFailure: { step: ValidationStep; output: string } | null = null;

  const results = await Promise.allSettled(
    steps.map(step =>
      new Promise<{ step: ValidationStep; output: string; durationSecs: number }>((resolve, reject) => {
        const paddedName = step.name.padEnd(maxNameLength);
        console.log(`   ⏳ ${paddedName}  →  ${step.command}`);

        const startTime = Date.now();
        // Use shell: true for cross-platform compatibility
        // Node.js automatically selects cmd.exe on Windows, sh on Unix
        const proc = spawn(step.command, [], {
          stdio: 'pipe',
          shell: true,  // Cross-platform: cmd.exe on Windows, sh on Unix
          // detached: true only on Unix - Windows doesn't pipe stdio correctly when detached
          detached: process.platform !== 'win32',
          env: {
            ...process.env,
            ...env,
          }
        });

        // Track process for potential kill
        processes.push({ proc, step });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => {
          const chunk = data.toString();
          stdout += chunk;
          // Stream output in real-time when verbose mode is enabled
          if (verbose) {
            process.stdout.write(chunk);
          }
        });
        proc.stderr.on('data', data => {
          const chunk = data.toString();
          stderr += chunk;
          // Stream errors in real-time when verbose mode is enabled
          if (verbose) {
            process.stderr.write(chunk);
          }
        });

        proc.on('close', code => {
          const durationMs = Date.now() - startTime;
          const durationSecs = parseFloat((durationMs / 1000).toFixed(1));
          const output = stdout + stderr;
          outputs.set(step.name, output);

          const status = code === 0 ? '✅' : '❌';
          const result = code === 0 ? 'PASSED' : 'FAILED';
          console.log(`      ${status} ${step.name.padEnd(maxNameLength)} - ${result} (${durationSecs}s)`);

          stepResults.push({ name: step.name, passed: code === 0, durationSecs });

          if (code === 0) {
            resolve({ step, output, durationSecs });
          } else {
            // On first failure, kill other processes if fail-fast enabled
            // RACE CONDITION SAFE: While multiple processes could fail simultaneously,
            // JavaScript's single-threaded event loop ensures atomic assignment.
            // Even if multiple failures occur, only one will be firstFailure, which is acceptable.
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
            reject({ step, output, durationSecs });
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
 * Main entry point for running validation with git tree hash-based caching.
 * Executes validation phases sequentially, with parallel step execution within
 * each phase. Supports fail-fast termination and comprehensive state tracking.
 *
 * Features:
 * - Git tree hash-based caching (skip if code unchanged)
 * - Parallel step execution within phases
 * - Fail-fast mode (stop on first failure)
 * - Comprehensive output logging
 * - State file persistence for cache validation
 *
 * @param config - Validation configuration with phases, steps, and options
 * @returns Promise resolving to validation result with pass/fail status
 *
 * @example
 * ```typescript
 * const result = await runValidation({
 *   phases: [
 *     {
 *       name: 'Pre-Qualification',
 *       parallel: true,
 *       steps: [
 *         { name: 'TypeScript', command: 'pnpm typecheck' },
 *         { name: 'ESLint', command: 'pnpm lint' },
 *       ],
 *     },
 *   ],
 *   stateFilePath: '.vibe-validate-state.yaml',
 *   enableFailFast: false,
 *   forceRun: false,
 * });
 *
 * if (result.passed) {
 *   console.log('✅ Validation passed');
 * } else {
 *   console.error(`❌ Failed at step: ${result.failedStep}`);
 *   console.error(result.failedStepOutput);
 * }
 * ```
 *
 * @public
 */
export async function runValidation(config: ValidationConfig): Promise<ValidationResult> {
  const {
    phases,
    stateFilePath = '.validate-state.json',
    logPath = join(tmpdir(), `validation-${new Date().toISOString().replace(/[:.]/g, '-')}.log`),
    enableFailFast = false,
    forceRun = false,
    env = {},
    onPhaseStart,
    onPhaseComplete,
  } = config;

  // Get current working tree hash (deterministic, content-based)
  const currentTreeHash = await getGitTreeHash();

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
      env,
      config.verbose ?? false
    );
    const phaseDurationMs = Date.now() - phaseStartTime;
    const durationSecs = parseFloat((phaseDurationMs / 1000).toFixed(1));

    // Append all outputs to log file
    for (const [stepName, output] of result.outputs) {
      appendFileSync(logPath, `\n${'='.repeat(60)}\n`);
      appendFileSync(logPath, `${stepName}${result.failedStep?.name === stepName ? ' - FAILED' : ''}\n`);
      appendFileSync(logPath, `${'='.repeat(60)}\n`);
      appendFileSync(logPath, output);
    }

    // Record phase result
    const phaseResult: PhaseResult = {
      name: phase.name,
      durationSecs,
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

      // Write state file as YAML
      writeFileSync(stateFilePath, yamlStringify(validationResult));

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

  // Write state file as YAML
  writeFileSync(stateFilePath, yamlStringify(validationResult));

  return validationResult;
}

/**
 * Setup signal handlers for graceful cleanup
 *
 * Registers SIGTERM and SIGINT handlers to ensure all active child processes
 * are properly terminated when the validation runner is interrupted.
 *
 * @param activeProcesses - Set of active child processes to track for cleanup
 *
 * @example
 * ```typescript
 * const activeProcesses = new Set<ChildProcess>();
 * setupSignalHandlers(activeProcesses);
 *
 * // When spawning new processes:
 * const proc = spawn('npm', ['test']);
 * activeProcesses.add(proc);
 *
 * // Cleanup is automatic on SIGTERM/SIGINT
 * ```
 *
 * @public
 */
export function setupSignalHandlers(activeProcesses: Set<ChildProcess>): void {
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
