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
