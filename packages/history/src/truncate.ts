/**
 * Output truncation utilities
 */

import type { ValidationResult } from '@vibe-validate/core';

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

  // Truncate phase outputs
  if (truncated.phases) {
    for (const phase of truncated.phases) {
      if (phase.steps) {
        for (const step of phase.steps) {
          if (step.output && step.output.length > maxBytes) {
            const originalLength = step.output.length;
            step.output =
              step.output.slice(0, maxBytes) +
              `\n\n[... truncated ${originalLength - maxBytes} bytes]`;
          }
        }
      }
    }
  }

  // Truncate failed step output
  if (
    truncated.failedStepOutput &&
    truncated.failedStepOutput.length > maxBytes
  ) {
    const originalLength = truncated.failedStepOutput.length;
    truncated.failedStepOutput =
      truncated.failedStepOutput.slice(0, maxBytes) +
      `\n\n[... truncated ${originalLength - maxBytes} bytes]`;
  }

  return truncated;
}
