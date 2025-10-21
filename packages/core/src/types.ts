/**
 * Core validation types for vibe-validate
 *
 * These types define the validation configuration structure and result types.
 */

/**
 * A single validation step (language-agnostic)
 */
export interface ValidationStep {
  /** Human-readable step name */
  name: string;

  /** Command to execute (can be any shell command, not just npm scripts) */
  command: string;

  /** Optional timeout in milliseconds */
  timeout?: number;

  /** Optional environment variables for this step */
  env?: Record<string, string>;
}

/**
 * A validation phase containing multiple steps
 */
export interface ValidationPhase {
  /** Human-readable phase name */
  name: string;

  /** Run steps in parallel? */
  parallel: boolean;

  /** Steps to execute in this phase */
  steps: ValidationStep[];
}

/**
 * Result from executing a validation step
 */
export interface StepResult {
  /** Step name */
  name: string;

  /** Did the step pass? */
  passed: boolean;

  /** Execution duration in seconds */
  durationSecs: number;

  /** Output from the step (stdout + stderr) */
  output?: string;
}

/**
 * Result from executing a validation phase
 */
export interface PhaseResult {
  /** Phase name */
  name: string;

  /** Phase execution duration in seconds */
  durationSecs: number;

  /** Did the phase pass? */
  passed: boolean;

  /** Results from individual steps */
  steps: StepResult[];

  /** Output from failed step (if any) */
  output?: string;
}

/**
 * Overall validation result
 */
export interface ValidationResult {
  /** Did validation pass? */
  passed: boolean;

  /** ISO 8601 timestamp */
  timestamp: string;

  /** Git tree hash (if in git repo) */
  treeHash: string;

  /** Results from each phase */
  phases?: PhaseResult[];

  /** Name of failed step (if any) */
  failedStep?: string;

  /** Command to re-run failed step */
  rerunCommand?: string;

  /** Output from the failed step */
  failedStepOutput?: string;

  /** Failed test names (if applicable) */
  failedTests?: string[];

  /** Path to full log file */
  fullLogFile?: string;

  /** Summary message */
  summary?: string;
}

/**
 * Validation configuration
 *
 * Note: State management (caching, forceRun) is now handled at the CLI layer
 * via git notes. See packages/cli/src/commands/validate.ts and @vibe-validate/history.
 */
export interface ValidationConfig {
  /** Validation phases to execute */
  phases: ValidationPhase[];

  /** Path to log file (default: os.tmpdir()/validation-{timestamp}.log) */
  logPath?: string;

  /** Enable fail-fast (stop on first failure) */
  enableFailFast?: boolean;

  /** Show verbose output (stream command stdout/stderr in real-time) */
  verbose?: boolean;

  /** Environment variables to pass to all child processes */
  env?: Record<string, string>;

  /** Callback when phase starts */
  onPhaseStart?: (_phase: ValidationPhase) => void;

  /** Callback when phase completes */
  onPhaseComplete?: (_phase: ValidationPhase, _result: PhaseResult) => void;

  /** Callback when step starts */
  onStepStart?: (_step: ValidationStep) => void;

  /** Callback when step completes */
  onStepComplete?: (_step: ValidationStep, _result: StepResult) => void;
}
