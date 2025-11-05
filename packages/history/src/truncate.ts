/**
 * Output truncation utilities
 *
 * v0.15.0: Truncation no longer needed - extractors handle it
 * (MAX_ERRORS_IN_ARRAY = 10, output field removed from StepResult)
 */

import type { ValidationResult } from '@vibe-validate/core';

/**
 * Truncate validation result output to max bytes
 *
 * v0.15.0: No-op function - extraction is already truncated by extractors
 *
 * @param result - Validation result
 * @param _maxBytes - Unused (kept for backward compatibility)
 * @returns Same validation result (no truncation needed)
 */
export function truncateValidationOutput(
  result: ValidationResult,
  _maxBytes: number = 10000
): ValidationResult {
  // v0.15.0: Extraction already truncated by extractors (MAX_ERRORS_IN_ARRAY = 10)
  // output field removed from StepResult, so no truncation needed
  return result;
}
