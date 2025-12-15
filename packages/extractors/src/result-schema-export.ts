/**
 * JSON Schema Export for Error Extractor Result
 *
 * Generates JSON Schema from Zod error extractor result schema to enable
 * validation of examples in documentation and agent integration guides.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

import { ErrorExtractorResultSchema } from './result-schema.js';

/**
 * Generate JSON Schema from Zod error extractor result schema
 *
 * This schema can be used to validate extractor output in documentation:
 * ```yaml
 * # Example extractor result
 * errors:
 *   - file: src/index.ts
 *     line: 42
 *     message: Type error
 * summary: "1 type error(s), 0 warning(s)"
 * totalCount: 1
 * errorSummary: "src/index.ts:42 - Type error"
 * ```
 *
 * @returns JSON Schema object
 */
export function generateExtractorResultJsonSchema(): object {
  return zodToJsonSchema(ErrorExtractorResultSchema, {
    name: 'ErrorExtractorResult',
    $refStrategy: 'none', // Inline all references for simplicity
    target: 'jsonSchema7',
  });
}

/**
 * Pre-generated JSON Schema (exported for bundling in npm package)
 */
export const extractorResultJsonSchema = generateExtractorResultJsonSchema();
