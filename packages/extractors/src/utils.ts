/**
 * Extractor Utilities
 *
 * Shared utility functions for error extraction.
 *
 * @package @vibe-validate/extractors
 */

/**
 * Remove ANSI color codes from text
 *
 * @param text - Text potentially containing ANSI escape sequences
 * @returns Clean text without color codes
 *
 * @example
 * ```typescript
 * const clean = stripAnsiCodes('\x1b[31mError\x1b[0m');
 * console.log(clean); // "Error"
 * ```
 */
export function stripAnsiCodes(text: string): string {
  // Control character \x1b is intentionally used to match ANSI escape codes
  // eslint-disable-next-line no-control-regex, sonarjs/no-control-regex -- \x1b is intentional for ANSI escape codes
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Extract error lines from output (filter out noise)
 *
 * Filters to lines that contain error indicators while removing:
 * - Empty lines
 * - npm script headers
 * - npm error prefixes
 *
 * @param output - Raw command output
 * @returns Array of relevant error lines
 *
 * @example
 * ```typescript
 * const errors = extractErrorLines(commandOutput);
 * console.log(errors); // ["file.ts:10:5 - error TS2322: Type mismatch"]
 * ```
 */
export function extractErrorLines(output: string): string[] {
  return output
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) return false;

      // Skip npm script headers
      if (trimmed.startsWith('>')) return false;

      // Skip npm errors (too verbose)
      if (trimmed.includes('npm ERR!')) return false;

      // Keep error/warning lines
      return trimmed.includes('error') ||
             trimmed.includes('Error') ||
             trimmed.includes('warning') ||
             trimmed.includes('FAIL') ||
             trimmed.includes('✗') ||
             trimmed.includes('❯');
    });
}
