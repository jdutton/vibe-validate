/**
 * TypeScript-First Config Helper
 *
 * Provides a type-safe way to define vibe-validate configuration
 * with full IDE autocomplete and validation.
 */

import type { VibeValidateConfig } from './schema.js';

/**
 * Define a vibe-validate configuration
 *
 * This is a type-safe helper that provides IDE autocomplete and validation.
 * It performs no runtime operations - just returns the config object.
 *
 * @param config - Configuration object
 * @returns The same configuration object (type-checked)
 *
 * @example
 * ```typescript
 * // vibe-validate.config.ts
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
 */
export function defineConfig(config: VibeValidateConfig): VibeValidateConfig {
  return config;
}

/**
 * Deep merge two configuration objects
 *
 * Used for preset overrides - allows users to extend a preset
 * while overriding specific values.
 *
 * @param base - Base configuration (preset)
 * @param override - Override configuration (user customizations)
 * @returns Merged configuration
 */
export function mergeConfig(
  base: VibeValidateConfig,
  override: Partial<VibeValidateConfig>
): VibeValidateConfig {
  return {
    ...base,
    validation: {
      ...base.validation,
      ...(override.validation || {}),
      phases: override.validation?.phases || base.validation.phases,
      caching: {
        ...base.validation.caching,
        ...(override.validation?.caching || {}),
      },
    },
    git: {
      ...base.git,
      ...(override.git || {}),
    },
    output: {
      ...base.output,
      ...(override.output || {}),
    },
    preset: override.preset || base.preset,
    extends: override.extends || base.extends,
  };
}
