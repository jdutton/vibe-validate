/**
 * Configuration Schema with Zod Validation
 *
 * TypeScript-first configuration system for vibe-validate.
 * Provides runtime validation and type safety for all configuration options.
 */

import { z } from 'zod';

import { GIT_DEFAULTS } from './constants.js';
import { createSafeValidator, createStrictValidator } from './schema-utils.js';

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

  /** Optional: Working directory for this step, relative to git root (default: git root) */
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

// Use input type (before defaults applied) to maintain optional field semantics
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

// Use input type (before defaults applied) to maintain optional field semantics
export type ValidationConfig = z.input<typeof ValidationConfigSchema>;

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

  /**
   * Disable workflow sync check in doctor command (default: false)
   *
   * Set to true if your workflow requires manual customization that can't be
   * generated automatically (e.g., multi-language projects requiring Java setup,
   * custom environment variables, or non-standard CI providers).
   *
   * When enabled, `vibe-validate doctor` will skip workflow sync validation.
   */
  disableWorkflowCheck: z.boolean().optional().default(false),
}).strict();

export type CIConfig = z.infer<typeof CIConfigSchema>;

/**
 * Secret Scanning Configuration Schema
 */
export const SecretScanningSchema = z.object({
  /** Enable secret scanning in pre-commit (default: true) */
  enabled: z.boolean().default(true),

  /**
   * Command to run for secret scanning (optional)
   * - Explicit command: "gitleaks protect --staged --verbose"
   * - Omit or "autodetect": Automatically detect and run available tools
   *
   * Default: autodetect (runs tools based on config file presence)
   * - Checks for .gitleaks.toml/.gitleaksignore and .secretlintrc.json
   * - Runs gitleaks if available and configured
   * - Runs secretlint (via npx) if configured
   * - Falls back to gitleaks or secretlint if no config files present
   */
  scanCommand: z.string().min(1, 'scanCommand cannot be empty').optional(),
}).strict();

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
 * Locking Configuration Schema
 *
 * Controls concurrent validation behavior and lock scoping.
 */
export const LockingConfigSchema = z.object({
  /** Enable locking to prevent concurrent validations (default: true) */
  enabled: z.boolean().default(true),

  /**
   * Concurrency scope for lock files (default: 'directory')
   * - 'directory': Each working directory has its own lock (allows parallel worktrees)
   * - 'project': All directories for the same project share a lock (prevents port/DB conflicts)
   */
  concurrencyScope: z.enum(['directory', 'project']).default('directory'),

  /**
   * Project identifier for project-scoped locking (optional)
   * Auto-detected from git remote URL or package.json if not specified.
   * Required when concurrencyScope is 'project' and cannot be auto-detected.
   */
  projectId: z.string().optional(),
}).strict();

export type LockingConfig = z.infer<typeof LockingConfigSchema>;

/**
 * Extractor Trust Level
 *
 * Controls security sandbox behavior for extractors:
 * - 'full': Run with full Node.js access (trusted code)
 * - 'sandbox': Run in isolated V8 context with limited API access (untrusted code)
 */
export const ExtractorTrustLevelSchema = z.enum(['full', 'sandbox']);

export type ExtractorTrustLevel = z.infer<typeof ExtractorTrustLevelSchema>;

/**
 * Extractor Category Config Schema
 *
 * Shared configuration for built-in and local plugin extractors.
 */
export const ExtractorCategoryConfigSchema = z.object({
  /** Trust level for extractors in this category (default varies by category) */
  trust: ExtractorTrustLevelSchema.optional(),

  /** List of extractor names to disable (default: []) */
  disable: z.array(z.string()).optional().default([]),
}).strict();

export type ExtractorCategoryConfig = z.infer<typeof ExtractorCategoryConfigSchema>;

/**
 * External Extractor Config Schema
 *
 * Configuration for an explicit npm package extractor.
 */
export const ExternalExtractorConfigSchema = z.object({
  /** npm package name (e.g., '@my-org/vibe-validate-plugin-gradle') */
  package: z.string().min(1, 'Package name cannot be empty'),

  /** Trust level (default: 'sandbox') */
  trust: ExtractorTrustLevelSchema.optional().default('sandbox'),
}).strict();

export type ExternalExtractorConfig = z.infer<typeof ExternalExtractorConfigSchema>;

/**
 * Extractors Configuration Schema
 *
 * Controls extractor plugin loading, trust levels, and selective disabling.
 */
export const ExtractorsConfigSchema = z.object({
  /**
   * Built-in extractors configuration
   * Default: { trust: 'full', disable: [] }
   */
  builtins: ExtractorCategoryConfigSchema.optional().default({
    trust: 'full',
    disable: [],
  }),

  /**
   * Local plugins configuration (auto-discovered from vibe-validate-local-plugins/)
   * Default: { trust: 'sandbox', disable: [] }
   */
  localPlugins: ExtractorCategoryConfigSchema.optional().default({
    trust: 'sandbox',
    disable: [],
  }),

  /**
   * External npm package extractors (explicit registration required)
   * Default: []
   */
  external: z.array(ExternalExtractorConfigSchema).optional().default([]),
}).strict();

export type ExtractorsConfig = z.infer<typeof ExtractorsConfigSchema>;

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

  /** Locking configuration (concurrency control) */
  locking: LockingConfigSchema.optional().default({
    enabled: true,
    concurrencyScope: 'directory',
  }),

  /**
   * Extractor plugins configuration (optional)
   *
   * Controls trust levels and selective disabling for extractors:
   * - Built-in extractors (shipped with vibe-validate)
   * - Local plugins (auto-discovered from vibe-validate-local-plugins/)
   * - External npm packages (explicit registration required)
   *
   * Default: { builtins: { trust: 'full', disable: [] }, localPlugins: { trust: 'sandbox', disable: [] }, external: [] }
   */
  extractors: ExtractorsConfigSchema.optional().default({
    builtins: { trust: 'full', disable: [] },
    localPlugins: { trust: 'sandbox', disable: [] },
    external: [],
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

// Use input type (before defaults applied) to maintain optional field semantics
export type VibeValidateConfig = z.input<typeof VibeValidateConfigSchema>;

/**
 * Validate configuration object
 *
 * @param config - Configuration object to validate
 * @returns Validated configuration with defaults applied
 * @throws ZodError if validation fails
 */
export const validateConfig = createStrictValidator(VibeValidateConfigSchema);

/**
 * Safe validation function for VibeValidateConfig
 *
 * @param config - Configuration data to validate
 * @returns Validation result with success/error information
 */
export const safeValidateConfig = createSafeValidator(VibeValidateConfigSchema);
