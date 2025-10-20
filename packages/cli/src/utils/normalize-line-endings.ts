/**
 * Cross-Platform Line Ending Normalization
 *
 * Provides utilities for handling line endings across different platforms.
 * Windows uses CRLF (\r\n), Unix/macOS uses LF (\n).
 *
 * @packageDocumentation
 */

/**
 * Normalize line endings to LF (\n)
 *
 * Converts Windows CRLF (\r\n) to Unix LF (\n) for consistent string processing.
 * This is critical for:
 * - Cross-platform string comparisons
 * - File content parsing (split by '\n')
 * - Test assertions that compare strings
 *
 * @param content - String with potentially mixed line endings
 * @returns String with normalized LF line endings
 *
 * @example
 * ```typescript
 * const windowsText = "line1\r\nline2\r\nline3";
 * const normalized = normalizeLineEndings(windowsText);
 * // Result: "line1\nline2\nline3"
 *
 * const lines = normalized.split('\n');
 * // Works correctly on all platforms
 * ```
 *
 * @public
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Split content by lines (cross-platform)
 *
 * Splits string by line breaks, handling both Windows (CRLF) and Unix (LF)
 * line endings automatically.
 *
 * @param content - String to split into lines
 * @returns Array of lines
 *
 * @example
 * ```typescript
 * // Works on all platforms
 * const lines = splitLines("line1\r\nline2\nline3");
 * // Result: ["line1", "line2", "line3"]
 * ```
 *
 * @public
 */
export function splitLines(content: string): string[] {
  return normalizeLineEndings(content).split('\n');
}
