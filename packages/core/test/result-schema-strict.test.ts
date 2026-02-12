import { describe, it, expect } from 'vitest';

import {
  safeValidateResult,
  ValidationResultStrictSchema,
  StepResultStrictSchema,
  PhaseResultStrictSchema,
} from '../src/result-schema.js';

// ==================== Test Helper Functions ====================

/**
 * Creates a minimal valid result object with default values
 * @param overrides - Properties to override in the base result
 * @returns A result object suitable for validation testing
 */
function createBaseResult(overrides: Record<string, unknown> = {}) {
  return {
    passed: true,
    timestamp: '2025-11-04T16:00:00.000Z',
    treeHash: 'abc123def456',
    ...overrides,
  };
}

/**
 * Creates a valid step object with default values
 * @param overrides - Properties to override in the base step
 * @returns A step object for use in phase definitions
 */
function createStep(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Unit Tests',
    command: 'npm test',
    exitCode: 0,
    durationSecs: 10.5,
    passed: true,
    ...overrides,
  };
}

/**
 * Creates a valid phase object with default values
 * @param overrides - Properties to override in the base phase
 * @returns A phase object for use in result definitions
 */
function createPhase(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Testing',
    passed: true,
    durationSecs: 10.5,
    steps: [createStep()],
    ...overrides,
  };
}

/**
 * Validates a result using the strict schema and expects it to fail with specific error content.
 * Uses ValidationResultStrictSchema (not safeValidateResult) because strict rejection
 * is a write-time concern - the permissive base schema is for reading stored results.
 * @param resultData - The result object to validate
 * @param expectedErrorContent - String(s) expected in error messages
 */
function expectValidationFailure(
  resultData: Record<string, unknown>,
  expectedErrorContent: string | string[]
) {
  const result = ValidationResultStrictSchema.safeParse(resultData);
  expect(result.success).toBe(false);

  if (!result.success) {
    const errorStrings = Array.isArray(expectedErrorContent)
      ? expectedErrorContent
      : [expectedErrorContent];

    const errors = result.error.errors.map(e => e.message);
    const hasExpectedError = errorStrings.some(errorStr =>
      errors.some(e =>
        e.includes('Unrecognized key') || e.includes(errorStr)
      )
    );
    expect(hasExpectedError).toBe(true);
  }
}

/**
 * Validates a result and expects it to succeed
 * @param resultData - The result object to validate
 * @param assertions - Optional callback to perform additional assertions on validated data
 */
function expectValidationSuccess(
  resultData: Record<string, unknown>,
  assertions?: (_data: unknown) => void
) {
  const result = safeValidateResult(resultData);
  expect(result.success).toBe(true);

  if (result.success && assertions) {
    assertions(result.data);
  }
}

// ==================== End Test Helper Functions ====================

/**
 * Strict Schema Validation Tests
 *
 * These tests ensure ValidationResultSchema rejects unknown properties,
 * preventing internal fields (like _fromCache) from leaking into public API.
 *
 * Context: v0.15.0 bug where _fromCache appeared alongside isCachedResult
 * in YAML output due to missing .strict() on schema.
 */
