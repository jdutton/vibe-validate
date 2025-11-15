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
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import stripAnsi from 'strip-ansi';
import { getGitTreeHash } from '@vibe-validate/git';
import { autoDetectAndExtract, type ErrorExtractorResult } from '@vibe-validate/extractors';
import type { ValidationStep } from '@vibe-validate/config';
import { stopProcessGroup, spawnCommand } from './process-utils.js';
import { parseVibeValidateOutput } from './run-output-parser.js';
import {
  ensureDir,
  getTempDir,
  createLogFileWrite,
  createCombinedJsonl,
} from './fs-utils.js';
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

  /** Debug mode: create output files for all steps (default: false) */
  debug?: boolean;

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
 * Create a stream data handler for stdout or stderr
 *
 * Eliminates code duplication between stdout and stderr handlers by
 * providing a factory function that creates handlers with proper
 * stream-specific behavior.
 *
 * @param stream - The stream type ('stdout' or 'stderr')
 * @param accumulator - Object to accumulate output into
 * @param combinedLines - Array to track timestamped lines
 * @param verbose - Whether to stream output in real-time
 * @param yaml - Whether YAML mode is enabled (affects output target)
 * @returns Data handler function for the stream
 *
 * @internal
 */
function createStreamHandler(
  stream: 'stdout' | 'stderr',
  accumulator: { value: string },
  combinedLines: Array<{ ts: string; stream: 'stdout' | 'stderr'; line: string }>,
  verbose: boolean,
  yaml: boolean
): (_data: Buffer) => void {
  return (_data: Buffer) => {
    const chunk = _data.toString();
    // Strip ANSI escape codes to make output readable for humans and LLMs
    // These codes (e.g., \e[32m for colors) are noise in logs, YAML, and git notes
    const cleanChunk = stripAnsi(chunk);
    accumulator.value += cleanChunk;

    // Track timestamped lines for combined.jsonl (for debug mode or failing steps)
    const lines = cleanChunk.split('\n');
    for (const line of lines) {
      if (line) {
        combinedLines.push({
          ts: new Date().toISOString(),
          stream,
          line,
        });
      }
    }

    // Stream output in real-time when verbose mode is enabled
    // When yaml mode is on, redirect subprocess output to stderr to keep stdout clean
    if (verbose) {
      const target = (stream === 'stdout' && !yaml) ? process.stdout : process.stderr;
      target.write(chunk);  // Keep colors for terminal viewing
    }
  };
}

/**
 * Extract errors from failed step output
 */
function extractFromFailedOutput(output: string): ErrorExtractorResult | undefined {
  const parsed = parseVibeValidateOutput(output);

  if (parsed?.extraction) {
    return parsed.extraction as ErrorExtractorResult;
  }

  // No vibe-validate YAML detected - use standard extraction
  return autoDetectAndExtract(output);
}

/**
 * Parse output and log cache status if verbose
 */
function parseAndLogCacheStatus(
  output: string,
  verbose: boolean,
  log: (_msg: string) => void
): { isCachedResult?: boolean; outputFiles?: { stdout?: string; stderr?: string; combined?: string } } {
  const parsed = parseVibeValidateOutput(output);

  if (!parsed) {
    return {};
  }

  if (parsed.isCachedResult && verbose) {
    log(`      ⚡ Step used cached result (${parsed.type} command)`);
  }

  return {
    isCachedResult: parsed.isCachedResult,
    outputFiles: parsed.outputFiles,
  };
}

/**
 * Create output files for step
 */
