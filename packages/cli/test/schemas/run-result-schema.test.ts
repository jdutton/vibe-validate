/**
 * Tests for RunResult schema validation
 *
 * Ensures the schema properly validates run command outputs
 * and enforces the expected structure for LLM-optimized results.
 */

import { describe, it, expect } from 'vitest';

import {
  safeValidateRunResult,
  validateRunResult,
} from '../../src/schemas/run-result-schema.js';
import {
  createValidRunResult,
  createRunResultWithoutTreeHash,
  createRunResultWithInvalidTreeHash,
  createRunResultWithOutputFiles,
} from '../fixtures/run-result-fixtures.js';

describe('RunResult Schema', () => {
  describe('schema structure', () => {
    it('should allow treeHash to be optional', () => {
      const resultWithoutTreeHash = createRunResultWithoutTreeHash();

      const result = safeValidateRunResult(resultWithoutTreeHash);

      // treeHash is now optional to avoid duplication in output
      expect(result.success).toBe(true);
    });

    it('should accept valid RunResult with treeHash', () => {
      const validResult = createValidRunResult();

      const result = safeValidateRunResult(validResult);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.treeHash).toBe('abc123def456');
      }
    });

    it('should validate treeHash is a string', () => {
      const invalidResult = createRunResultWithInvalidTreeHash();

      const result = safeValidateRunResult(invalidResult);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some(e => e.includes('treeHash'))).toBe(true);
      }
    });
  });

  describe('field ordering for LLM optimization', () => {
    it('should have fields in optimal order', () => {
      const validResult = createRunResultWithOutputFiles({
        isCachedResult: true,
      });

      const result = validateRunResult(validResult);

      // Verify field order by checking keys
      // Note: With schema composition, OperationMetadataSchema + CommandExecutionSchema + .extend() fields
      const keys = Object.keys(result);
      const expectedOrder = [
        'timestamp',      // From OperationMetadataSchema
        'treeHash',       // From OperationMetadataSchema
        'command',        // From CommandExecutionSchema
        'exitCode',       // From CommandExecutionSchema
        'durationSecs',   // From CommandExecutionSchema
        'extraction',     // From CommandExecutionSchema (optional)
        'outputFiles',    // From .extend() (optional) - v0.15.0
        'isCachedResult', // From .extend() (optional)
      ];

      // Check that expected fields appear in order
      let lastIndex = -1;
      for (const expectedKey of expectedOrder) {
        const currentIndex = keys.indexOf(expectedKey);
        if (currentIndex !== -1) {
          expect(currentIndex).toBeGreaterThan(lastIndex);
          lastIndex = currentIndex;
        }
      }
    });
  });

  describe('safeValidateRunResult', () => {
    it('should return success for valid data', () => {
      const validData = createValidRunResult();

      const result = safeValidateRunResult(validData);

      expect(result.success).toBe(true);
    });

    it('should return errors for invalid data', () => {
      const invalidData = {
        // Missing required fields
        command: 'test',
      };

      const result = safeValidateRunResult(invalidData);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('validateRunResult', () => {
    it('should not throw for valid data', () => {
      const validData = createValidRunResult();

      expect(() => validateRunResult(validData)).not.toThrow();
    });

    it('should throw for invalid data', () => {
      const invalidData = {
        command: 'test',
        // Missing required fields
      };

      expect(() => validateRunResult(invalidData)).toThrow();
    });
  });
});
