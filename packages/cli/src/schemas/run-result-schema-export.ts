/**
 * JSON Schema Export for Run Command Result
 *
 * Generates JSON Schema from Zod run result schema to enable
 * validation of examples in documentation and agent integration guides.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { RunResultSchema } from './run-result-schema.js';

/**
 * Generate JSON Schema from Zod run result schema
 *
 * This schema can be used to validate run command output in documentation:
 * ```yaml
 * # Example run result
 * command: npm test
 * exitCode: 1
 * extraction:
 *   errors:
 *     - file: src/index.test.ts
 *       line: 42
 *       message: Expected true, received false
 *   summary: "1 test failure"
 *   totalCount: 1
 *   errorSummary: "src/index.test.ts:42 - Expected true, received false"
 * ```
 *
 * @returns JSON Schema object
 */
export function generateRunResultJsonSchema(): object {
  return zodToJsonSchema(RunResultSchema, {
    name: 'RunResult',
    $refStrategy: 'none', // Inline all references for simplicity
    target: 'jsonSchema7',
  });
}

/**
 * Pre-generated JSON Schema (exported for bundling in npm package)
 */
export const runResultJsonSchema = generateRunResultJsonSchema();
