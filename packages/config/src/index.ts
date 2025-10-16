/**
 * @vibe-validate/config
 *
 * Configuration system for vibe-validate with TypeScript-first design,
 * Zod schema validation, and framework presets.
 *
 * @example
 * ```typescript
 * import { defineConfig } from '@vibe-validate/config';
 *
 * export default defineConfig({
 *   validation: {
 *     phases: [
 *       {
 *         name: 'Type Checking',
 *         parallel: false,
 *         steps: [
 *           { name: 'TypeScript', command: 'tsc --noEmit' }
 *         ]
 *       }
 *     ]
 *   }
 * });
 * ```
 *
 * @example Using a preset
 * ```typescript
 * import { defineConfig } from '@vibe-validate/config';
 *
 * export default defineConfig({
 *   preset: 'typescript-nodejs',
 *   validation: {
 *     phases: [
 *       // Override or extend preset phases
 *     ]
 *   }
 * });
 * ```
 */

// Core schema types and validation
export {
  type ValidationStep,
  type ValidationPhase,
  type ValidationConfig,
  type CachingStrategy,
  type OutputFormat,
  type GitConfig,
  type OutputConfig,
  type VibeValidateConfig,
  ValidationStepSchema,
  ValidationPhaseSchema,
  ValidationConfigSchema,
  CachingStrategySchema,
  OutputFormatSchema,
  GitConfigSchema,
  OutputConfigSchema,
  VibeValidateConfigSchema,
  validateConfig,
  safeValidateConfig,
} from './schema.js';

// Config definition helper
export { defineConfig, mergeConfig } from './define-config.js';

// Presets
export {
  typescriptLibraryPreset,
  typescriptNodejsPreset,
  typescriptReactPreset,
  PRESETS,
  getPreset,
  listPresets,
} from './presets/index.js';

// Config loading
export {
  CONFIG_FILE_NAMES,
  loadConfigFromFile,
  findAndLoadConfig,
  loadConfigWithFallback,
} from './loader.js';
