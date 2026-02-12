/**
 * Tests for StepResult schema validation
 *
 * Ensures the schema properly validates step results with extraction field
 */

import { describe, it, expect } from 'vitest';

import {
  StepResultSchema,
  StepResultStrictSchema,
  type StepResult,
} from '../src/result-schema.js';

/**
 * Creates a minimal valid failed step with a deprecated field for rejection tests.
 * @param deprecatedField - Record with one deprecated field to inject
 */
function createStepWithDeprecatedField(deprecatedField: Record<string, unknown>): unknown {
  return {
    name: 'test',
    command: 'npm test',
    exitCode: 1,
    passed: false,
    durationSecs: 1.5,
    ...deprecatedField,
  };
}

/**
 * Creates extraction metadata for step tests.
 */
function createExtractionMetadata(overrides: Record<string, unknown> = {}) {
  return {
    confidence: 100,
    completeness: 100,
    issues: [],
    detection: {
      extractor: 'vitest',
      confidence: 100,
      patterns: [],
      reason: 'test',
    },
    ...overrides,
  };
}

/**
 * Asserts that strict step schema rejects a deprecated field with 'Unrecognized key'.
 * @param deprecatedField - Record with one deprecated field to inject
 */
function expectStrictStepRejectsField(deprecatedField: Record<string, unknown>) {
  const step = createStepWithDeprecatedField(deprecatedField);
  const result = StepResultStrictSchema.safeParse(step);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.errors.some(e =>
      e.message.includes('Unrecognized key')
    )).toBe(true);
  }
}

/**
 * Asserts that parsed result keys follow the expected ordering.
 * @param keys - Object.keys() from a parsed result
 * @param expectedOrder - Expected field order
 */
function expectFieldOrder(keys: string[], expectedOrder: string[]) {
  let lastIndex = -1;
  for (const expectedKey of expectedOrder) {
    const currentIndex = keys.indexOf(expectedKey);
    if (currentIndex !== -1) {
      expect(currentIndex).toBeGreaterThan(lastIndex);
      lastIndex = currentIndex;
    }
  }
}

describe('StepResult Schema', () => {
  describe('extraction field', () => {
    it('should make extraction field optional (token optimization)', () => {
      const stepWithoutExtraction = {
        name: 'test',
        command: 'npm test',
        exitCode: 0,
        passed: true,  // passing steps don't need extraction
        durationSecs: 1.5,
      };

      const result = StepResultSchema.safeParse(stepWithoutExtraction);

      // Should succeed - extraction is optional (only for failed steps)
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.extraction).toBeUndefined();
      }
    });

    it('should accept valid StepResult with extraction', () => {
      const validStep: StepResult = {
        name: 'test',
        command: 'npm test',
        exitCode: 1,
        passed: false,
        durationSecs: 1.5,
        extraction: {
          errors: [
            {
              file: 'test.ts',
              line: 42,
              message: 'expected 5 to equal 3',
            },
          ],
          summary: '1 test failed',
          totalErrors: 1,
          guidance: 'Fix the assertion',
          errorSummary: 'test.ts:42 - expected 5 to equal 3',
          metadata: createExtractionMetadata(),
        },
      };

      const result = StepResultSchema.safeParse(validStep);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.extraction).toBeDefined();
        expect(result.data.extraction?.errors.length).toBe(1);
      }
    });

    it('should validate extraction structure', () => {
      const invalidStep = {
        name: 'test',
        command: 'npm test',
        exitCode: 1,
        passed: false,
        durationSecs: 1.5,
        extraction: {
          // Missing required fields
          summary: 'test failed',
        },
      };

      const result = StepResultSchema.safeParse(invalidStep);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.some(e => e.path.includes('extraction'))).toBe(true);
      }
    });
  });

  describe('field ordering for LLM optimization', () => {
    it('should have fields in optimal order', () => {
      const validStep: StepResult = {
        name: 'test',
        command: 'npm test',
        exitCode: 0,
        passed: true,
        durationSecs: 1.5,
        extraction: {
          errors: [],
          summary: 'All tests passed',
          totalErrors: 0,
          guidance: '',
          errorSummary: '',
          metadata: createExtractionMetadata(),
        },
      };

      const result = StepResultSchema.parse(validStep);

      // Verify field order by checking keys
      // Note: With schema composition, CommandExecutionSchema fields come first, then extended fields
      const keys = Object.keys(result);
      const expectedOrder = [
        'command',      // From CommandExecutionSchema
        'exitCode',     // From CommandExecutionSchema
        'durationSecs', // From CommandExecutionSchema
        'extraction',   // From CommandExecutionSchema (optional)
        'name',         // From .extend()
        'passed',       // From .extend()
      ];

      expectFieldOrder(keys, expectedOrder);
    });
  });

  describe('v0.15.0 breaking changes', () => {
    it('should reject deprecated output field (v0.14.x)', () => {
      expectStrictStepRejectsField({ output: 'old output field' });
    });

    it('should reject deprecated failedTests field (v0.14.x)', () => {
      expectStrictStepRejectsField({ failedTests: ['test.ts:42 - assertion failed'] });
    });
  });
});
