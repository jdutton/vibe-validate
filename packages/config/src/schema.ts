/**
 * Configuration Schema with Zod Validation
 *
 * TypeScript-first configuration system for vibe-validate.
 * Provides runtime validation and type safety for all configuration options.
 */

import { z } from 'zod';

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

  /** Optional: Custom timeout in milliseconds (default: inherited from phase) */
  timeout: z.number().positive().optional(),

  /** Optional: Continue on failure (default: false) */
  continueOnError: z.boolean().optional(),

  /** Optional: Environment variables for this step */
  env: z.record(z.string(), z.string()).optional(),

  /** Optional: Working directory for this step (default: project root) */
  cwd: z.string().optional(),
});

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

  /** Optional: Phase names this phase depends on */
  dependsOn: z.array(z.string()).optional(),

  /** Steps to execute in this phase */
  steps: z.array(ValidationStepSchema).min(1, 'Phase must have at least one step'),

  /** Optional: Default timeout for all steps (milliseconds, default: 300000 = 5min) */
  timeout: z.number().positive().optional().default(300000),

  /** Optional: Fail fast - stop on first error (default: true) */
  failFast: z.boolean().optional().default(true),
});

// Use input type which makes fields with defaults optional
export type ValidationPhase = z.input<typeof ValidationPhaseSchema>;

/**
 * Caching Strategy Schema
 */
export const CachingStrategySchema = z.enum([
  'git-tree-hash',  // Content-based hashing (default)
  'timestamp',      // File modification time
  'disabled',       // No caching
]);

export type CachingStrategy = z.infer<typeof CachingStrategySchema>;

/**
 * Validation Config Schema
 */
export const ValidationConfigSchema = z.object({
  /** Validation phases to execute */
  phases: z.array(ValidationPhaseSchema).min(1, 'At least one phase required'),

  /** Caching configuration */
  caching: z.object({
    /** Caching strategy (default: git-tree-hash) */
    strategy: CachingStrategySchema.default('git-tree-hash'),

    /** Enable caching (default: true) */
    enabled: z.boolean().default(true),

    /** State file path (default: .vibe-validate-state.yaml) */
    statePath: z.string().default('.vibe-validate-state.yaml'),
  }).optional().default({
    strategy: 'git-tree-hash',
    enabled: true,
    statePath: '.vibe-validate-state.yaml',
  }),
});

export type ValidationConfig = z.infer<typeof ValidationConfigSchema>;

/**
 * Output Format Schema
 */
export const OutputFormatSchema = z.enum([
  'human',  // Colorful, verbose output for humans
  'yaml',   // Structured YAML for agents
  'json',   // Machine-readable JSON
  'auto',   // Auto-detect context (default)
]);

export type OutputFormat = z.infer<typeof OutputFormatSchema>;

/**
 * Git Config Schema
 */
export const GitConfigSchema = z.object({
  /** Main branch name (default: main) */
  mainBranch: z.string().default('main'),

  /** Auto-sync with remote (default: false) */
  autoSync: z.boolean().default(false),

  /** Warn if branch is behind remote (default: true) */
  warnIfBehind: z.boolean().default(true),
});

export type GitConfig = z.infer<typeof GitConfigSchema>;

/**
 * Output Config Schema
 */
export const OutputConfigSchema = z.object({
  /** Output format (default: auto) */
  format: OutputFormatSchema.default('auto'),

  /** Show progress indicators (default: true) */
  showProgress: z.boolean().default(true),

  /** Verbose logging (default: false) */
  verbose: z.boolean().default(false),

  /** Suppress ANSI colors (default: false) */
  noColor: z.boolean().default(false),
});

export type OutputConfig = z.infer<typeof OutputConfigSchema>;

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
});

export type CIConfig = z.infer<typeof CIConfigSchema>;

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
  }).optional().default({
    enabled: true,
    command: 'npx vibe-validate pre-commit',
  }),
});

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
    mainBranch: 'main',
    autoSync: false,
    warnIfBehind: true,
  }),

  /** Output formatting configuration */
  output: OutputConfigSchema.optional().default({
    format: 'auto',
    showProgress: true,
    verbose: false,
    noColor: false,
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

  /** Optional: Preset name (typescript-library, typescript-nodejs, etc.) */
  preset: z.string().optional(),

  /** Optional: Extend another config file */
  extends: z.string().optional(),
});

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
