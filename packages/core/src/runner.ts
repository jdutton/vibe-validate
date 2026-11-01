 
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
import { join } from 'node:path';

import type { ValidationPhase, ValidationStep, VibeValidateConfig } from '@vibe-validate/config';
import { autoDetectAndExtract, type ErrorExtractorResult } from '@vibe-validate/extractors';
import { getGitTreeHash } from '@vibe-validate/git';
import { normalizedTmpdir } from '@vibe-validate/utils';
import stripAnsi from 'strip-ansi';

import {
  ensureDir,
  getTempDir,
  getTempFilename,
  createLogFileWrite,
  createCombinedJsonl,
} from './fs-utils.js';
import {
  buildChildContext,
  PARENT_CONTEXT_ENV,
  readParentContext,
  serializeForEnv,
} from './parent-context.js';
import { stopProcessGroup, spawnCommand, resolveGitRelativePath } from './process-utils.js';
import {
  isOwnStepFailure,
  type ValidationResult,
  type StepResult,
  type PhaseResult,
} from './result-schema.js';
import { parseVibeValidateOutput } from './run-output-parser.js';

/**
 * Convert a step name into a filesystem-safe slug for output directory paths.
 *
 * Replaces any non-alphanumeric character with `-`. Used to build per-step
 * output directories under the run-scoped temp directory.
 *
 * @param name - The step name to slugify
 * @returns A filesystem-safe slug
 *
 * @internal
 */
function slugifyStepName(name: string): string {
  return name.replaceAll(/[^a-z0-9]/gi, '-');
}

/**
 * Build a stable per-validation-run identifier from the current ISO timestamp
 * and the leading 8 characters of the working tree hash.
 *
 * Used as `ParentContext.runId` and as the directory key under
 * `${getTempDir('steps')}/<runId>/<step-slug>`.
 *
 * @param treeHash - Current git working tree hash
 * @returns Run identifier string (e.g. `2026-04-24T12-00-00-000Z-abcd1234`)
 *
 * @internal
 */
function makeRunId(treeHash: string): string {
  return `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${treeHash.slice(0, 8)}`;
}

/**
 * Resolve the per-step output directory and build the spawn environment with
 * VV_PARENT_CONTEXT injected for nested vibe-validate invocations.
 *
 * Used by both the sequential and parallel step execution paths. Returns the
 * resolved `outputDir` so the caller can pass it back to the file-creation
 * helpers, ensuring `ParentContext.outputDir` and the actual file location
 * are always identical.
 *
 * @param args - Step, base env, parent context, runId, treeHash, optional phase
 * @returns Step env (with VV_PARENT_CONTEXT) and the resolved outputDir
 *
 * @internal
 */
export function buildStepEnv(args: {
  step: ValidationStep;
  baseEnv: Record<string, string>;
  parent: ReturnType<typeof readParentContext>;
  runId: string;
  treeHash: string;
  phaseName?: string;
  verbose: boolean;
}): { env: Record<string, string>; outputDir: string } {
  const outputDir = join(getTempDir('steps'), args.runId, slugifyStepName(args.step.name));
  const childCtx = buildChildContext(args.parent, {
    runId: args.runId,
    treeHash: args.treeHash,
    stepName: args.step.name,
    ...(args.phaseName ? { phaseName: args.phaseName } : {}),
    outputDir,
    verbose: args.verbose,
    forceExecution: process.env.VV_FORCE_EXECUTION === '1',
  });
  return {
    env: {
      ...args.baseEnv,
      ...args.step.env,
      [PARENT_CONTEXT_ENV]: serializeForEnv(childCtx),
    },
    outputDir,
  };
}

/**
 * Determine if a step should be skipped based on its runScope and the current environment.
 *
 * - `runScope: 'ci'` — only runs in CI, skipped locally
 * - `runScope: 'local'` — only runs locally, skipped in CI
 * - No `runScope` (undefined) — runs everywhere (backwards compatible)
 *
 * @param runScope - The step's runScope setting
 * @param isCI - Whether the current environment is CI
 * @returns true if the step should be skipped
 *
 * @public
 */
export function shouldSkipByRunScope(runScope: 'ci' | 'local' | undefined, isCI: boolean): boolean {
  if (!runScope) return false;
  if (runScope === 'ci' && !isCI) return true;
  if (runScope === 'local' && isCI) return true;
  return false;
}

