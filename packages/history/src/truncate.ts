/**
 * Output truncation utilities
 */

import type { ValidationResult } from '@vibe-validate/core';

/**
 * Truncate string to max bytes with message
 */
function truncateString(output: string, maxBytes: number): string {
  if (output.length <= maxBytes) return output;
  return output.slice(0, maxBytes) + `\n\n[... truncated ${output.length - maxBytes} bytes]`;
}

/**
 * Truncate phase outputs
 */
function truncatePhaseOutputs(phases: ValidationResult['phases'], maxBytes: number): void {
  if (!phases) return;

  for (const phase of phases) {
    if (!phase.steps) continue;

    for (const step of phase.steps) {
      if (step.output) {
        step.output = truncateString(step.output, maxBytes);
      }
    }
  }
}

/**
 * Truncate validation result output to max bytes
 *
 * @param result - Validation result to truncate
 * @param maxBytes - Maximum bytes per step output (default: 10000)
 * @returns Truncated validation result
 */
export function truncateValidationOutput(
  result: ValidationResult,
  maxBytes: number = 10000
): ValidationResult {
  // Deep clone to avoid mutating original
  const truncated = JSON.parse(JSON.stringify(result)) as ValidationResult;

  truncatePhaseOutputs(truncated.phases, maxBytes);

  return truncated;
}
