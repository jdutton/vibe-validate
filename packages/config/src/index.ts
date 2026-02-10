/**
 * @vibe-validate/config
 *
 * Configuration system for vibe-validate with YAML-first design
 * and Zod schema validation.
 *
 * @example Basic YAML configuration
 * ```yaml
 * # vibe-validate.config.yaml
 * $schema: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/config.schema.json
 *
 * git:
 *   mainBranch: main
 *
 * validation:
 *   phases:
 *     - name: Type Checking
 *       parallel: false
 *       steps:
 *         - name: TypeScript
 *           command: tsc --noEmit
 * ```
 */

// Core schema types and validation
export {
  type ValidationStep,
  type ValidationPhase,
  type ValidationConfig,
  type GitConfig,
  type CIConfig,
  type DependencyLockCheckConfig,
  type HooksConfig,
  type SecretScanningConfig,
  type ExtractorTrustLevel,
  type ExtractorCategoryConfig,
  type ExternalExtractorConfig,
  type ExtractorsConfig,
  type VibeValidateConfig,
  ValidationStepSchema,
  ValidationPhaseSchema,
  ValidationConfigSchema,
  GitConfigSchema,
  CIConfigSchema,
  DependencyLockCheckSchema,
  HooksConfigSchema,
  SecretScanningSchema,
  ExtractorTrustLevelSchema,
  ExtractorCategoryConfigSchema,
  ExternalExtractorConfigSchema,
  ExtractorsConfigSchema,
  VibeValidateConfigSchema,
  validateConfig,
  safeValidateConfig,
} from './schema.js';

// Config loading
export {
  CONFIG_FILE_NAME,
  loadConfigFromFile,
  findAndLoadConfig,
} from './loader.js';

// Git configuration constants and helpers
export { GIT_DEFAULTS } from './constants.js';
export { getRemoteBranch, getMainBranch, getRemoteOrigin } from './git-helpers.js';

// Shared schema utilities (foundational - no dependencies)
export { createSafeValidator, createStrictValidator } from './schema-utils.js';
