/**
 * Tests for output truncation
 */

import { describe, it, expect } from 'vitest';
import { truncateValidationOutput } from '../src/truncate.js';
import type { ValidationResult } from '@vibe-validate/core';

describe('truncateValidationOutput', () => {
  it('should not truncate output under max bytes', () => {
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
              passed: true,
              exitCode: 0,
              durationSecs: 1.2,
              output: 'Short output',
            },
          ],
        },
      ],
    };

    const truncated = truncateValidationOutput(result, 10000);

    expect(truncated.phases![0].steps[0].output).toBe('Short output');
  });

  it('should truncate output over max bytes', () => {
    const longOutput = 'a'.repeat(15000);

    const result: ValidationResult = {
      passed: false,
      timestamp: '2025-10-21T14:30:15.123Z',
      treeHash: 'abc123',
      phases: [
        {
          name: 'test',
          durationSecs: 1.2,
          passed: false,
          steps: [
            {
              name: 'unit-tests',
              passed: false,
              exitCode: 1,
              durationSecs: 1.2,
              output: longOutput,
            },
          ],
        },
      ],
    };

    const truncated = truncateValidationOutput(result, 10000);

    const output = truncated.phases![0].steps[0].output!;
    expect(output.length).toBeLessThan(longOutput.length);
    expect(output).toContain('[... truncated 5000 bytes]');
    expect(output.startsWith('a'.repeat(10))).toBe(true);
  });

  it('should not fail on ValidationResult without deprecated fields', () => {
    // Test that truncation works with new schema (no failedStepOutput field)
    const result: ValidationResult = {
      passed: false,
      timestamp: '2025-10-21T14:30:15.123Z',
      treeHash: 'abc123',
      summary: 'Validation failed',
      failedStep: 'unit-tests',
    };

    const truncated = truncateValidationOutput(result, 10000);

    // Should succeed without errors
    expect(truncated.passed).toBe(false);
    expect(truncated.failedStep).toBe('unit-tests');
  });

  it('should not mutate original result', () => {
    const longOutput = 'c'.repeat(15000);

    const result: ValidationResult = {
      passed: false,
      timestamp: '2025-10-21T14:30:15.123Z',
      treeHash: 'abc123',
      phases: [
        {
          name: 'test',
          durationSecs: 1.2,
          passed: false,
          steps: [
            {
              name: 'unit-tests',
              passed: false,
              exitCode: 1,
              durationSecs: 1.2,
              output: longOutput,
            },
          ],
        },
      ],
    };

    truncateValidationOutput(result, 10000);

    // Original should be unchanged
    expect(result.phases![0].steps[0].output).toBe(longOutput);
    expect(result.phases![0].steps[0].output!.length).toBe(15000);
  });
});
