import { describe, it, expect } from 'vitest';

import { safeValidateResult } from '../src/result-schema.js';

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
 * Validates a result and expects it to fail with specific error content
 * @param resultData - The result object to validate
 * @param expectedErrorContent - String(s) expected in error messages
 */
function expectValidationFailure(
  resultData: Record<string, unknown>,
  expectedErrorContent: string | string[]
) {
  const result = safeValidateResult(resultData);
  expect(result.success).toBe(false);

  if (!result.success) {
    const errorStrings = Array.isArray(expectedErrorContent)
      ? expectedErrorContent
      : [expectedErrorContent];

    const hasExpectedError = errorStrings.some(errorStr =>
      result.errors.some(e =>
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

      expectValidationSuccess(validResult, (data: any) => {
        expect(data).toMatchObject(validResult);
      });
    });

    it('should accept result with isCachedResult', () => {
      expectValidationSuccess(
        createBaseResult({ isCachedResult: true }), // ✅ Valid field (v0.15.0+)
        (data: any) => {
          expect(data.isCachedResult).toBe(true);
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
        (data: any) => {
          expect(data.isCachedResult).toBe(false);
          expect(data.failedStep).toBe('TypeScript');
          expect(data.phases).toHaveLength(1);
        }
      );
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
