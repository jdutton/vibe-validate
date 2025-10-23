/**
 * Configuration Schema with Zod Validation
 *
 * TypeScript-first configuration system for vibe-validate.
 * Provides runtime validation and type safety for all configuration options.
 */

import { z } from 'zod';
import { GIT_DEFAULTS } from './constants.js';

/**
 * Validation Step Schema
 *
 * Defines a single validation step (typecheck, lint, test, etc.)
 */
export const ValidationStepSchema = z.object({
  /** Human-readable step name (e.g., "TypeScript type checking") */
  name: z.string().min(1, 'Step name cannot be empty'),

  /** Command to execute (e.g., "npm run typecheck") */
  command: z.string().min(1, 'Command cannot be empty'),

  /** Optional: Description of what this step does (for documentation) */
  description: z.string().optional(),

  /** Optional: Custom timeout in milliseconds (default: inherited from phase) */
  timeout: z.number().positive().optional(),

  /** Optional: Continue on failure (default: false) */
  continueOnError: z.boolean().optional(),

  /** Optional: Environment variables for this step */
  env: z.record(z.string(), z.string()).optional(),

  /** Optional: Working directory for this step (default: project root) */
  cwd: z.string().optional(),
}).strict();

export type ValidationStep = z.infer<typeof ValidationStepSchema>;

/**
 * Validation Phase Schema
 *
 * Defines a phase containing one or more validation steps.
 * Phases are executed sequentially, but steps within a phase can be parallel.
 */
export const ValidationPhaseSchema = z.object({
  /** Phase name (e.g., "Pre-Qualification", "Testing") */
  name: z.string().min(1, 'Phase name cannot be empty'),

  /** Execute steps in parallel (default: false) */
  parallel: z.boolean().optional().default(false),

  /** Steps to execute in this phase */
  steps: z.array(ValidationStepSchema).min(1, 'Phase must have at least one step'),

  /** Optional: Default timeout for all steps (milliseconds, default: 300000 = 5min) */
  timeout: z.number().positive().optional().default(300000),

  /** Optional: Fail fast - stop on first error (default: true) */
  failFast: z.boolean().optional().default(true),
}).strict();

// Use input type which makes fields with defaults optional
export type ValidationPhase = z.input<typeof ValidationPhaseSchema>;

/**
 * Validation Config Schema
 */
export const ValidationConfigSchema = z.object({
  /** Validation phases to execute */
  phases: z.array(ValidationPhaseSchema).min(1, 'At least one phase required'),

  /** Optional: Fail fast - stop all validation on first phase failure (default: true) */
  failFast: z.boolean().optional().default(true),
}).strict();

export type ValidationConfig = z.infer<typeof ValidationConfigSchema>;

/**
 * Git Config Schema
 */
export const GitConfigSchema = z.object({
  /** Main branch name (default: main) */
  mainBranch: z.string().default(GIT_DEFAULTS.MAIN_BRANCH),

  /** Remote name (default: origin) */
  remoteOrigin: z.string().default(GIT_DEFAULTS.REMOTE_ORIGIN),

  /** Auto-sync with remote (default: false) */
  autoSync: z.boolean().default(GIT_DEFAULTS.AUTO_SYNC),

  /** Warn if branch is behind remote (default: true) */
  warnIfBehind: z.boolean().default(GIT_DEFAULTS.WARN_IF_BEHIND),
}).strict();

export type GitConfig = z.infer<typeof GitConfigSchema>;

/**
 * CI/CD Configuration Schema
 */
export const CIConfigSchema = z.object({
  /** Node.js versions to test in CI (default: ['20', '22']) */
  nodeVersions: z.array(z.string()).optional(),

  /** Operating systems to test in CI (default: ['ubuntu-latest']) */
  os: z.array(z.string()).optional(),

  /** Fail fast in matrix strategy (default: false) */
  failFast: z.boolean().optional(),

  /** Enable coverage reporting (default: false) */
  coverage: z.boolean().optional(),
}).strict();

