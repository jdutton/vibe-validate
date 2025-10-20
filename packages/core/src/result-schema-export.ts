/**
 * JSON Schema Export for Validation Result
 *
 * Generates JSON Schema from Zod validation result schema to enable
 * validation of examples in documentation and agent integration guides.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { ValidationResultSchema } from './result-schema.js';

/**
 * Generate JSON Schema from Zod validation result schema
 *
 * This schema can be used to validate examples in documentation:
 * ```yaml
 * # Example validation result
 * passed: false
 * timestamp: "2025-10-20T12:00:00.000Z"
 * treeHash: "abc123..."
 * failedStep: "TypeScript"
 * ```
 *
 * @returns JSON Schema object
 */
export function generateValidationResultJsonSchema(): object {
  return zodToJsonSchema(ValidationResultSchema, {
    name: 'ValidationResult',
    $refStrategy: 'none', // Inline all references for simplicity
    target: 'jsonSchema7',
  });
}

/**
 * Pre-generated JSON Schema (exported for bundling in npm package)
 */
export const validationResultJsonSchema = generateValidationResultJsonSchema();
