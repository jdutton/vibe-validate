/**
 * OpenAPI Error Formatter
 *
 * Parses and formats OpenAPI specification validation errors for LLM consumption.
 *
 * @package @vibe-validate/formatters
 */

import type { ErrorFormatterResult } from './types.js';

/**
 * Format OpenAPI validation errors
 *
 * Extracts error lines from OpenAPI validator output (like Redocly CLI).
 *
 * @param output - Raw OpenAPI validator output
 * @returns Structured error information with OpenAPI-specific guidance
 *
 * @example
 * ```typescript
 * const result = formatOpenAPIErrors(validatorOutput);
 * console.log(result.summary); // "5 OpenAPI validation error(s)"
 * console.log(result.guidance); // "Check openapi.yaml against OpenAPI 3.1 specification"
 * ```
 */
export function formatOpenAPIErrors(output: string): ErrorFormatterResult {
  // OpenAPI errors typically include location in schema
  const lines = output.split('\n')
    .filter(line => line.includes('error') || line.includes('Error'))
    .slice(0, 10);

  const cleanOutput = lines.join('\n');

  return {
    errors: [],
    summary: `${lines.length} OpenAPI validation error(s)`,
    totalCount: lines.length,
    guidance: 'Check openapi.yaml against OpenAPI 3.1 specification',
    cleanOutput
  };
}
