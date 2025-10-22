/**
 * @vibe-validate/config
 *
 * Configuration system for vibe-validate with YAML-first design
 * and Zod schema validation.
 *
 * @example Basic YAML configuration
 * ```yaml
 * # vibe-validate.config.yaml
 * $schema: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json
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
  type HooksConfig,
  type SecretScanningConfig,
  type VibeValidateConfig,
  ValidationStepSchema,
  ValidationPhaseSchema,
  ValidationConfigSchema,
  GitConfigSchema,
  CIConfigSchema,
  HooksConfigSchema,
  SecretScanningSchema,
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
