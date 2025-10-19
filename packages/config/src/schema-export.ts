/**
 * JSON Schema Export for YAML Configuration
 *
 * Generates JSON Schema from Zod configuration schema to enable
 * IDE validation and autocomplete for YAML config files.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { VibeValidateConfigSchema } from './schema.js';

/**
 * Generate JSON Schema from Zod config schema
 *
 * This schema can be referenced in YAML files using the $schema property:
 * ```yaml
 * $schema: ./node_modules/@vibe-validate/config/vibe-validate.schema.json
 * validation:
 *   phases: []
 * ```
 *
 * @returns JSON Schema object
 */
export function generateJsonSchema(): object {
  return zodToJsonSchema(VibeValidateConfigSchema, {
    name: 'VibeValidateConfig',
    $refStrategy: 'none', // Inline all references for simplicity
    target: 'jsonSchema7',
  });
}

/**
 * Pre-generated JSON Schema (exported for bundling in npm package)
 */
export const vibeValidateJsonSchema = generateJsonSchema();
