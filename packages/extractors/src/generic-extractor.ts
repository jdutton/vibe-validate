/**
 * Generic Error Extractor
 *
 * Fallback extractor for unknown validation step types.
 * Removes npm noise and extracts meaningful error lines.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult } from './types.js';

/**
 * Generic error extractor (fallback)
 *
 * Cleans up command output by:
 * - Removing npm script headers
 * - Filtering out npm error lines
 * - Limiting output to 20 lines for token efficiency
 *
 * @param output - Raw command output
 * @param stepName - Name of validation step (for context)
 * @returns Structured error information
 *
 * @example
 * ```typescript
 * const result = extractGenericErrors(buildOutput, 'Build');
 * console.log(result.summary); // "Build failed - see output"
 * ```
 */
export function extractGenericErrors(output: string, stepName: string): ErrorExtractorResult {
  // Remove npm script headers and noise
  const cleaned = output
    .split('\n')
    .filter(line => {
      // Remove npm script noise
      if (line.startsWith('>')) return false;
      if (line.includes('npm ERR!')) return false;
      if (line.trim() === '') return false;
      return true;
    })
    .slice(0, 20)  // Limit to 20 lines for token efficiency
    .join('\n');

  return {
    errors: [],
    summary: `${stepName} failed - see output`,
    totalCount: 1,
    guidance: 'Review the output above and fix the errors',
    cleanOutput: cleaned
  };
}
