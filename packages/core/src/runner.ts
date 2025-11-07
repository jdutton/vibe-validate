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

import { type ChildProcess } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import stripAnsi from 'strip-ansi';
import { getGitTreeHash } from '@vibe-validate/git';
import { autoDetectAndExtract } from '@vibe-validate/extractors';
import type { ValidationStep } from '@vibe-validate/config';
import { stopProcessGroup, spawnCommand } from './process-utils.js';
import { parseVibeValidateOutput } from './run-output-parser.js';
import type {
  ValidationResult,
  StepResult,
  PhaseResult,
} from './result-schema.js';

/**
 * Runtime validation configuration
 *
 * This extends the file-based configuration from @vibe-validate/config
 * with runtime-specific options (callbacks, logging, output format).
 *
 * Note: State management (caching, forceRun) is now handled at the CLI layer
 * via git notes. See packages/cli/src/commands/validate.ts and @vibe-validate/history.
 */
export interface ValidationConfig {
  /** Validation phases to execute */
  phases: import('@vibe-validate/config').ValidationPhase[];

  /** Path to log file (default: os.tmpdir()/validation-{timestamp}.log) */
  logPath?: string;

  /** Enable fail-fast (stop on first failure) */
  enableFailFast?: boolean;

  /** Show verbose output (stream command stdout/stderr in real-time) */
  verbose?: boolean;

  /** Output YAML result to stdout (redirects subprocess output to stderr when true) */
  yaml?: boolean;

  /** Developer feedback for continuous quality improvement (default: false) */
  developerFeedback?: boolean;

  /** Environment variables to pass to all child processes */
  env?: Record<string, string>;

  /** Callback when phase starts */
  onPhaseStart?: (_phase: import('@vibe-validate/config').ValidationPhase) => void;

  /** Callback when phase completes */
  onPhaseComplete?: (_phase: import('@vibe-validate/config').ValidationPhase, _result: PhaseResult) => void;

  /** Callback when step starts */
  onStepStart?: (_step: ValidationStep) => void;

  /** Callback when step completes */
  onStepComplete?: (_step: ValidationStep, _result: StepResult) => void;
}

/**
 * Parse test output to extract specific failures
 *
 * Extracts failure details from validation step output using pattern matching.
 * Supports Vitest, TypeScript, and ESLint error formats.
 *
 * Note: This is a basic implementation - the extractors package provides
 * more sophisticated parsing with tool-specific extractors.
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
 * @deprecated Use autoDetectAndExtract() from @vibe-validate/extractors instead
 */
