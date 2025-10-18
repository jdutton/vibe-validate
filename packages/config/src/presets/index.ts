/**
 * Built-in Framework Presets
 *
 * Pre-configured validation setups for common TypeScript project types.
 */

export { typescriptLibraryPreset } from './typescript-library.js';
export { typescriptNodejsPreset } from './typescript-nodejs.js';
export { typescriptReactPreset } from './typescript-react.js';

import type { VibeValidateConfig } from '../schema.js';
import { typescriptLibraryPreset } from './typescript-library.js';
import { typescriptNodejsPreset } from './typescript-nodejs.js';
import { typescriptReactPreset } from './typescript-react.js';

/**
 * Map of preset name to configuration
 */
export const PRESETS: Record<string, VibeValidateConfig> = {
  'typescript-library': typescriptLibraryPreset,
  'typescript-nodejs': typescriptNodejsPreset,
  'typescript-react': typescriptReactPreset,
};

/**
 * Get a preset by name
 *
 * @param name - Preset name
 * @returns Preset configuration or undefined if not found
 */
export function getPreset(name: string): VibeValidateConfig | undefined {
  return PRESETS[name];
}

/**
 * List all available preset names
 *
 * @returns Array of preset names
 */
export function listPresets(): string[] {
  return Object.keys(PRESETS);
}
