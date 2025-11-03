/**
 * Cache key encoding for run command results
 *
 * Generates deterministic cache keys for storing command execution results in git notes.
 */

/**
 * Shell metacharacters that indicate a "complex" command where internal spacing should be preserved
 */
const SHELL_METACHARACTERS = [
  '"',  // Double quotes
  "'",  // Single quotes
  '`',  // Backticks
  '\\', // Backslash escapes
  '|',  // Pipes
  '>',  // Output redirect
  '<',  // Input redirect
  '&',  // Background/AND
  ';',  // Command separator
  '$',  // Variable expansion
];

/**
 * Check if command contains shell metacharacters that require preserving internal spacing
 */
function isComplexCommand(command: string): boolean {
  return SHELL_METACHARACTERS.some(char => command.includes(char));
}

/**
 * Normalize whitespace in a simple command (collapse multiple spaces/tabs to single space)
 */
function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ');
}

/**
 * Encode a run command cache key
 *
 * Cache keys uniquely identify command+workdir combinations for caching purposes.
 *
 * Normalization rules:
 * - Always trim leading/trailing whitespace from command and workdir
 * - For simple commands (no quotes/escapes/shell metacharacters): collapse multiple spaces
 * - For complex commands (has quotes, escapes, etc.): preserve internal spacing
 *
 * Format:
 * - Root directory: `command`
 * - Subdirectory: `workdir:command`
 *
 * @param command - The command to run (e.g., "npm test")
 * @param workdir - Working directory relative to git root ("" for root, "packages/cli" for subdirectory)
 * @returns Encoded cache key suitable for use in git ref paths
 *
 * @example
 * ```ts
 * // Simple command at root
 * encodeRunCacheKey('npm test', '')
 * // → encodeURIComponent('npm test')
 *
 * // Command with workdir
 * encodeRunCacheKey('npm test', 'packages/cli')
 * // → encodeURIComponent('packages/cli:npm test')
 *
 * // Whitespace normalization
 * encodeRunCacheKey('  npm  test  ', '')
 * // → encodeURIComponent('npm test')
 *
 * // Complex command (preserve internal spacing)
 * encodeRunCacheKey('echo "hello  world"', '')
 * // → encodeURIComponent('echo "hello  world"')
 * ```
 */
export function encodeRunCacheKey(command: string, workdir: string): string {
  // Trim leading/trailing whitespace
  const trimmedCommand = command.trim();
  const trimmedWorkdir = workdir.trim();

  // Handle empty command
  if (trimmedCommand === '') {
    return '';
  }

  // Normalize whitespace for simple commands only
  const normalizedCommand = isComplexCommand(trimmedCommand)
    ? trimmedCommand
    : normalizeWhitespace(trimmedCommand);

  // Construct cache key
  const cacheKey = trimmedWorkdir
    ? `${trimmedWorkdir}:${normalizedCommand}`
    : normalizedCommand;

  // Encode for safe use in git ref paths
  return encodeURIComponent(cacheKey);
}
