/**
 * YAML Output Detection Utilities
 *
 * Efficient detection and extraction of YAML output from command execution.
 *
 * Unlike traditional YAML frontmatter (which has leading and trailing `---`),
 * this is used for commands that output YAML as their entire output:
 *
 * ```
 * > preamble from package manager
 * ---
 * yaml: content
 * goes: here
 * (no trailing ---)
 * ```
 *
 * @package @vibe-validate/git
 */

/**
 * YAML output regex pattern
 *
 * Matches YAML output from commands (NOT traditional frontmatter).
 * Traditional frontmatter has both leading and trailing `---`, but command
 * output only has leading `---` followed by YAML to end of output.
 *
 * Matches:
 * - `---` at start of string followed by newline (no preamble)
 * - OR `---` preceded by newline(s) (has preamble)
 *
 * Stops at trailing `---` if present (traditional frontmatter), otherwise matches to end.
 *
 * Pattern breakdown:
 * - `(?:^|\r?\n)`: Non-capturing group - start of string OR newline (optional \r for Windows)
 * - `(---\r?\n`: Capture group starts with `---` + newline
 * - `(?:(?!---(?:\r?\n|$))[\s\S])*`: Match any char UNLESS it starts the pattern `---` + (newline or end)
 * - `)`: End capture group
 *
 * The negative lookahead `(?!---(?:\r?\n|$))` prevents matching into a trailing `---` separator.
 *
 * Examples:
 * - `"---\nkey: value"` → matches, captures `"---\nkey: value"`
 * - `"preamble\n---\nkey: value"` → matches, captures `"---\nkey: value"`
 * - `"---\ntitle: Post\n---\nContent"` → matches, captures `"---\ntitle: Post\n"` (stops at trailing `---`)
 * - `"no yaml"` → no match
 */
const YAML_OUTPUT_PATTERN = /(?:^|\r?\n)(---\r?\n(?:(?!---(?:\r?\n|$))[\s\S])*)/;

/**
 * Extract YAML output content from command output
 *
 * Uses a single efficient regex pass instead of multiple string scans.
 * Handles both Unix (\n) and Windows (\r\n) line endings.
 *
 * @param output - Raw output that may contain YAML
 * @returns YAML content (including `---` separator) or null if no YAML found
 *
 * @example
 * ```typescript
 * extractYamlContent("---\nkey: value")
 * // Returns: "---\nkey: value"
 *
 * extractYamlContent("preamble\n---\nkey: value")
 * // Returns: "---\nkey: value"
 *
 * extractYamlContent("no yaml here")
 * // Returns: null
 * ```
 */
export function extractYamlContent(output: string): string | null {
  const match = YAML_OUTPUT_PATTERN.exec(output);
  return match ? match[1] : null;
}

/**
 * Extract YAML content and preamble from command output
 *
 * Useful when you need to separate package manager noise (preamble) from YAML output.
 *
 * @param output - Raw output that may contain preamble + YAML
 * @returns Object with yaml content and preamble, or null if no YAML found
 *
 * @example
 * ```typescript
 * extractYamlWithPreamble("> pnpm test\n---\nkey: value")
 * // Returns: { yaml: "---\nkey: value", preamble: "> pnpm test" }
 *
 * extractYamlWithPreamble("---\nkey: value")
 * // Returns: { yaml: "---\nkey: value", preamble: "" }
 *
 * extractYamlWithPreamble("no yaml")
 * // Returns: null
 * ```
 */
export function extractYamlWithPreamble(output: string): { yaml: string; preamble: string } | null {
  const match = YAML_OUTPUT_PATTERN.exec(output);
  if (!match) {
    return null;
  }

  const yamlContent = match[1];
  const yamlStartIndex = match.index + (match[0].length - yamlContent.length);
  const preamble = output.substring(0, yamlStartIndex).trim();

  return { yaml: yamlContent, preamble };
}
