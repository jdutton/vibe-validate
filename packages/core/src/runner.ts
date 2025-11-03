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
import { parse as parseYaml } from 'yaml';
import { getGitTreeHash, extractYamlContent } from '@vibe-validate/git';
import { autoDetectAndExtract, type FormattedError } from '@vibe-validate/extractors';
import { stopProcessGroup, spawnCommand } from './process-utils.js';
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
 * Calculate extraction quality score based on extractor output
 *
 * Scores extraction quality from 0-100 based on:
 * - Number of errors extracted
 * - Field completeness (file, line, message)
 * - Actionability (can an LLM/human act on this?)
 *
 * @param formatted - Extractor output
 * @returns Quality score (0-100)
 *
 * @internal
 */
function calculateExtractionQuality(formatted: ReturnType<typeof autoDetectAndExtract>): number {
  let score = 0;

  // Error extraction (0-60 points)
  const errorCount = formatted.errors?.length ?? 0;
  if (errorCount > 0) {
    score += Math.min(60, errorCount * 12); // Max 60 points for 5+ errors
  }

  // Field completeness (0-40 points)
  const errors = formatted.errors ?? [];
  if (errors.length > 0) {
    const firstError = errors[0];
    let fieldScore = 0;
    if (firstError.file) fieldScore += 10;
    if (firstError.line !== undefined) fieldScore += 10;
    if (firstError.message) fieldScore += 20;
    score += fieldScore;
  }

  return Math.min(100, score);
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
 * Calculate confidence level from extraction quality score
 *
 * Maps numeric quality scores to confidence levels for easier interpretation.
 *
 * @param score - Quality score (0-100)
 * @returns Confidence level (high >= 80, medium >= 50, low < 50)
 *
 * @internal
 */
function calculateConfidenceLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 80) {
    return 'high';
  }
  if (score >= 50) {
    return 'medium';
  }
  return 'low';
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
  stepResult: StepResult,
  formatted: ReturnType<typeof autoDetectAndExtract>,
  log: (_msg: string) => void,
  isWarning: (_e: { severity?: string }) => boolean,
  isNotWarning: (_e: { severity?: string }) => boolean
): void {
  // Use extractor's own tool detection from metadata (output-based, not hint-based)
  const detectedTool = formatted.metadata?.detection?.extractor ?? 'unknown';

  // eslint-disable-next-line sonarjs/deprecation -- calculateExtractionQuality is deprecated but still used for backwards compatibility
  const score = calculateExtractionQuality(formatted);
  const confidence = calculateConfidenceLevel(score);

  stepResult.extractionQuality = {
    detectedTool,
    confidence,
    score,
    warnings: formatted.errors?.filter(isWarning).length ?? 0,
    errorsExtracted: formatted.errors?.filter(isNotWarning).length ?? formatted.errors?.length ?? 0,
    actionable: (formatted.errors?.length ?? 0) > 0,
  };

  // Alert on poor extraction quality (for failed steps)
  if (score < 50) {
    log(`         ⚠️  Poor extraction quality (${score}%) - Extractors failed to extract failures`);
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
  const formatError = (error: { file?: string; line?: number; message?: string }) => {
    const linePart = error.line ? `:${error.line}` : '';
    const location = error.file ? `${error.file}${linePart}` : 'unknown';
    return `${location} - ${error.message ?? 'No message'}`;
  };
  const isWarning = (e: { severity?: string }) => e.severity === 'warning';
  const isNotWarning = (e: { severity?: string }) => e.severity !== 'warning';

  // Extract errors from YAML frontmatter output (from nested run commands)
  const extractYamlErrors = (output: string): FormattedError[] | null => {
    try {
      // Use shared efficient regex-based extraction
      const yamlContent = extractYamlContent(output);
      if (!yamlContent) {
        return null; // No YAML found
      }

      // Parse the YAML
      const parsed = parseYaml(yamlContent) as {
        extraction?: {
          errors?: FormattedError[];
        };
      };

      // Return the errors from the extraction field
      return parsed?.extraction?.errors ?? null;
    } catch {
      // If YAML parsing fails, return null to fall back to autoDetectAndExtract
      return null;
    }
  };

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

        proc.on('close', code => {
          const durationMs = Date.now() - startTime;
          const durationSecs = Number.parseFloat((durationMs / 1000).toFixed(1));
          const output = stdout + stderr;
          outputs.set(step.name, output);

          const status = code === 0 ? '✅' : '❌';
          const result = code === 0 ? 'PASSED' : 'FAILED';
          log(`      ${status} ${step.name.padEnd(maxNameLength)} - ${result} (${durationSecs}s)`);

          // Create base step result
          const stepResult: StepResult = {
            name: step.name,
            passed: code === 0,
            durationSecs,
          };

          // Only run extractors on FAILED steps (code !== 0)
          // Rationale: Passing tests have no failures to extract, extraction would always produce
          // meaningless results (score: 0, no errors). Skipping saves CPU and reduces output noise.
          // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- Explicit null/undefined/empty check is clearer than optional chaining
          if (code !== 0 && output && output.trim()) {
            // Try extracting errors from YAML frontmatter (from nested run commands)
            // Returns null if no YAML found, then falls back to autoDetectAndExtract
            const yamlErrors = extractYamlErrors(output);

            let formatted;
            if (yamlErrors) {
              // Use errors from nested run command's YAML output
              formatted = {
                errors: yamlErrors,
                summary: `${yamlErrors.length} error(s) from nested command`,
                totalCount: yamlErrors.length,
                guidance: '',
                errorSummary: '',
              };
            } else {
              // No YAML detected - use standard extraction
              formatted = autoDetectAndExtract(output);
            }

            // Extract structured failures/tests
            stepResult.failedTests = formatted.errors?.map(formatError) ?? [];

            // Only include extraction quality metrics when developerFeedback is enabled
            // This is for vibe-validate contributors to identify extraction improvement opportunities
            if (developerFeedback) {
              processDeveloperFeedback(stepResult, formatted, log, isWarning, isNotWarning);
            }
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
 * Create failed validation result with extracted errors
 */
function createFailedValidationResult(
  failedStep: ValidationStep,
  failedOutput: string,
  currentTreeHash: string,
  logPath: string,
  phaseResults: PhaseResult[]
): ValidationResult {
  // Try extracting errors from YAML frontmatter (from nested run commands)
  // Returns null if no YAML found, then falls back to autoDetectAndExtract
  const yamlContent = extractYamlContent(failedOutput);
  let extracted;

  if (yamlContent) {
    try {
      // Parse the YAML
      const parsed = parseYaml(yamlContent) as {
        extraction?: {
          errors?: FormattedError[];
          summary?: string;
          errorSummary?: string;
        };
      };

      // Use errors from nested run command's YAML output
      if (parsed?.extraction?.errors) {
        extracted = {
          errors: parsed.extraction.errors,
          summary: parsed.extraction.summary ?? `${parsed.extraction.errors.length} error(s) from nested command`,
          totalCount: parsed.extraction.errors.length,
          guidance: '',
          errorSummary: parsed.extraction.errorSummary ?? '',
        };
      } else {
        // YAML found but no extraction.errors - fall back to autoDetectAndExtract
        extracted = autoDetectAndExtract(failedOutput);
      }
    } catch {
      // YAML parsing failed - fall back to autoDetectAndExtract
      extracted = autoDetectAndExtract(failedOutput);
    }
  } else {
    // No YAML detected - use standard extraction
    extracted = autoDetectAndExtract(failedOutput);
  }

  const extractedOutput = extracted.errorSummary.trim() || failedOutput;

  // Use structured errors from extractor
  const structuredFailures = extracted.errors.map(error => {
    const linePart = error.line ? `:${error.line}` : '';
    const location = error.file ? `${error.file}${linePart}` : 'unknown';
    return `${location} - ${error.message ?? 'No message'}`;
  });

  return {
    passed: false,
    timestamp: new Date().toISOString(),
    treeHash: currentTreeHash,
    failedStep: failedStep.name,
    rerunCommand: failedStep.command,
    failedTests: structuredFailures.length > 0 ? structuredFailures : undefined,
    fullLogFile: logPath,
    phases: phaseResults,
    failedStepOutput: extractedOutput,
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
 *   console.error(result.failedStepOutput);
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
      durationSecs,
      passed: result.success,
      steps: result.stepResults,
    };

    // If phase failed, extract and include output (LLM-optimized, not raw)
    if (!result.success && result.failedStep) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Need to filter empty strings, not just null/undefined
      const rawOutput = result.outputs.get(result.failedStep.name) || '';
      const extracted = autoDetectAndExtract(rawOutput);
      phaseResult.output = extracted.errorSummary.trim() || rawOutput;
    }

    phaseResults.push(phaseResult);

    if (onPhaseComplete) {
      onPhaseComplete(phase, phaseResult);
    }

    // If phase failed, stop here and return failure result
    if (!result.success && result.failedStep) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Need to filter empty strings, not just null/undefined
      const failedOutput = result.outputs.get(result.failedStep.name) || '';
      return createFailedValidationResult(
        result.failedStep,
        failedOutput,
        currentTreeHash,
        logPath,
        phaseResults
      );
    }
  }

  // All steps passed!
  // IMPORTANT: Field order matches types.ts for YAML truncation safety
  const validationResult: ValidationResult = {
    passed: true,
    timestamp: new Date().toISOString(),
    treeHash: currentTreeHash,
    fullLogFile: logPath,
    phases: phaseResults,  // May contain output - at end for safety
  };

  // State persistence moved to validate.ts via git notes (v0.12.0+)
  // The state file is deprecated - git notes are now the source of truth

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
