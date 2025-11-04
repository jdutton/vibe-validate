/**
 * Run Output Parser
 *
 * Parses vibe-validate YAML output from command execution.
 * Handles cases where vibe-validate commands wrap each other.
 *
 * Used by:
 * - run command (packages/cli/src/commands/run.ts)
 * - validate phase runner (packages/core/src/runner.ts)
 *
 * @packageDocumentation
 */

import { parse as parseYaml } from 'yaml';
import { extractYamlContent } from '@vibe-validate/git';
import type { ErrorExtractorResult } from '@vibe-validate/extractors';

/**
 * Parsed vibe-validate output result
 */
export interface ParsedVibeValidateOutput {
  /** Type of result detected */
  type: 'run' | 'validate';

  /** Extracted error information */
  extraction: ErrorExtractorResult;

  /** The innermost command that was actually executed/cached */
  suggestedDirectCommand?: string;

  /** Whether this result came from cache */
  isCachedResult?: boolean;

  /** Path to full output log file (if available) */
  fullOutputFile?: string;

  /** Original tree hash from nested result */
  treeHash?: string;

  /** Exit code from nested command */
  exitCode?: number;

  /** Timestamp from nested command */
  timestamp?: string;
}

/**
 * Parse vibe-validate YAML output
 *
 * Detects and parses YAML output from nested vibe-validate commands:
 * - RunResult from `vibe-validate run`
 * - ValidationResult from `vibe-validate validate`
 *
 * @param output - Command output (stdout + stderr)
 * @returns Parsed result or null if no vibe-validate YAML detected
 */
export function parseVibeValidateOutput(output: string): ParsedVibeValidateOutput | null {
  try {
    // Extract YAML content (handles YAML frontmatter with --- separator)
    const yamlContent = extractYamlContent(output);
    if (!yamlContent) {
      return null; // No YAML found
    }

    // Parse the YAML
    const parsed = parseYaml(yamlContent) as Record<string, unknown>;

    // Detect RunResult (has command, exitCode, and optionally extraction)
    // Note: extraction may be absent for passing commands (exitCode 0)
    if (parsed.command && typeof parsed.command === 'string' &&
        parsed.exitCode !== undefined) {
      return parseRunResult(parsed);
    }

    // Detect ValidationResult (has passed, timestamp, phases)
    if (parsed.passed !== undefined &&
        parsed.timestamp &&
        parsed.phases) {
      return parseValidationResult(parsed);
    }

    // Unknown YAML format
    return null;

  // eslint-disable-next-line sonarjs/no-ignored-exceptions -- YAML parsing failure is expected for non-vibe-validate output
  } catch (_error) {
    // YAML parsing failed or invalid structure
    return null;
  }
}

/**
 * Parse RunResult YAML
 */
function parseRunResult(parsed: Record<string, unknown>): ParsedVibeValidateOutput {
  const extraction = parsed.extraction as ErrorExtractorResult | undefined;

  // If no extraction present (passing command), create minimal extraction
  const normalizedExtraction: ErrorExtractorResult = extraction ?? {
    summary: 'Success',
    totalErrors: 0,
    errors: [],
  };

  // Extract innermost command (unwrap nested run commands)
  const suggestedDirectCommand = extractInnermostCommand(parsed);

  return {
    type: 'run',
    extraction: normalizedExtraction,
    suggestedDirectCommand, // Always include (even if 'unknown')
    isCachedResult: parsed.isCachedResult as boolean | undefined,
    fullOutputFile: parsed.fullOutputFile as string | undefined,
    treeHash: parsed.treeHash as string | undefined,
    exitCode: parsed.exitCode as number | undefined,
    timestamp: parsed.timestamp as string | undefined,
  };
}

/**
 * Parse ValidationResult YAML
 *
 * Extracts errors from failed steps in validation phases.
 */
function parseValidationResult(parsed: Record<string, unknown>): ParsedVibeValidateOutput {
  const phases = parsed.phases as Array<{
    steps: Array<{
      passed: boolean;
      extraction?: ErrorExtractorResult;
    }>;
  }>;

  // Find first failed step with extraction
  let extraction: ErrorExtractorResult | undefined;
  for (const phase of phases) {
    for (const step of phase.steps) {
      if (!step.passed && step.extraction) {
        extraction = step.extraction;
        break;
      }
    }
    if (extraction) break;
  }

  // Fallback if no extraction found (shouldn't happen in practice)
  extraction ??= {
    summary: 'Validation failed',
    totalErrors: 0,
    errors: [],
  };

  return {
    type: 'validate',
    extraction,
    treeHash: parsed.treeHash as string | undefined,
    timestamp: parsed.timestamp as string | undefined,
  };
}

/**
 * Extract the innermost command from nested run results
 *
 * Examples:
 * - { command: "npm test" } → "npm test"
 * - { command: "...", suggestedDirectCommand: "npm test" } → "npm test"
 * - { command: "vibe-validate validate" } → "vibe-validate validate"
 */
function extractInnermostCommand(result: Record<string, unknown>): string {
  // If already has suggestedDirectCommand, use it (handles 3+ levels)
  if (result.suggestedDirectCommand && typeof result.suggestedDirectCommand === 'string') {
    return result.suggestedDirectCommand;
  }

  // Otherwise, use the command from the inner result
  if (result.command && typeof result.command === 'string') {
    return result.command;
  }

  return 'unknown';
}
