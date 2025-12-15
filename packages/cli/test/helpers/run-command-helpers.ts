/**
 * Shared test helpers for run command tests
 *
 * Provides utilities for parsing run command YAML output and working with
 * run results in tests.
 */

import type { RunResult } from '@vibe-validate/core';
import yaml from 'yaml';

/**
 * Parses YAML output from vibe-validate run command
 *
 * Handles the standard YAML delimiter (---) and parses the content into
 * a typed RunResult object.
 *
 * @param output - Raw stdout from run command
 * @returns Parsed RunResult object
 *
 * @example
 * ```typescript
 * const output = execSync('vv run "echo test"');
 * const result = parseRunYamlOutput(output);
 * expect(result.exitCode).toBe(0);
 * expect(result.command).toBe('echo test');
 * ```
 */
export function parseRunYamlOutput(output: string): RunResult {
  // Parse YAML output - opening delimiter only (no display flags)
  if (!output.match(/^---\n/)) {
    throw new Error('Expected YAML output to start with --- delimiter');
  }

  // Strip both opening and closing --- separators
  const yamlContent = output.replace(/^---\n/, '').replace(/\n---\n?$/, '');
  return yaml.parse(yamlContent) as RunResult;
}

/**
 * Asserts that output contains valid run command YAML
 *
 * Throws if the output doesn't start with the YAML delimiter.
 *
 * @param output - Raw stdout to check
 *
 * @example
 * ```typescript
 * const output = execSync('vv run "echo test"');
 * expectValidRunYaml(output); // Passes
 * expectValidRunYaml('plain text'); // Throws
 * ```
 */
export function expectValidRunYaml(output: string): void {
  if (!output.match(/^---\n/)) {
    throw new Error(`Expected YAML output to start with --- delimiter, got: ${output.substring(0, 50)}`);
  }
}

/**
 * Parses run command YAML and asserts it's valid
 *
 * Combines expectValidRunYaml and parseRunYamlOutput for convenience.
 *
 * @param output - Raw stdout from run command
 * @returns Parsed RunResult object
 *
 * @example
 * ```typescript
 * const output = execSync('vv run "echo test"');
 * const result = parseAndValidateRunYaml(output);
 * expect(result.exitCode).toBe(0);
 * ```
 */
export function parseAndValidateRunYaml(output: string): RunResult {
  expectValidRunYaml(output);
  return parseRunYamlOutput(output);
}
