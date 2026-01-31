/**
 * Tests for output truncation (v0.15.0: now a no-op)
 */

import type { ValidationResult } from '@vibe-validate/core';
import { describe, it, expect } from 'vitest';

import { truncateValidationOutput } from '../src/truncate.js';

describe('truncateValidationOutput', () => {
  it('should return the same result (v0.15.0: truncation no longer needed)', () => {
    const result: ValidationResult = {
      passed: true,
      timestamp: '2025-10-21T14:30:15.123Z',
      treeHash: 'abc123',
      phases: [
        {
          name: 'test',
          durationSecs: 1.2,
          passed: true,
          steps: [
            {
              name: 'unit-tests',
              command: 'npm test',
              exitCode: 0,
              durationSecs: 1.2,
              passed: true,
            },
          ],
        },
      ],
    };

    const truncated = truncateValidationOutput(result, 10000);

    // v0.15.0: Function is now a no-op, returns same reference
    expect(truncated).toBe(result);
  });

  it('should handle results with extraction (v0.15.0)', () => {
    const result: ValidationResult = {
      passed: false,
      timestamp: '2025-10-21T14:30:15.123Z',
      treeHash: 'abc123',
      summary: 'Unit tests failed',
      failedStep: 'unit-tests',
      phases: [
        {
          name: 'test',
          durationSecs: 1.2,
          passed: false,
          steps: [
            {
              name: 'unit-tests',
              command: 'npm test',
              exitCode: 1,
              durationSecs: 1.2,
              passed: false,
              extraction: {
                errors: [{ file: 'test.ts', message: 'assertion failed' }],
                summary: '1 test failure',
                totalErrors: 1,
              },
            },
          ],
        },
      ],
    };

    const truncated = truncateValidationOutput(result, 10000);

    // v0.15.0: Extraction already truncated by extractors (MAX_ERRORS_IN_ARRAY = 10)
    expect(truncated).toBe(result);
    expect(truncated.phases?.[0]?.steps[0]?.extraction?.errors.length).toBe(1);
  });

  it('should work with minimal ValidationResult', () => {
    const result: ValidationResult = {
      passed: false,
      timestamp: '2025-10-21T14:30:15.123Z',
      treeHash: 'abc123',
      summary: 'Validation failed',
      failedStep: 'unit-tests',
    };

    const truncated = truncateValidationOutput(result, 10000);

    expect(truncated).toBe(result);
    expect(truncated.failedStep).toBe('unit-tests');
  });

  it('should ignore maxBytes parameter (deprecated)', () => {
    const result: ValidationResult = {
      passed: true,
      timestamp: '2025-10-21T14:30:15.123Z',
      treeHash: 'abc123',
    };

    // Different maxBytes values should have no effect
    const truncated1 = truncateValidationOutput(result, 100);
    const truncated2 = truncateValidationOutput(result, 100000);

    expect(truncated1).toBe(result);
    expect(truncated2).toBe(result);
    expect(truncated1).toBe(truncated2);
  });
});
