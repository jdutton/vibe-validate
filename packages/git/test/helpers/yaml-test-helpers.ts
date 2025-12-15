/**
 * Test helpers for YAML detection tests
 *
 * Provides utilities to create common test scenarios and reduce duplication
 * across YAML extraction tests.
 */

export interface YamlTestInput {
  yaml: string;
  preamble?: string;
  trailingContent?: string;
  lineEnding?: '\n' | '\r\n';
}

/**
 * Creates a YAML test input string with optional preamble and trailing content
 *
 * @example
 * ```typescript
 * // Simple YAML
 * createYamlInput({ yaml: 'key: value' })
 * // => '---\nkey: value\n'
 *
 * // With preamble
 * createYamlInput({ yaml: 'key: value', preamble: '> preamble' })
 * // => '> preamble\n---\nkey: value\n'
 *
 * // With trailing separator and content
 * createYamlInput({ yaml: 'title: Post', trailingContent: 'Content' })
 * // => '---\ntitle: Post\n---\nContent'
 * ```
 */
export function createYamlInput(options: YamlTestInput): string {
  const { yaml, preamble, trailingContent, lineEnding = '\n' } = options;

  let result = '';

  // Add preamble if provided
  if (preamble) {
    result += preamble + lineEnding;
    // Add blank line after preamble
    if (!preamble.endsWith(lineEnding + lineEnding)) {
      result += lineEnding;
    }
  }

  // Add YAML content (always starts with ---)
  if (!yaml.startsWith('---')) {
    result += '---' + lineEnding;
  }
  result += yaml;
  if (!yaml.endsWith(lineEnding)) {
    result += lineEnding;
  }

  // Add trailing separator and content if provided
  if (trailingContent !== undefined) {
    result += '---' + lineEnding;
    result += trailingContent;
  }

  return result;
}

/**
 * Converts Unix line endings to Windows line endings
 *
 * @example
 * ```typescript
 * toWindowsLineEndings('line1\nline2\n')
 * // => 'line1\r\nline2\r\n'
 * ```
 */
export function toWindowsLineEndings(text: string): string {
  return text.replaceAll(/\r?\n/g, '\r\n');
}

/**
 * Creates a simple YAML input with just key-value pairs
 *
 * @example
 * ```typescript
 * createSimpleYaml('key', 'value')
 * // => '---\nkey: value\n'
 *
 * createSimpleYaml('key', 'value', 'other', 'data')
 * // => '---\nkey: value\nother: data\n'
 * ```
 */
export function createSimpleYaml(...keyValuePairs: string[]): string {
  if (keyValuePairs.length % 2 !== 0) {
    throw new Error('Must provide an even number of arguments (key-value pairs)');
  }

  let yaml = '---\n';
  for (let i = 0; i < keyValuePairs.length; i += 2) {
    yaml += `${keyValuePairs[i]}: ${keyValuePairs[i + 1]}\n`;
  }
  return yaml;
}

/**
 * Creates a preamble string from lines
 *
 * @example
 * ```typescript
 * createPreamble('line 1', 'line 2', 'line 3')
 * // => 'line 1\nline 2\nline 3'
 * ```
 */
export function createPreamble(...lines: string[]): string {
  return lines.join('\n');
}

/**
 * Creates an npm script preamble (common pattern in test outputs)
 *
 * @example
 * ```typescript
 * createNpmPreamble('package@1.0.0', 'test', 'vitest run')
 * // => '> package@1.0.0 test\n> vitest run'
 * ```
 */
export function createNpmPreamble(packageName: string, script: string, command: string): string {
  return `> ${packageName} ${script}\n> ${command}`;
}

/**
 * Expected result for extractYamlWithPreamble
 */
export interface YamlWithPreambleResult {
  yaml: string;
  preamble: string;
}

/**
 * Creates an expected result object for extractYamlWithPreamble tests
 *
 * @example
 * ```typescript
 * expectYamlWithPreamble('---\nkey: value\n', 'preamble')
 * // => { yaml: '---\nkey: value\n', preamble: 'preamble' }
 * ```
 */
export function expectYamlWithPreamble(
  yaml: string,
  preamble = ''
): YamlWithPreambleResult {
  return { yaml, preamble };
}
