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
 * $schema: ./node_modules/@vibe-validate/config/config.schema.json
 * validation:
 *   phases: []
 * ```
 *
 * @returns JSON Schema object
 */
export function generateJsonSchema(): object {
  const schema = zodToJsonSchema(VibeValidateConfigSchema, {
    name: 'VibeValidateConfig',
    $refStrategy: 'none', // Inline all references for simplicity
    target: 'jsonSchema7',
  });
  markLevelsUnique(schema);
  return schema;
}

/**
 * Add `uniqueItems` to `validation.levels`, which Zod cannot express (the
 * schema's own refinement reports a duplicate level by name)
 *
 * @param schema - Generated JSON schema, changed in place
 * @throws Error when the generated shape no longer has `validation.levels`
 */
function markLevelsUnique(schema: object): void {
  const levels = (schema as {
    definitions?: { VibeValidateConfig?: { properties?: { validation?: { properties?: { levels?: Record<string, unknown> } } } } };
  }).definitions?.VibeValidateConfig?.properties?.validation?.properties?.levels;
  if (!levels) {
    throw new Error('Generated JSON schema has no validation.levels to mark unique');
  }
  levels.uniqueItems = true;
}

/**
 * Pre-generated JSON Schema (exported for bundling in npm package)
 */
export const vibeValidateJsonSchema = generateJsonSchema();
