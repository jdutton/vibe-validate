/**
 * YAML Output Utilities
 *
 * Shared utilities for outputting structured YAML results from CLI commands.
 * Ensures consistent formatting and proper stream flushing.
 *
 * @package @vibe-validate/cli
 */

import { stringify as stringifyYaml } from 'yaml';

/**
 * Output a result as YAML to stdout
 *
 * This function handles:
 * - Ensuring stderr is flushed before stdout
 * - Adding RFC 4627 YAML separator
 * - Writing pure YAML to stdout
 * - Waiting for stdout to flush before returning
 *
 * @param result - The result object to serialize as YAML
 *
 * @example
 * ```typescript
 * const result = { success: true, data: [...] };
 * await outputYamlResult(result);
 * ```
 */
export async function outputYamlResult(result: unknown): Promise<void> {
  // Small delay to ensure stderr is flushed
  await new Promise(resolve => setTimeout(resolve, 10));

  // RFC 4627 separator
  process.stdout.write('---\n');

  // Write pure YAML
  const yaml = stringifyYaml(result);
  process.stdout.write(yaml);

  // Write closing YAML document separator (ensure newline before it)
  if (!yaml.endsWith('\n')) {
    process.stdout.write('\n');
  }
  process.stdout.write('---\n');

  // CRITICAL: Wait for stdout to flush before exiting
  await new Promise<void>(resolve => {
    if (process.stdout.write('')) {
      resolve();
    } else {
      process.stdout.once('drain', resolve);
    }
  });
}