describe('ValidationResultSchema - Strict Validation', () => {

  describe('should reject unknown properties', () => {
    it('should reject unknown property at root level', () => {
      expectValidationFailure(
        createBaseResult({ _fromCache: true }), // ❌ Unknown property - should be rejected
        '_fromCache'
      );
    });

    it('should reject _fromCache when isCachedResult is present', () => {
      expectValidationFailure(
        createBaseResult({
          isCachedResult: true,  // ✅ Valid field
          _fromCache: true,      // ❌ Internal field - should be rejected
        }),
        '_fromCache'
      );
    });

    it('should reject unknown properties in phases', () => {
      expectValidationFailure(
        createBaseResult({
          phases: [createPhase({ unknownField: 'should fail' })] // ❌ Unknown property
        }),
        'unknownField'
      );
    });

    it('should reject unknown properties in steps', () => {
      expectValidationFailure(
        createBaseResult({
          phases: [createPhase({
            steps: [createStep({ _internalFlag: true })] // ❌ Unknown property
          })]
        }),
        '_internalFlag'
      );
    });
  });

  describe('should accept valid schemas (with optional fields)', () => {
    it('should accept minimal valid result', () => {
      const validResult = createBaseResult();

      expectValidationSuccess(validResult, (data: unknown) => {
        expect(data).toMatchObject(validResult);
      });
    });

    it('should accept result with isCachedResult', () => {
      expectValidationSuccess(
        createBaseResult({ isCachedResult: true }), // ✅ Valid field (v0.15.0+)
        (data: unknown) => {
          expect((data as Record<string, unknown>).isCachedResult).toBe(true);
        }
      );
    });

    it('should accept result with all optional fields', () => {
      expectValidationSuccess(
        createBaseResult({
          passed: false,
          summary: 'TypeScript type check failed',
          isCachedResult: false,
          failedStep: 'TypeScript',
          phases: [{
            name: 'Pre-Qualification',
            passed: false,
            durationSecs: 5.2,
            steps: [{
              name: 'TypeScript',
              command: 'tsc --noEmit',
              exitCode: 1,
              durationSecs: 5.2,
              passed: false,
              extraction: {
                errors: [{
                  file: 'src/index.ts',
                  line: 42,
                  message: 'Type error',
                }],
                summary: '1 error',
                totalErrors: 1,
              }
            }]
          }]
        }),
        (data: unknown) => {
          const result = data as Record<string, unknown>;
          expect(result.isCachedResult).toBe(false);
          expect(result.failedStep).toBe('TypeScript');
          expect((result.phases as unknown[])).toHaveLength(1);
        }
      );
    });
  });

  describe('permissive read (safeValidateResult) vs strict write', () => {
    it('safeValidateResult should accept unknown fields at root level (forward compatibility)', () => {
      const resultWithUnknown = createBaseResult({ futureField: 'some-new-data' });
      const result = safeValidateResult(resultWithUnknown);
      expect(result.success).toBe(true);
      if (result.success) {
        // Unknown field should be stripped, not cause rejection
        expect((result.data as Record<string, unknown>).futureField).toBeUndefined();
        expect(result.data.passed).toBe(true);
      }
    });

    it('safeValidateResult should accept unknown fields in phases', () => {
      const resultWithUnknown = createBaseResult({
        phases: [createPhase({ newPhaseMetric: 42 })],
      });
      const result = safeValidateResult(resultWithUnknown);
      expect(result.success).toBe(true);
    });

    it('safeValidateResult should accept unknown fields in steps', () => {
      const resultWithUnknown = createBaseResult({
        phases: [createPhase({
          steps: [createStep({ newStepFeature: 'enabled' })],
        })],
      });
      const result = safeValidateResult(resultWithUnknown);
      expect(result.success).toBe(true);
    });

    it('ValidationResultStrictSchema should reject unknown fields at root level', () => {
      const resultWithUnknown = createBaseResult({ _fromCache: true });
      const result = ValidationResultStrictSchema.safeParse(resultWithUnknown);
      expect(result.success).toBe(false);
    });

    it('PhaseResultStrictSchema should reject unknown fields', () => {
      const phase = createPhase({ unknownField: 'bad' });
      const result = PhaseResultStrictSchema.safeParse(phase);
      expect(result.success).toBe(false);
    });

    it('StepResultStrictSchema should reject unknown fields', () => {
      const step = createStep({ _internalFlag: true });
      const result = StepResultStrictSchema.safeParse(step);
      expect(result.success).toBe(false);
    });
  });

  describe('v0.15.0 breaking changes', () => {
    it('should reject v0.14.x deprecated fields (rerunCommand, failedStepOutput)', () => {
      expectValidationFailure(
        createBaseResult({
          passed: false,
          failedStep: 'Unit Tests',
          rerunCommand: 'npm test',           // ❌ v0.14.x field - removed in v0.15.0
          failedStepOutput: 'Test failed',    // ❌ v0.14.x field - removed in v0.15.0
        }),
        ['rerunCommand', 'failedStepOutput']
      );
    });

    it('should reject deprecated output field in steps (v0.14.x)', () => {
      expectValidationFailure(
        createBaseResult({
          passed: false,
          phases: [createPhase({
            passed: false,
            steps: [createStep({
              exitCode: 1,
              passed: false,
              output: 'Test failed', // ❌ v0.14.x field - removed in v0.15.0
            })]
          })]
        }),
        'output'
      );
    });

    it('should reject deprecated failedTests field in steps (v0.14.x)', () => {
      expectValidationFailure(
        createBaseResult({
          passed: false,
          phases: [createPhase({
            passed: false,
            steps: [createStep({
              exitCode: 1,
              passed: false,
              failedTests: ['test1.ts: should pass'], // ❌ v0.14.x field - removed in v0.15.0
            })]
          })]
        }),
        'failedTests'
      );
    });
  });
});