/**
 * Get the human-readable skip reason for a runScope-skipped step.
 *
 * @param runScope - The step's runScope setting
 * @returns Display string for the skip reason
 *
 * @internal
 */
function getRunScopeSkipReason(runScope: 'ci' | 'local' | undefined): string {
  return runScope === 'ci' ? 'skipped (ci-only)' : 'skipped (local-only)';
}

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
  phases: ValidationPhase[];

  /** Path to log file (default: os.tmpdir()/validation-{timestamp}.log) */
  logPath?: string;

  /**
   * Git tree hash the caller already computed for this worktree (the CLI
   * computes one for its cache lookup). Reused instead of hashing again;
   * computed here when absent.
   */
  treeHash?: string;

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

  /** Extractor plugin configuration (for loading local/external plugins) */
  extractors?: Pick<VibeValidateConfig, 'extractors'>['extractors'];

  /**
   * Previous validation run for retry-failed functionality
   *
   * When provided, the runner can skip steps that passed in the previous run
   * and only re-execute failed steps. Used by --retry-failed flag.
   *
   * @see packages/history/src/schemas.ts - ValidationRunSchema
   */
  previousRun?: {
    id: string;
    timestamp: string;
    duration: number;
    passed: boolean;
    branch: string;
    headCommit: string;
    uncommittedChanges: boolean;
    submoduleHashes?: Record<string, string>;
    result: ValidationResult;
  };

  /** Callback when phase starts */
  onPhaseStart?: (_phase: ValidationPhase) => void;

  /** Callback when phase completes */
  onPhaseComplete?: (_phase: ValidationPhase, _result: PhaseResult) => void;

  /** Callback when step starts */
  onStepStart?: (_step: ValidationStep) => void;

  /** Callback when step completes */
  onStepComplete?: (_step: ValidationStep, _result: StepResult) => void;
}

/**
 * Options for processing step output
 */
interface ProcessOutputOptions {
  /** The run's tree hash, used to name output files (never re-hashed per step) */
  treeHash: string;
  /** Show verbose output */
  verbose: boolean;
  /** Enable debug mode (create output files for all steps) */
  debug: boolean;
  /** Logging function */
  log: (_msg: string) => void;
}

/**
 * Outcome of running one phase's steps. A failed phase always names the step
 * that failed, so a caller can never read "failed" without a step to blame.
 */
export type StepsOutcome =
  | { success: true; failedStep?: never; outputs: Map<string, string>; stepResults: StepResult[] }
  | { success: false; failedStep: ValidationStep; outputs: Map<string, string>; stepResults: StepResult[] };

/**
 * Options for step execution (sequential or parallel)
 */
interface StepExecutionOptions {
  /** Enable fail-fast (stop on first failure) */
  enableFailFast?: boolean;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Show verbose output */
  verbose?: boolean;
  /** Output YAML result to stdout */
  yaml?: boolean;
  /** Developer feedback mode */
  developerFeedback?: boolean;
  /** Enable debug mode (create output files for all steps) */
  debug?: boolean;
  /** Previous validation run for retry-failed functionality */
  previousRun?: ValidationConfig['previousRun'];
  /** Pre-computed git tree hash for the current run (reused across all steps) */
  treeHash?: string;
  /** Pre-computed run id for the current run (reused across all steps) */
  runId?: string;
}

/**
 * Find step result from previous validation run by name
 *
 * Searches across all phases in the previous validation to find a step
 * with the matching name. This enables step caching for --retry-failed.
 *
 * @param previousRun - Previous validation run data from history
 * @param stepName - Name of step to find
 * @returns Step result if found, null otherwise
 *
 * @example
 * ```typescript
 * const previousStep = findPreviousStepResult(previousRun, 'TypeCheck');
 * if (previousStep?.passed) {
 *   // Use cached result
 * }
 * ```
 *
 * @public
 */
export function findPreviousStepResult(
  previousRun: ValidationConfig['previousRun'],
  stepName: string
): StepResult | null {
  if (!previousRun?.result.phases) {
    return null;
  }

  for (const phase of previousRun.result.phases) {
    for (const step of phase.steps) {
      if (step.name === stepName) {
        return step;
      }
    }
  }

  return null;
}