export type CIConfig = z.infer<typeof CIConfigSchema>;

/**
 * Secret Scanning Configuration Schema
 */
export const SecretScanningSchema = z.object({
  /** Enable secret scanning in pre-commit (default: true) */
  enabled: z.boolean().default(true),

  /** Command to run for secret scanning (required when enabled) */
  scanCommand: z.string().min(1, 'scanCommand cannot be empty').optional(),
}).strict().refine(
  (data) => {
    // If enabled is true, scanCommand must be provided
    if (data.enabled && !data.scanCommand) {
      return false;
    }
    return true;
  },
  {
    message: 'scanCommand is required when secret scanning is enabled',
    path: ['scanCommand'],
  }
);

export type SecretScanningConfig = z.infer<typeof SecretScanningSchema>;

/**
 * Hooks Configuration Schema
 */
export const HooksConfigSchema = z.object({
  /** Pre-commit hook configuration */
  preCommit: z.object({
    /** Enable pre-commit hook checking (default: true) */
    enabled: z.boolean().default(true),

    /** Custom pre-commit command (default: 'npx vibe-validate pre-commit') */
    command: z.string().default('npx vibe-validate pre-commit'),

    /** Secret scanning configuration (optional) */
    secretScanning: SecretScanningSchema.optional(),
  }).strict().optional().default({
    enabled: true,
    command: 'npx vibe-validate pre-commit',
  }),
}).strict();

export type HooksConfig = z.infer<typeof HooksConfigSchema>;

/**
 * Full Configuration Schema
 *
 * Root configuration object for vibe-validate.
 */
export const VibeValidateConfigSchema = z.object({
  /** Validation configuration */
  validation: ValidationConfigSchema,

  /** Git integration configuration */
  git: GitConfigSchema.optional().default({
    mainBranch: GIT_DEFAULTS.MAIN_BRANCH,
    remoteOrigin: GIT_DEFAULTS.REMOTE_ORIGIN,
    autoSync: GIT_DEFAULTS.AUTO_SYNC,
    warnIfBehind: GIT_DEFAULTS.WARN_IF_BEHIND,
  }),

  /** CI/CD configuration (for GitHub Actions workflow generation) */
  ci: CIConfigSchema.optional(),

  /** Hooks configuration (pre-commit, etc.) */
  hooks: HooksConfigSchema.optional().default({
    preCommit: {
      enabled: true,
      command: 'npx vibe-validate pre-commit',
    },
  }),

  /**
   * Developer feedback for continuous quality improvement (optional, default: false)
   *
   * When enabled, provides additional alerts about extraction quality failures
   * to help improve extractors through dogfooding. Useful for:
   * - vibe-validate contributors
   * - Projects building custom extractors
   * - Teams wanting to improve validation feedback
   */
  developerFeedback: z.boolean().optional().default(false),
}).strict();

export type VibeValidateConfig = z.infer<typeof VibeValidateConfigSchema>;

/**
 * Validate configuration object
 *
 * @param config - Configuration object to validate
 * @returns Validated configuration with defaults applied
 * @throws ZodError if validation fails
 */
export function validateConfig(config: unknown): VibeValidateConfig {
  return VibeValidateConfigSchema.parse(config);
}

/**
 * Safely validate configuration with detailed error messages
 *
 * @param config - Configuration object to validate
 * @returns Result object with success flag and data or errors
 */
export function safeValidateConfig(config: unknown): {
  success: boolean;
  data?: VibeValidateConfig;
  errors?: string[];
} {
  const result = VibeValidateConfigSchema.safeParse(config);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format Zod errors into readable messages
  const errors = result.error.issues.map(err => {
    const path = err.path.map(String).join('.');
    return `${path}: ${err.message}`;
  });

  return { success: false, errors };
}