async function createStepOutputFiles(
  stepName: string,
  stdout: string,
  stderr: string,
  combinedLines: Array<{ ts: string; stream: 'stdout' | 'stderr'; line: string }>,
  verbose: boolean,
  log: (_msg: string) => void
): Promise<{ stdout?: string; stderr?: string; combined?: string } | undefined> {
  try {
    const treeHash = await getGitTreeHash();
    const outputDir = getTempDir('steps', treeHash, stepName);
    await ensureDir(outputDir);

    const stdoutPath = join(outputDir, 'stdout.txt');
    const stderrPath = join(outputDir, 'stderr.txt');
    const combinedPath = join(outputDir, 'combined.jsonl');

    await Promise.all([
      writeFile(stdoutPath, stdout || ''),
      writeFile(stderrPath, stderr || ''),
      writeFile(combinedPath, createCombinedJsonl(combinedLines)),
    ]);

    return {
      stdout: stdoutPath,
      stderr: stderrPath,
      combined: combinedPath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (verbose) {
      log(`      ⚠️ Warning: Could not create output files for ${stepName}: ${errorMessage}`);
    }
    return undefined;
  }
}

/**
 * Process step output: parse, extract errors, create output files
 */
async function processStepOutput(
  stepName: string,
  _command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  combinedLines: Array<{ ts: string; stream: 'stdout' | 'stderr'; line: string }>,
  verbose: boolean,
  debug: boolean,
  log: (_msg: string) => void
): Promise<{
  extraction?: ErrorExtractorResult;
  isCachedResult?: boolean;
  outputFiles?: { stdout?: string; stderr?: string; combined?: string };
}> {
  const output = stdout + stderr;
  let extraction: ErrorExtractorResult | undefined;
  let isCachedResult: boolean | undefined;
  let outputFiles: { stdout?: string; stderr?: string; combined?: string } | undefined;

  // Process failed steps
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- Explicit null/undefined/empty check is clearer
  if (exitCode !== 0 && output && output.trim()) {
    extraction = extractFromFailedOutput(output);
    const result = parseAndLogCacheStatus(output, verbose, log);
    isCachedResult = result.isCachedResult;
    outputFiles = result.outputFiles;
  } else if (output?.trim()) {
    // Process passing steps - check if cached
    const result = parseAndLogCacheStatus(output, verbose, log);
    isCachedResult = result.isCachedResult;
    outputFiles = result.outputFiles;
  }

  // Create output files if needed
  const shouldCreateFiles = exitCode !== 0 || debug;
  if (shouldCreateFiles && !outputFiles) {
    outputFiles = await createStepOutputFiles(stepName, stdout, stderr, combinedLines, verbose, log);
  }

  return { extraction, isCachedResult, outputFiles };
}

/**
 * Execute a single validation step
 */
async function executeSingleStep(
  step: ValidationStep,
  env: Record<string, string>,
  verbose: boolean,
  yaml: boolean,
  debug: boolean,
  maxNameLength: number,
  log: (_msg: string) => void
): Promise<{ output: string; stepResult: StepResult }> {
  const paddedName = step.name.padEnd(maxNameLength);
  log(`   ⏳ ${paddedName}  →  ${step.command}`);

  const startTime = Date.now();
  const proc = spawnCommand(step.command, { env });

  // Use object accumulators for mutable references
  const stdoutAccumulator = { value: '' };
  const stderrAccumulator = { value: '' };
  const combinedLines: Array<{ ts: string; stream: 'stdout' | 'stderr'; line: string }> = [];

  // Setup stream handlers
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnCommand always pipes stdout/stderr
  proc.stdout!.on('data', createStreamHandler('stdout', stdoutAccumulator, combinedLines, verbose, yaml));
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnCommand always pipes stdout/stderr
  proc.stderr!.on('data', createStreamHandler('stderr', stderrAccumulator, combinedLines, verbose, yaml));

  // Wait for process to complete
  const exitCode = await new Promise<number | null>(resolve => {
    proc.on('close', code => resolve(code));
  });

  const durationMs = Date.now() - startTime;
  const durationSecs = Number.parseFloat((durationMs / 1000).toFixed(1));
  const stdout = stdoutAccumulator.value;
  const stderr = stderrAccumulator.value;
  const output = stdout + stderr;

  // Normalize exit code (null means abnormal termination, treat as failure)
  const code = exitCode ?? 1;

  const status = code === 0 ? '✅' : '❌';
  const result = code === 0 ? 'PASSED' : 'FAILED';
  log(`      ${status} ${step.name.padEnd(maxNameLength)} - ${result} (${durationSecs}s)`);

  // Process output: parse, extract, create files
  const { extraction, isCachedResult, outputFiles } = await processStepOutput(
    step.name,
    step.command,
    code,
    stdout,
    stderr,
    combinedLines,
    verbose,
    debug,
    log
  );

  // Create step result (build without type annotation to let TS infer)
  const stepResultBase = {
    name: step.name,
    command: step.command,
    passed: code === 0,
    durationSecs,
    exitCode: code,
  };

  // Add optional fields if present
  const stepResult: StepResult = {
    ...stepResultBase,
    ...(extraction ? { extraction } : {}),
    ...(isCachedResult !== undefined ? { isCachedResult } : {}),
    ...(outputFiles ? { outputFiles } : {}),
  } as StepResult;

  return { output, stepResult };
}

/**
 * Run validation steps sequentially (one at a time)
 *
 * Executes validation steps one at a time in order, stopping on first failure.
 * This mode is useful for bootstrap builds or when steps have dependencies.
 *
 * @param steps - Array of validation steps to execute sequentially
 * @param phaseName - Human-readable phase name for logging
 * @param enableFailFast - If true, stops on first failure (recommended for sequential)
 * @param env - Additional environment variables for child processes
 * @returns Promise resolving to execution results with outputs and step results
 *
 * @example
 * ```typescript
 * const result = await runStepsSequentially(
 *   [
 *     { name: 'Build', command: 'pnpm build' },
 *     { name: 'TypeScript', command: 'pnpm typecheck' },
 *     { name: 'ESLint', command: 'pnpm lint' },
 *   ],
 *   'Pre-Qualification',
 *   true,
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
export async function runStepsSequentially(
  steps: ValidationStep[],
  phaseName: string,
  enableFailFast: boolean = true,
  env: Record<string, string> = {},
  verbose: boolean = false,
  yaml: boolean = false,
  _developerFeedback: boolean = false,
  debug: boolean = false
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

  log(`\n🔍 Running ${phaseName} (${steps.length} steps sequentially)...`);

  const maxNameLength = Math.max(...steps.map(s => s.name.length));
  const outputs = new Map<string, string>();
  const stepResults: StepResult[] = [];

  // Run steps one at a time
  for (const step of steps) {
    const { output, stepResult } = await executeSingleStep(
      step,
      env,
      verbose,
      yaml,
      debug,
      maxNameLength,
      log
    );

    outputs.set(step.name, output);
    stepResults.push(stepResult);

    // If step failed and fail-fast is enabled, stop here
    if (!stepResult.passed && enableFailFast) {
      return {
        success: false,
        failedStep: step,
        outputs,
        stepResults,
      };
    }
  }

  // Check if any step failed (for non-fail-fast mode)
  const hasFailures = stepResults.some(r => !r.passed);
  const failedStep = hasFailures ? stepResults.find(r => !r.passed) : undefined;

  return {
    success: !hasFailures,
    failedStep: failedStep ? steps.find(s => s.name === failedStep.name) : undefined,
    outputs,
    stepResults,
  };
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
  developerFeedback: boolean = false,
  debug: boolean = false
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

        // Use object accumulators for mutable references
        const stdoutAccumulator = { value: '' };
        const stderrAccumulator = { value: '' };

        // Track timestamped output for combined.jsonl (similar to run command)
        const combinedLines: Array<{ ts: string; stream: 'stdout' | 'stderr'; line: string }> = [];

        // Setup stream handlers using shared factory function (eliminates duplication)
        // spawnCommand always sets stdio: ['ignore', 'pipe', 'pipe'], so stdout/stderr are guaranteed non-null
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnCommand always pipes stdout/stderr
        proc.stdout!.on('data', createStreamHandler('stdout', stdoutAccumulator, combinedLines, verbose, yaml));
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnCommand always pipes stdout/stderr
        proc.stderr!.on('data', createStreamHandler('stderr', stderrAccumulator, combinedLines, verbose, yaml));

        proc.on('close', exitCode => {
          // Wrap in async IIFE to handle file creation
          // eslint-disable-next-line sonarjs/no-nested-functions, sonarjs/cognitive-complexity -- IIFE required for async/await in sync close handler; inherits complexity from step completion logic
          void (async () => {
            const durationMs = Date.now() - startTime;
            const durationSecs = Number.parseFloat((durationMs / 1000).toFixed(1));
            const stdout = stdoutAccumulator.value;
            const stderr = stderrAccumulator.value;
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
          let outputFilesFromNestedCommand = false; // Track if outputFiles came from nested vv run

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
              outputFilesFromNestedCommand = true; // Came from nested run - always include

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
              outputFilesFromNestedCommand = true; // Came from nested run - always include

              // Log cache hit status if available
              if (parsed.isCachedResult && verbose) {
                log(`      ⚡ Step used cached result (${parsed.type} command)`);
              }
            }
          }
          // If passing step (code === 0), extraction remains undefined (token optimization)

          // Create output files for failing steps or when debug mode is enabled
          // This provides full debugging context when needed
            const shouldCreateFiles = code !== 0 || debug;
            if (shouldCreateFiles && !outputFiles) {
              // Only create files if not already provided by nested vibe-validate command
              try {
                const treeHash = await getGitTreeHash();
                const outputDir = getTempDir('steps', treeHash, step.name);
                await ensureDir(outputDir);

                const writePromises: Promise<void>[] = [];

                // Write stdout.log (only if non-empty) using shared utility
                const { file: stdoutFile, promise: stdoutPromise } =
                  createLogFileWrite(stdout, outputDir, 'stdout.log');
                if (stdoutPromise) writePromises.push(stdoutPromise);

                // Write stderr.log (only if non-empty) using shared utility
                const { file: stderrFile, promise: stderrPromise } =
                  createLogFileWrite(stderr, outputDir, 'stderr.log');
                if (stderrPromise) writePromises.push(stderrPromise);

                // Write combined.jsonl (always - timestamped interleaved output)
                const combinedFile = join(outputDir, 'combined.jsonl');
                const combinedContent = createCombinedJsonl(combinedLines);
                writePromises.push(writeFile(combinedFile, combinedContent, 'utf-8'));

                // Wait for all writes to complete
                await Promise.all(writePromises);

                // Populate outputFiles for StepResult
                outputFiles = {
                  ...(stdoutFile ? { stdout: stdoutFile } : {}),
                  ...(stderrFile ? { stderr: stderrFile } : {}),
                  combined: combinedFile,
                };
              } catch (error) {
                // Silent failure - don't block validation on file creation errors
                // This ensures validation completes even if temp directory is unavailable
                if (verbose) {
                  const errorMsg = error instanceof Error ? error.message : String(error);
                  log(`      ⚠️  Could not create output files: ${errorMsg}`);
                }
              }
            }

            // Create step result - extends CommandExecutionSchema (v0.15.0+)
          const stepResult: StepResult = {
            name: step.name,
            command: step.command,
            exitCode: code,
            durationSecs,
            passed: code === 0,
            ...(isCachedResult !== undefined ? { isCachedResult } : {}), // Include cache status if available
            ...(extraction ? { extraction } : {}), // Conditionally include extraction
            ...((outputFiles && (outputFilesFromNestedCommand || code !== 0 || debug)) ? { outputFiles } : {}), // Always show for nested commands, or when step failed/debug enabled (v0.15.0+)
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
          })(); // Close async IIFE
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
  phaseResults: PhaseResult[],
  debug: boolean,
  logPath?: string
): ValidationResult {
  // Field order optimized for LLM consumption
  return {
    passed: false,
    timestamp: new Date().toISOString(),
    treeHash: currentTreeHash,
    summary: `${failedStep.name} failed`,
    failedStep: failedStep.name,
    phases: phaseResults,
    ...(debug && logPath ? { outputFiles: { combined: logPath } } : {}),
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

    // Choose execution strategy based on parallel flag
    const runSteps = (phase.parallel === true) ? runStepsInParallel : runStepsSequentially;

    const result = await runSteps(
      phase.steps,
      phase.name,
      enableFailFast,
      env,
      config.verbose ?? false,
      config.yaml ?? false,
      config.developerFeedback ?? false,
      config.debug ?? false
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
        phaseResults,
        config.debug ?? false,
        logPath
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
    ...(config.debug ? { outputFiles: { combined: logPath } } : {}),
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