export function parseFailures(output: string): string[] {
  const failures: string[] = [];

  // Vitest test failures - extract test names
  const vitestFailures = output.match(/❌ .+/g);
  if (vitestFailures) {
    failures.push(...vitestFailures.slice(0, 10)); // Limit to first 10
  }

  // TypeScript errors - extract file:line
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses TypeScript compiler output (controlled tool output), not user input
  const tsErrors = output.match(/[^(]+\(\d+,\d+\): error TS\d+:.+/g);
  if (tsErrors) {
    failures.push(...tsErrors.slice(0, 10).map(e => e.trim()));
  }

  // ESLint errors - extract file:line
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses ESLint output (controlled linter output), not user input
  const eslintErrors = output.match(/\S+\.ts\(\d+,\d+\): .+/g);
  if (eslintErrors) {
    failures.push(...eslintErrors.slice(0, 10).map(e => e.trim()));
  }

  return failures;
}

/**
 * Process developer feedback for failed step
 *
 * Analyzes extraction quality and provides feedback for improving extractors.
 * Only called when developerFeedback mode is enabled.
 *
 * @param stepResult - Step result to augment with extraction quality data
 * @param stepName - Name of the validation step
 * @param formatted - Formatted extractor output
 * @param log - Logging function for output
 * @param isWarning - Helper to check if error is a warning
 * @param isNotWarning - Helper to check if error is not a warning
 *
 * @internal
 */
function processDeveloperFeedback(
  _stepResult: StepResult,
  formatted: ReturnType<typeof autoDetectAndExtract>,
  log: (_msg: string) => void,
  _isWarning: (_e: { severity?: string }) => boolean,
  _isNotWarning: (_e: { severity?: string }) => boolean
): void {
  // Use extraction metadata from extractors package
  const detectedTool = formatted.metadata?.detection?.extractor ?? 'unknown';
  const confidence = formatted.metadata?.confidence ?? 0;
  const completeness = formatted.metadata?.completeness ?? 0;

  // Map confidence to level (0-100 → high/medium/low)
  let confidenceLevel: 'high' | 'medium' | 'low';
  if (confidence >= 80) {
    confidenceLevel = 'high';
  } else if (confidence >= 50) {
    confidenceLevel = 'medium';
  } else {
    confidenceLevel = 'low';
  }

  // Log extraction quality for developer feedback (not added to result)
  log(`      📊 Extraction quality: ${detectedTool} (${confidenceLevel} confidence: ${confidence}%, completeness: ${completeness}%)`);

  // Alert on poor extraction quality (for failed steps)
  if (confidence < 50) {
    log(`         ⚠️  Poor extraction quality (${confidence}%) - Extractors failed to extract failures`);
    log(`         💡 vibe-validate improvement opportunity: Improve ${detectedTool} extractor for this output`);
  }
}

/**
 * Handle fail-fast process coordination
 *
 * Kills all other running processes when fail-fast is enabled and a step fails.
 * Thread-safe due to JavaScript's single-threaded event loop.
 *
 * @param enableFailFast - Whether fail-fast mode is enabled
 * @param firstFailure - Reference to first failure tracking object
 * @param step - The failed step
 * @param output - Output from failed step
 * @param processes - Array of all running processes
 * @param log - Logging function for output
 * @param ignoreStopErrors - Callback to ignore already-stopped process errors
 * @returns Updated firstFailure reference
 *
 * @internal
 */
function handleFailFast(
  enableFailFast: boolean,
  firstFailure: { step: ValidationStep; output: string } | null,
  step: ValidationStep,
  output: string,
  processes: Array<{ proc: ChildProcess; step: ValidationStep }>,
  log: (_msg: string) => void,
  ignoreStopErrors: () => void
): { step: ValidationStep; output: string } | null {
  // RACE CONDITION SAFE: While multiple processes could fail simultaneously,
  // JavaScript's single-threaded event loop ensures atomic assignment.
  // Even if multiple failures occur, only one will be firstFailure, which is acceptable.
  if (enableFailFast && !firstFailure) {
    const failure = { step, output };
    log(`\n⚠️  Fail-fast enabled: Killing remaining processes...`);

    // Kill all other running processes
    for (const { proc: otherProc, step: otherStep } of processes) {
      if (otherStep !== step && otherProc.exitCode === null) {
        stopProcessGroup(otherProc, otherStep.name).catch(ignoreStopErrors);
      }
    }
    return failure;
  }
  return firstFailure;
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
  verbose: boolean = false,
  yaml: boolean = false,
  developerFeedback: boolean = false
): Promise<{
  success: boolean;
  failedStep?: ValidationStep;
  outputs: Map<string, string>;
  stepResults: StepResult[];
}> {
  // When yaml mode is on, write progress to stderr to keep stdout clean
  const log = yaml ?
    (msg: string) => process.stderr.write(msg + '\n') :
    (msg: string) => console.log(msg);

  log(`\n🔍 Running ${phaseName} (${steps.length} steps in parallel)...`);

  // Find longest step name for alignment
  const maxNameLength = Math.max(...steps.map(s => s.name.length));

  const outputs = new Map<string, string>();
  const stepResults: StepResult[] = [];
  const processes: Array<{ proc: ChildProcess; step: ValidationStep }> = [];
  let firstFailure: { step: ValidationStep; output: string } | null = null;

  // Helper functions (extracted to reduce nesting depth)
  const isWarning = (e: { severity?: string }) => e.severity === 'warning';
  const isNotWarning = (e: { severity?: string }) => e.severity !== 'warning';

  const ignoreStopErrors = () => { /* Process may have already exited */ };

  const results = await Promise.allSettled(
    steps.map(step =>
      new Promise<{ step: ValidationStep; output: string; durationSecs: number }>((resolve, reject) => {
        const paddedName = step.name.padEnd(maxNameLength);
        log(`   ⏳ ${paddedName}  →  ${step.command}`);

        const startTime = Date.now();

        const proc = spawnCommand(step.command, {
          env,
        });

        // Track process for potential kill
        processes.push({ proc, step });

        let stdout = '';
        let stderr = '';

        // spawnCommand always sets stdio: ['ignore', 'pipe', 'pipe'], so stdout/stderr are guaranteed non-null
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnCommand always pipes stdout/stderr
        proc.stdout!.on('data', data => {
          const chunk = data.toString();
          // Strip ANSI escape codes to make output readable for humans and LLMs
          // These codes (e.g., \e[32m for colors) are noise in logs, YAML, and git notes
          const cleanChunk = stripAnsi(chunk);
          stdout += cleanChunk;
          // Stream output in real-time when verbose mode is enabled
          // When yaml mode is on, redirect subprocess output to stderr to keep stdout clean
          if (verbose) {
            if (yaml) {
              process.stderr.write(chunk);  // Keep colors for terminal viewing
            } else {
              process.stdout.write(chunk);  // Keep colors for terminal viewing
            }
          }
        });
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnCommand always pipes stdout/stderr
        proc.stderr!.on('data', data => {
          const chunk = data.toString();
          // Strip ANSI escape codes from stderr as well
          const cleanChunk = stripAnsi(chunk);
          stderr += cleanChunk;
          // Stream errors in real-time when verbose mode is enabled
          if (verbose) {
            process.stderr.write(chunk);  // Keep colors for terminal viewing
          }
        });

        // eslint-disable-next-line sonarjs/cognitive-complexity -- Complex handler for step completion, extraction, and fail-fast coordination
        proc.on('close', exitCode => {
          const durationMs = Date.now() - startTime;
          const durationSecs = Number.parseFloat((durationMs / 1000).toFixed(1));
          const output = stdout + stderr;
          outputs.set(step.name, output);

          // Normalize exit code (null means abnormal termination, treat as failure)
          const code = exitCode ?? 1;

          const status = code === 0 ? '✅' : '❌';
          const result = code === 0 ? 'PASSED' : 'FAILED';
          log(`      ${status} ${step.name.padEnd(maxNameLength)} - ${result} (${durationSecs}s)`);

          // Extract errors ONLY from FAILED steps (code !== 0)
          // Rationale: Passing tests have no failures to extract. Including empty extraction
          // objects wastes tokens in LLM context. Only extract when there's value to provide.
          let extraction;
          let isCachedResult: boolean | undefined;
          let outputFiles;

          // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- Explicit null/undefined/empty check is clearer than optional chaining
          if (code !== 0 && output && output.trim()) {
            // Try parsing vibe-validate YAML output (from nested run commands)
            // Uses shared parser that handles both RunResult and ValidationResult formats
            const parsed = parseVibeValidateOutput(output);

            if (parsed) {
              // Use extraction from nested vibe-validate command
              // This preserves the actual meaningful summary instead of generic "X error(s) from nested command"
              extraction = parsed.extraction;
              isCachedResult = parsed.isCachedResult;
              outputFiles = parsed.outputFiles;

              // Log cache hit status if available (nested run was cached)
              if (parsed.isCachedResult && verbose) {
                log(`      ⚡ Step used cached result (${parsed.type} command)`);
              }
            } else {
              // No vibe-validate YAML detected - use standard extraction
              const rawExtraction = autoDetectAndExtract(output);

              // Strip empty optional fields to save tokens
              extraction = {
                summary: rawExtraction.summary,
                totalErrors: rawExtraction.totalErrors,
                errors: rawExtraction.errors,
                ...(rawExtraction.guidance?.trim() ? { guidance: rawExtraction.guidance } : {}),
                ...(rawExtraction.errorSummary?.trim() ? { errorSummary: rawExtraction.errorSummary } : {}),
                ...(rawExtraction.metadata ? { metadata: rawExtraction.metadata } : {}),
              };
            }
          } else if (output?.trim()) {
            // Passing step (code === 0) - check if it was cached
            const parsed = parseVibeValidateOutput(output);
            if (parsed) {
              isCachedResult = parsed.isCachedResult;
              outputFiles = parsed.outputFiles;

              // Log cache hit status if available
              if (parsed.isCachedResult && verbose) {
                log(`      ⚡ Step used cached result (${parsed.type} command)`);
              }
            }
          }
          // If passing step (code === 0), extraction remains undefined (token optimization)

          // Create step result - extends CommandExecutionSchema (v0.15.0+)
          const stepResult: StepResult = {
            name: step.name,
            command: step.command,
            exitCode: code,
            durationSecs,
            passed: code === 0,
            ...(isCachedResult !== undefined ? { isCachedResult } : {}), // Include cache status if available
            ...(extraction ? { extraction } : {}), // Conditionally include extraction
            ...(outputFiles ? { outputFiles } : {}), // Include output files for debugging (v0.15.1+)
          };

          // Only include extraction quality metrics when developerFeedback is enabled
          // Skip if extraction already has metadata (from smart extractors) - that's more accurate
          // This is for vibe-validate contributors to identify extraction improvement opportunities
          if (developerFeedback && extraction && !extraction.metadata) {
            processDeveloperFeedback(stepResult, extraction, log, isWarning, isNotWarning);
          }

          stepResults.push(stepResult);

          if (code === 0) {
            resolve({ step, output, durationSecs });
          } else {
            // On first failure, kill other processes if fail-fast enabled
            firstFailure = handleFailFast(enableFailFast, firstFailure, step, output, processes, log, ignoreStopErrors);
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
 * Append step outputs to log file
 */
function appendStepOutputsToLog(
  logPath: string,
  outputs: Map<string, string>,
  failedStepName?: string
): void {
  for (const [stepName, output] of outputs) {
    appendFileSync(logPath, `\n${'='.repeat(60)}\n`);
    appendFileSync(logPath, `${stepName}${failedStepName === stepName ? ' - FAILED' : ''}\n`);
    appendFileSync(logPath, `${'='.repeat(60)}\n`);
    appendFileSync(logPath, output);
  }
}

/**
 * Create failed validation result
 *
 * Note: Error extraction now happens at step level
 * Each failed step in phaseResults has its own extraction field with structured errors
 */
function createFailedValidationResult(
  failedStep: ValidationStep,
  currentTreeHash: string,
  logPath: string,
  phaseResults: PhaseResult[]
): ValidationResult {
  // Field order optimized for LLM consumption
  return {
    passed: false,
    timestamp: new Date().toISOString(),
    treeHash: currentTreeHash,
    summary: `${failedStep.name} failed`,
    failedStep: failedStep.name,
    phases: phaseResults,
    fullLogFile: logPath,
  };
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
 *   enableFailFast: false,
 * });
 *
 * if (result.passed) {
 *   console.log('✅ Validation passed');
 * } else {
 *   console.error(`❌ Failed at step: ${result.failedStep}`);
 * }
 * ```
 *
 * @public
 */
export async function runValidation(config: ValidationConfig): Promise<ValidationResult> {
  const {
    phases,
    logPath = join(tmpdir(), `validation-${new Date().toISOString().replace(/[:.]/g, '-')}.log`),
    enableFailFast = false,
    env = {},
    onPhaseStart,
    onPhaseComplete,
  } = config;

  // Get current working tree hash (deterministic, content-based)
  const currentTreeHash = await getGitTreeHash();

  // Note: Caching is now handled at the CLI layer via git notes
  // (see packages/cli/src/commands/validate.ts and @vibe-validate/history)

  // Initialize log file
  writeFileSync(logPath, `Validation started at ${new Date().toISOString()}\n\n`);

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
      config.verbose ?? false,
      config.yaml ?? false,
      config.developerFeedback ?? false
    );
    const phaseDurationMs = Date.now() - phaseStartTime;
    const durationSecs = Number.parseFloat((phaseDurationMs / 1000).toFixed(1));

    // Append all outputs to log file
    appendStepOutputsToLog(logPath, result.outputs, result.failedStep?.name);

    // Record phase result
    const phaseResult: PhaseResult = {
      name: phase.name,
      passed: result.success,
      durationSecs,
      steps: result.stepResults,
    };

    phaseResults.push(phaseResult);

    if (onPhaseComplete) {
      onPhaseComplete(phase, phaseResult);
    }

    // If phase failed, stop here and return failure result
    if (!result.success && result.failedStep) {
      return createFailedValidationResult(
        result.failedStep,
        currentTreeHash,
        logPath,
        phaseResults
      );
    }
  }

  // All steps passed!
  // Field order optimized for LLM consumption
  const validationResult: ValidationResult = {
    passed: true,
    timestamp: new Date().toISOString(),
    treeHash: currentTreeHash,
    summary: 'Validation passed',
    phases: phaseResults,
    fullLogFile: logPath,
  };

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
  const cleanup = async (signal: string): Promise<void> => {
    console.log(`\n⚠️  Received ${signal}, cleaning up ${activeProcesses.size} active processes...`);

    // Kill all active processes
    const cleanupPromises = Array.from(activeProcesses).map(proc =>
      stopProcessGroup(proc, 'Validation step')
    );

    await Promise.all(cleanupPromises);
    process.exit(1);
  };

  process.on('SIGTERM', () => {
    void cleanup('SIGTERM');
  });
  process.on('SIGINT', () => {
    void cleanup('SIGINT');
  });
}
