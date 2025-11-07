/**
 * Cache key encoding for run command results
 *
 * Generates deterministic cache keys for storing command execution results in git notes.
 */

import { createHash } from 'node:crypto';

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
 * - SHA256 hash of `command__workdir` (first 16 chars for brevity)
 * - Examples: `85ac6127576393ac` (for command+workdir combination)
 *
 * @param command - The command to run (e.g., "npm test")
 * @param workdir - Working directory relative to git root ("" for root, "packages/cli" for subdirectory)
 * @returns SHA256 hash (first 16 chars) suitable for use in git ref paths
 *
 * @example
 * ```ts
 * // Simple command at root
 * encodeRunCacheKey('npm test', '')
 * // → SHA256('npm test__')[:16]
 *
 * // Command with workdir
 * encodeRunCacheKey('npm test', 'packages/cli')
 * // → SHA256('npm test__packages/cli')[:16]
 *
 * // Whitespace normalization (simple commands)
 * encodeRunCacheKey('  npm  test  ', '')
 * // → SHA256('npm test__')[:16]
 *
 * // Complex command (preserve internal spacing)
 * encodeRunCacheKey('echo "hello  world"', '')
 * // → SHA256('echo "hello  world"__')[:16]
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

  // Construct cache key input (command__workdir)
  const cacheKeyInput = `${normalizedCommand}__${trimmedWorkdir}`;

  // Hash for safe use in git ref paths (URL encoding produces % which git rejects)
  // Use first 16 chars for brevity while maintaining uniqueness
  return createHash('sha256').update(cacheKeyInput).digest('hex').substring(0, 16);
}