/**
 * Determine if we should use cached result for this step
 *
 * Returns true only when all conditions are met:
 * - Retry-failed mode is enabled
 * - Previous step exists
 * - Previous step passed (`passed`; a step fail-fast stopped never has)
 *
 * @param previousStep - Step result from previous run (or null if not found)
 * @param isRetryFailed - Whether retry-failed mode is enabled
 * @returns True if we should use cached result, false otherwise
 *
 * @example
 * ```typescript
 * const previousStep = findPreviousStepResult(previousRun, 'Build');
 * if (shouldUseCachedResult(previousStep, true)) {
 *   return createCachedStepResult(previousStep);
 * }
 * ```
 *
 * @public
 */
export function shouldUseCachedResult(
  previousStep: StepResult | null,
  isRetryFailed: boolean
): boolean {
  if (!previousStep || !isRetryFailed) {
    return false;
  }

  // Use cache only if the step ran to completion and passed. `passed` is the
  // verdict: a step fail-fast stopped can have exited 0 without finishing.
  return previousStep.passed;
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
 * @param stoppedByFailFast - Records each sibling this call stops, keyed by its
 *   name, with the name of the step whose failure stopped it
 * @param log - Logging function for output
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
  stoppedByFailFast: Map<ValidationStep, string>,
  log: (_msg: string) => void
): { step: ValidationStep; output: string } | null {
  // RACE CONDITION SAFE: While multiple processes could fail simultaneously,
  // JavaScript's single-threaded event loop ensures atomic assignment.
  // Even if multiple failures occur, only one will be firstFailure, which is acceptable.
  if (enableFailFast && !firstFailure) {
    const failure = { step, output };
    log(`\n⚠️  Fail-fast enabled: Killing remaining processes...`);

    // Kill all other running processes. Record each one BEFORE signalling it, so
    // its close handler reports "stopped" rather than a failure of its own.
    // A process killed by a signal has exitCode null but signalCode set: it has
    // already ended on its own and must keep its own result.
    for (const { proc: otherProc, step: otherStep } of processes) {
      if (otherStep !== step && otherProc.exitCode === null && otherProc.signalCode === null) {
        stoppedByFailFast.set(otherStep, step.name);
        stopProcessGroup(otherProc, otherStep.name).catch(() => { /* Process may have already exited */ });
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
    return parsed.extraction;
  }

  // No vibe-validate YAML detected - use standard extraction
  return autoDetectAndExtract(output);
}

/**
 * Extraction for a failed step that printed nothing, so the result names the
 * exit code instead of an unexplained "0 errors".
 */
function createNoOutputExtraction(exitCode: number): ErrorExtractorResult {
  return {
    summary: `Exited with code ${exitCode} and produced no output`,
    totalErrors: 0,
    errors: [],
    guidance: 'The command failed without printing anything. Run it directly to see why it exited non-zero.',
  };
}

/**
 * Extraction for a parallel sibling that fail-fast terminated. It did not fail
 * on its own, so the extraction points at the step that did.
 */
function createStoppedExtraction(triggerStepName: string): ErrorExtractorResult {
  return {
    summary: `Stopped by fail-fast after ${triggerStepName} failed`,
    totalErrors: 0,
    errors: [],
    guidance: `This step did not fail on its own: it was terminated when ${triggerStepName} failed. Fix ${triggerStepName} first.`,
  };
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
 * Create output files for step.
 *
 * Writes the captured stdout/stderr/combined streams under `outputDir`.
 * The caller is responsible for resolving `location.outputDir` (typically the same
 * directory advertised in `ParentContext.outputDir`), so a nested child
 * process can predict where its outer-captured files will live.
 */
async function createStepOutputFiles(
  stepName: string,
  stdout: string,
  stderr: string,
  combinedLines: Array<{ ts: string; stream: 'stdout' | 'stderr'; line: string }>,
  verbose: boolean,
  log: (_msg: string) => void,
  location: { outputDir: string; treeHash: string }
): Promise<{ stdout?: string; stderr?: string; combined?: string } | undefined> {
  const { outputDir, treeHash } = location;
  try {
    await ensureDir(outputDir);

    // Generate unique filenames with tree hash and timestamp
    const stdoutFilename = getTempFilename(treeHash, 'txt', `${stepName}-stdout`);
    const stderrFilename = getTempFilename(treeHash, 'txt', `${stepName}-stderr`);
    const combinedFilename = getTempFilename(treeHash, 'jsonl', `${stepName}-combined`);

    const stdoutPath = join(outputDir, stdoutFilename);
    const stderrPath = join(outputDir, stderrFilename);
    const combinedPath = join(outputDir, combinedFilename);

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
  exitCode: number,
  stdout: string,
  stderr: string,
  combinedLines: Array<{ ts: string; stream: 'stdout' | 'stderr'; line: string }>,
  options: ProcessOutputOptions,
  outputDir: string
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
    const result = parseAndLogCacheStatus(output, options.verbose, options.log);
    isCachedResult = result.isCachedResult;
    outputFiles = result.outputFiles;
  } else if (output?.trim()) {
    // Process passing steps - check if cached
    const result = parseAndLogCacheStatus(output, options.verbose, options.log);
    isCachedResult = result.isCachedResult;
    outputFiles = result.outputFiles;
  } else if (exitCode !== 0) {
    extraction = createNoOutputExtraction(exitCode);
  }

  // Create output files if needed
  const shouldCreateFiles = exitCode !== 0 || options.debug;
  if (shouldCreateFiles && !outputFiles) {
    outputFiles = await createStepOutputFiles(stepName, stdout, stderr, combinedLines, options.verbose, options.log, { outputDir, treeHash: options.treeHash });
  }

  return { extraction, isCachedResult, outputFiles };
}

/**
 * Options for executing a single step
 */
interface ExecuteSingleStepOptions {
  step: ValidationStep;
  env: Record<string, string>;
  verbose: boolean;
  yaml: boolean;
  debug: boolean;
  maxNameLength: number;
  log: (_msg: string) => void;
  previousRun?: ValidationConfig['previousRun'];
  /** Containing phase name (propagated into VV_PARENT_CONTEXT) */
  phaseName?: string;
  /** Pre-computed git tree hash for the current run */
  treeHash?: string;
  /** Pre-computed run id for the current run */
  runId?: string;
}

/**
 * Format timestamp for display in cache indicators
 *
 * Converts ISO 8601 timestamp to human-readable format.
 *
 * @param timestamp - ISO 8601 timestamp string
 * @returns Formatted date and time string (e.g., "2026-02-12 10:30")
 *
 * @internal
 */
function formatCacheTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    // Format as YYYY-MM-DD HH:MM
    return date.toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return timestamp; // Fallback to original if parsing fails
  }
}

/**
 * Execute a single validation step (or use cached result if available)
 */
/**
 * Build a skipped step result for runScope filtering
 */
function buildSkippedStepResult(step: ValidationStep): { output: string; stepResult: StepResult } {
  return {
    output: '',
    stepResult: {
      name: step.name,
      command: step.command,
      passed: true,
      durationSecs: 0,
      exitCode: 0,
    },
  };
}

/**
 * Try to use a cached result from a previous run. Returns null if no cache hit.
 */
function tryUseCachedResult(
  step: ValidationStep,
  paddedName: string,
  maxNameLength: number,
  previousRun: ValidationConfig['previousRun'],
  verbose: boolean,
  log: (msg: string) => void,
): { output: string; stepResult: StepResult } | null {
  const previousStep = previousRun ? findPreviousStepResult(previousRun, step.name) : null;
  const isRetryFailed = Boolean(previousRun);

  if (!shouldUseCachedResult(previousStep, isRetryFailed)) {
    return null;
  }

  // previousStep is guaranteed non-null by shouldUseCachedResult check
  if (!previousStep) {
    throw new Error('Internal error: previousStep should not be null after shouldUseCachedResult');
  }

  const formattedTimestamp = formatCacheTimestamp(previousRun?.timestamp ?? '');
  log(`   ⏳ ${paddedName}  →  ${step.command}`);
  if (verbose) {
    log(`      ⚡ Cached from ${formattedTimestamp}`);
  }
  log(`      ✅ ${step.name.padEnd(maxNameLength)} - PASSED (${previousStep.durationSecs}s)`);

  return { output: '', stepResult: { ...previousStep, isCachedResult: true } };
}

async function executeSingleStep(options: ExecuteSingleStepOptions): Promise<{ output: string; stepResult: StepResult }> {
  const { step, env, verbose, yaml, debug, maxNameLength, log, previousRun, phaseName, treeHash, runId } = options;
  const paddedName = step.name.padEnd(maxNameLength);

  // Check if step should be skipped based on runScope
  const isCI = Boolean(process.env.CI);
  if (shouldSkipByRunScope(step.runScope, isCI)) {
    log(`   ⏭️  ${paddedName}  →  ${getRunScopeSkipReason(step.runScope)}`);
    return buildSkippedStepResult(step);
  }

  // Check if we can use cached result from previous run
  const cachedResult = tryUseCachedResult(step, paddedName, maxNameLength, previousRun, verbose, log);
  if (cachedResult) {
    return cachedResult;
  }

  // Execute step normally (check if this is a retry of a previously failed step)
  const previousStep = previousRun ? findPreviousStepResult(previousRun, step.name) : null;
  const isRetryingFailedStep = previousRun && previousStep && !previousStep.passed;
  const commandPrefix = isRetryingFailedStep && verbose ? '🔄 Retrying...\n   ' : '';
  log(`   ${commandPrefix}⏳ ${paddedName}  →  ${step.command}`);

  const startTime = Date.now();
  // Resolve cwd relative to git root (if specified)
  const resolvedCwd = step.cwd ? resolveGitRelativePath(step.cwd) : undefined;

  // Build per-step ParentContext and inject into child env. Reuse the run-level
  // treeHash/runId when provided by runValidation (avoids extra git calls and
  // keeps the runId stable across all steps in this validation run).
  const resolvedTreeHash = treeHash ?? (await getGitTreeHash()).hash;
  const resolvedRunId = runId ?? makeRunId(resolvedTreeHash);
  const parent = readParentContext();
  const { env: stepEnv, outputDir: stepOutputDir } = buildStepEnv({
    step,
    baseEnv: env,
    parent,
    runId: resolvedRunId,
    treeHash: resolvedTreeHash,
    ...(phaseName ? { phaseName } : {}),
    verbose,
  });

  const proc = spawnCommand(step.command, { env: stepEnv, cwd: resolvedCwd });

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
    code,
    stdout,
    stderr,
    combinedLines,
    { treeHash: resolvedTreeHash, verbose, debug, log },
    stepOutputDir
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
    ...(isCachedResult === undefined ? {} : { isCachedResult }),
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
 * @param options - Execution options (enableFailFast, env, verbose, yaml, debug, etc.)
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
 *   { enableFailFast: true, env: { NODE_ENV: 'test' } }
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
  options: StepExecutionOptions = {}
): Promise<StepsOutcome> {
  const {
    enableFailFast = true,
    env = {},
    verbose = false,
    yaml = false,
    debug = false,
    previousRun,
    treeHash,
    runId,
  } = options;
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
    const { output, stepResult } = await executeSingleStep({
      step,
      env,
      verbose,
      yaml,
      debug,
      maxNameLength,
      log,
      previousRun,
      phaseName,
      treeHash,
      runId,
    });

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

  // Check if any step failed (for non-fail-fast mode). One result is pushed per
  // step, in order, so a result's index is its step's index.
  const failedStep = steps[stepResults.findIndex(r => !r.passed)];
  return failedStep
    ? { success: false, failedStep, outputs, stepResults }
    : { success: true, outputs, stepResults };
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
 * @param options - Execution options (enableFailFast, env, verbose, yaml, debug, etc.)
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
 *   { enableFailFast: true, env: { NODE_ENV: 'test' } }
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
  options: StepExecutionOptions = {}
): Promise<StepsOutcome> {
  const {
    enableFailFast = false,
    env = {},
    verbose = false,
    yaml = false,
    developerFeedback = false,
    debug = false,
    previousRun,
  } = options;
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
  // Siblings that fail-fast terminated → the step whose failure stopped them
  const stoppedByFailFast = new Map<ValidationStep, string>();

  // Helper functions (extracted to reduce nesting depth)
  const isWarning = (e: { severity?: string }) => e.severity === 'warning';
  const isNotWarning = (e: { severity?: string }) => e.severity !== 'warning';

  // Pre-compute per-step ParentContext env so the spawn executor below stays synchronous.
  // Reuse run-level treeHash/runId when provided by runValidation; otherwise fall back
  // to a single getGitTreeHash() call (used when runStepsInParallel is invoked directly).
  const parentCtx = readParentContext();
  const sharedTreeHash = options.treeHash ?? (await getGitTreeHash()).hash;
  const sharedRunId = options.runId ?? makeRunId(sharedTreeHash);
  const stepEnvs = new Map<string, { env: Record<string, string>; outputDir: string }>();
  for (const step of steps) {
    stepEnvs.set(step.name, buildStepEnv({
      step,
      baseEnv: env,
      parent: parentCtx,
      runId: sharedRunId,
      treeHash: sharedTreeHash,
      ...(phaseName ? { phaseName } : {}),
      verbose,
    }));
  }

  const results = await Promise.allSettled(
    steps.map(step =>
      new Promise<{ step: ValidationStep; output: string; durationSecs: number }>((resolve, reject) => {
        const paddedName = step.name.padEnd(maxNameLength);

        // Check if step should be skipped based on runScope
        const isCI = Boolean(process.env.CI);
        if (shouldSkipByRunScope(step.runScope, isCI)) {
          const skipReason = getRunScopeSkipReason(step.runScope);
          log(`   ⏭️  ${paddedName}  →  ${skipReason}`);

          const skippedStepResult: StepResult = {
            name: step.name,
            command: step.command,
            passed: true,
            durationSecs: 0,
            exitCode: 0,
          };

          stepResults.push(skippedStepResult);
          outputs.set(step.name, '');
          resolve({ step, output: '', durationSecs: 0 });
          return;
        }

        // Check if we can use cached result from previous run
        const previousStep = previousRun ? findPreviousStepResult(previousRun, step.name) : null;
        const isRetryFailed = Boolean(previousRun);

        if (shouldUseCachedResult(previousStep, isRetryFailed)) {
          // Use cached result - copy everything from previous step and mark as cached
          // previousStep is guaranteed non-null by shouldUseCachedResult check
          if (!previousStep) {
            reject(new Error('Internal error: previousStep should not be null after shouldUseCachedResult'));
            return;
          }

          log(`   ⏳ ${paddedName}  →  ${step.command}`);
          if (verbose) {
            log(`      ⚡ Using cached result from previous validation`);
          }
          const status = '✅';
          const result = 'PASSED';
          log(`      ${status} ${step.name.padEnd(maxNameLength)} - ${result} (${previousStep.durationSecs}s)`);

          const cachedStepResult: StepResult = {
            ...previousStep,
            isCachedResult: true,
          };

          stepResults.push(cachedStepResult);
          outputs.set(step.name, '');
          resolve({ step, output: '', durationSecs: previousStep.durationSecs });
          return;
        }

        // Execute step normally
        log(`   ⏳ ${paddedName}  →  ${step.command}`);

        const startTime = Date.now();

        // Resolve cwd relative to git root (if specified)
        const resolvedCwd = step.cwd ? resolveGitRelativePath(step.cwd) : undefined;
        const stepEnvEntry = stepEnvs.get(step.name);
        const stepEnv = stepEnvEntry?.env ?? env;
        // Output directory advertised in ParentContext.outputDir; the inline
        // file-creation block below writes to this same directory so the
        // advertised location matches the actual filesystem location.
        const stepOutputDir =
          stepEnvEntry?.outputDir ?? join(getTempDir('steps'), sharedRunId, slugifyStepName(step.name));
        const proc = spawnCommand(step.command, {
          env: stepEnv,
          cwd: resolvedCwd,
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
          (async () => {
            const durationMs = Date.now() - startTime;
            const durationSecs = Number.parseFloat((durationMs / 1000).toFixed(1));
            const stdout = stdoutAccumulator.value;
            const stderr = stderrAccumulator.value;
            const output = stdout + stderr;
            outputs.set(step.name, output);

            // Set only when fail-fast terminated this step because another one failed.
            // Such a step never finished, so it has not passed even if it exited 0
            // (a command that treats SIGTERM as a graceful cancel).
            const stoppedBy = stoppedByFailFast.get(step);
            // Normalize exit code: null means abnormal termination, and a stopped
            // step is never recorded as 0 — older releases reuse a step on
            // --retry-failed by exitCode === 0 alone. Both count as failure (1).
            const code = exitCode === null || (stoppedBy && exitCode === 0) ? 1 : exitCode;
            const succeeded = code === 0;

            log(`      ${formatParallelStepStatus(step.name.padEnd(maxNameLength), succeeded, stoppedBy)} (${durationSecs}s)`);

            // A step that failed on its own stops its siblings now, before the
            // extraction and file writes below, so they are not left running meanwhile.
            if (!succeeded && !stoppedBy) {
              firstFailure = handleFailFast(enableFailFast, firstFailure, step, output, processes, stoppedByFailFast, log);
            }

          // Extract errors ONLY from FAILED steps (code !== 0)
          // Rationale: Passing tests have no failures to extract. Including empty extraction
          // objects wastes tokens in LLM context. Only extract when there's value to provide.
          let extraction;
          let isCachedResult: boolean | undefined;
          let outputFiles;
          let outputFilesFromNestedCommand = false; // Track if outputFiles came from nested vv run

          // A sibling fail-fast terminated: whatever it printed before the kill
          // is partial, so do not extract "errors" from it.
          if (stoppedBy) {
            extraction = createStoppedExtraction(stoppedBy);
          }
          // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- Explicit null/undefined/empty check is clearer than optional chaining
          else if (code !== 0 && output && output.trim()) {
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
          } else if (code !== 0) {
            extraction = createNoOutputExtraction(code);
          }
          // If passing step (code === 0), extraction remains undefined (token optimization)

          // Create output files for failing steps or when debug mode is enabled
          // This provides full debugging context when needed
            const shouldCreateFiles = !succeeded || debug;
            if (shouldCreateFiles && !outputFiles) {
              // Only create files if not already provided by nested vibe-validate command
              try {
                // The run's tree hash, not a fresh one: hashing a large worktree per
                // failed (or stopped) step costs seconds each
                const treeHash = sharedTreeHash;
                // Use the same outputDir we advertised in ParentContext.outputDir
                // so the advertised location matches where the files actually live.
                await ensureDir(stepOutputDir);

                const writePromises: Promise<void>[] = [];

                // Generate unique filenames with tree hash and timestamp
                const stdoutFilename = getTempFilename(treeHash, 'log', `${step.name}-stdout`);
                const stderrFilename = getTempFilename(treeHash, 'log', `${step.name}-stderr`);
                const combinedFilename = getTempFilename(treeHash, 'jsonl', `${step.name}-combined`);

                // Write stdout.log (only if non-empty) using shared utility
                const { file: stdoutFile, promise: stdoutPromise } =
                  createLogFileWrite(stdout, stepOutputDir, stdoutFilename);
                if (stdoutPromise) writePromises.push(stdoutPromise);

                // Write stderr.log (only if non-empty) using shared utility
                const { file: stderrFile, promise: stderrPromise } =
                  createLogFileWrite(stderr, stepOutputDir, stderrFilename);
                if (stderrPromise) writePromises.push(stderrPromise);

                // Write combined.jsonl (always - timestamped interleaved output)
                const combinedFile = join(stepOutputDir, combinedFilename);
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
            passed: succeeded,
            ...(stoppedBy ? { stoppedByFailFast: true } : {}),
            ...(isCachedResult === undefined ? {} : { isCachedResult }), // Include cache status if available
            ...(extraction ? { extraction } : {}), // Conditionally include extraction
            ...((outputFiles && (outputFilesFromNestedCommand || !succeeded || debug)) ? { outputFiles } : {}), // Always show for nested commands, or when step failed/debug enabled (v0.15.0+)
          };

          // Only include extraction quality metrics when developerFeedback is enabled
          // Skip if extraction already has metadata (from smart extractors) - that's more accurate
          // This is for vibe-validate contributors to identify extraction improvement opportunities
          if (developerFeedback && extraction && !extraction.metadata && !stoppedBy) {
            processDeveloperFeedback(stepResult, extraction, log, isWarning, isNotWarning);
          }

            stepResults.push(stepResult);

            if (succeeded) {
              resolve({ step, output, durationSecs });
            } else {
              const error = new Error(`Validation step failed: ${step.name}`) as Error & { step: ValidationStep; output: string; durationSecs: number };
              error.step = step;
              error.output = output;
              error.durationSecs = durationSecs;
              reject(error);
            }
            // eslint-disable-next-line sonarjs/no-nested-functions -- Error handler required for async IIFE
          })().catch((error) => {
            // Handle errors in async close handler
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (verbose) {
              log(`      ⚠️  Error in close handler: ${errorMsg}`);
            }
            // Reject with error to fail validation
            reject(new Error(`Close handler error: ${errorMsg}`));
          }); // Close async IIFE
        });
      })
    )
  );

  // The failed step is the first, in config order, that failed on its own. A
  // sibling fail-fast stopped is not a failure of its own, so it never wins —
  // even when it is listed first. A rejection without a step of its own (a
  // close-handler error) is attributed to the step at that index.
  const rejected = steps.filter((_step, index) => results[index]?.status === 'rejected');
  const failedStep = rejected.find(step => !stoppedByFailFast.has(step)) ?? rejected[0];
  return failedStep
    ? { success: false, failedStep, outputs, stepResults }
    : { success: true, outputs, stepResults };
}

/**
 * Status column for one finished parallel step: PASSED, FAILED, or STOPPED for
 * a sibling fail-fast terminated after `stoppedBy` failed.
 */
function formatParallelStepStatus(paddedName: string, succeeded: boolean, stoppedBy: string | undefined): string {
  if (stoppedBy) {
    return `⏹️  ${paddedName} - STOPPED (fail-fast after ${stoppedBy} failed)`;
  }
  return succeeded ? `✅ ${paddedName} - PASSED` : `❌ ${paddedName} - FAILED`;
}

/**
 * Append step outputs to log file
 */
function appendStepOutputsToLog(
  logPath: string,
  outputs: Map<string, string>,
  stepResults: StepResult[]
): void {
  const failedStepNames = new Set(stepResults.filter(isOwnStepFailure).map(r => r.name));
  const stoppedStepNames = new Set(stepResults.filter(r => r.stoppedByFailFast).map(r => r.name));
  for (const [stepName, output] of outputs) {
    let label = '';
    if (failedStepNames.has(stepName)) {
      label = ' - FAILED';
    } else if (stoppedStepNames.has(stepName)) {
      label = ' - STOPPED (fail-fast)';
    }
    appendFileSync(logPath, `\n${'='.repeat(60)}\n`);
    appendFileSync(logPath, `${stepName}${label}\n`);
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
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 19 acceptable for main validation orchestration function (plugin loading, caching, phase execution, and result handling)
export async function runValidation(config: ValidationConfig): Promise<ValidationResult> {
  const {
    phases,
    logPath = join(normalizedTmpdir(), `validation-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.log`),
    enableFailFast = false,
    env = {},
    onPhaseStart,
    onPhaseComplete,
  } = config;

  // Get current working tree hash (deterministic, content-based)
  const currentTreeHash = config.treeHash ?? (await getGitTreeHash()).hash;
  // Stable per-validation-run identifier (used for ParentContext.runId / outputDir layout)
  const runId = makeRunId(currentTreeHash);

  // Note: Caching is now handled at the CLI layer via git notes
  // (see packages/cli/src/commands/validate.ts and @vibe-validate/history)

  // Initialize log file
  writeFileSync(logPath, `Validation started at ${new Date().toISOString()}\n\n`);

  // Load and register local plugins if configured
  // This must happen before any validation steps run, so extractors are available
  if (config.extractors) {
    try {
      const { discoverPlugins, registerPluginsToRegistry } = await import('@vibe-validate/extractors');

      // Auto-discover local plugins from vibe-validate-local-plugins/ directory
      const plugins = await discoverPlugins({
        baseDir: process.cwd(),
      });

      // Register plugins with the appropriate trust level
      const trustLevel = config.extractors.localPlugins?.trust ?? 'sandbox';
      if (plugins.length > 0) {
        registerPluginsToRegistry(plugins, trustLevel);
        appendFileSync(logPath, `Loaded ${plugins.length} local plugin(s) with trust level: ${trustLevel}\n\n`);
      }
    } catch (error) {
      // Fail-safe: If plugin loading fails, log but continue validation
      // This ensures validation never blocks due to plugin issues
      const errorMessage = error instanceof Error ? error.message : String(error);
      appendFileSync(logPath, `Warning: Plugin loading failed: ${errorMessage}\n\n`);
    }
  }

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
      {
        // A phase's own failFast wins; the run-level setting covers phases that leave it unset
        enableFailFast: phase.failFast ?? enableFailFast,
        env,
        verbose: config.verbose ?? false,
        yaml: config.yaml ?? false,
        developerFeedback: config.developerFeedback ?? false,
        debug: config.debug ?? false,
        previousRun: config.previousRun,
        treeHash: currentTreeHash,
        runId,
      }
    );
    const phaseDurationMs = Date.now() - phaseStartTime;
    const durationSecs = Number.parseFloat((phaseDurationMs / 1000).toFixed(1));

    // Append all outputs to log file
    appendStepOutputsToLog(logPath, result.outputs, result.stepResults);

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
    if (!result.success) {
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
    const cleanupPromises = [...activeProcesses].map(proc =>
      stopProcessGroup(proc, 'Validation step')
    );

    await Promise.all(cleanupPromises);
    process.exit(1);
  };

  process.on('SIGTERM', () => {
    cleanup('SIGTERM').catch((error) => {
      console.error('Error during SIGTERM cleanup:', error);
      process.exit(1);
    });
  });
  process.on('SIGINT', () => {
    cleanup('SIGINT').catch((error) => {
      console.error('Error during SIGINT cleanup:', error);
      process.exit(1);
    });
  });
}
