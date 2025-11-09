import { describe, it, expect } from 'vitest';
import { safeValidateResult } from '../src/result-schema.js';

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
      const invalidResult = {
        passed: true,
        timestamp: '2025-11-04T16:00:00.000Z',
        treeHash: 'abc123def456',
        _fromCache: true, // ❌ Unknown property - should be rejected
      };

      const result = safeValidateResult(invalidResult);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toBeDefined();
        expect(result.errors.some(e =>
          e.includes('Unrecognized key') || e.includes('_fromCache')
        )).toBe(true);
      }
    });

    it('should reject _fromCache when isCachedResult is present', () => {
      const invalidResult = {
        passed: true,
        timestamp: '2025-11-04T16:00:00.000Z',
        treeHash: 'abc123def456',
        isCachedResult: true,  // ✅ Valid field
        _fromCache: true,      // ❌ Internal field - should be rejected
      };

      const result = safeValidateResult(invalidResult);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some(e =>
          e.includes('Unrecognized key') || e.includes('_fromCache')
        )).toBe(true);
      }
    });

    it('should reject unknown properties in phases', () => {
      const invalidResult = {
        passed: true,
        timestamp: '2025-11-04T16:00:00.000Z',
        treeHash: 'abc123def456',
        phases: [{
          name: 'Testing',
          passed: true,
          durationSecs: 10.5,
          unknownField: 'should fail', // ❌ Unknown property
          steps: [{
            name: 'Unit Tests',
            command: 'npm test',
            exitCode: 0,
            durationSecs: 10.5,
            passed: true,
          }]
        }]
      };

      const result = safeValidateResult(invalidResult);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some(e =>
          e.includes('Unrecognized key') || e.includes('unknownField')
        )).toBe(true);
      }
    });

    it('should reject unknown properties in steps', () => {
      const invalidResult = {
        passed: true,
        timestamp: '2025-11-04T16:00:00.000Z',
        treeHash: 'abc123def456',
        phases: [{
          name: 'Testing',
          passed: true,
          durationSecs: 10.5,
          steps: [{
            name: 'Unit Tests',
            command: 'npm test',
            exitCode: 0,
            durationSecs: 10.5,
            passed: true,
            _internalFlag: true, // ❌ Unknown property
          }]
        }]
      };

      const result = safeValidateResult(invalidResult);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some(e =>
          e.includes('Unrecognized key') || e.includes('_internalFlag')
        )).toBe(true);
      }
    });
  });

  describe('should accept valid schemas (with optional fields)', () => {
    it('should accept minimal valid result', () => {
      const validResult = {
        passed: true,
        timestamp: '2025-11-04T16:00:00.000Z',
        treeHash: 'abc123def456',
      };

      const result = safeValidateResult(validResult);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toMatchObject(validResult);
      }
    });

    it('should accept result with isCachedResult', () => {
      const validResult = {
        passed: true,
        timestamp: '2025-11-04T16:00:00.000Z',
        treeHash: 'abc123def456',
        isCachedResult: true, // ✅ Valid field (v0.15.0+)
      };

      const result = safeValidateResult(validResult);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isCachedResult).toBe(true);
      }
    });

    it('should accept result with all optional fields', () => {
      const validResult = {
        passed: false,
        timestamp: '2025-11-04T16:00:00.000Z',
        treeHash: 'abc123def456',
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
      };

      const result = safeValidateResult(validResult);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isCachedResult).toBe(false);
        expect(result.data.failedStep).toBe('TypeScript');
        expect(result.data.phases).toHaveLength(1);
      }
    });
  });

  describe('v0.15.0 breaking changes', () => {
    it('should reject v0.14.x deprecated fields (rerunCommand, failedStepOutput)', () => {
      const v014Result = {
        passed: false,
        timestamp: '2025-11-04T16:00:00.000Z',
        treeHash: 'abc123def456',
        failedStep: 'Unit Tests',
        rerunCommand: 'npm test',           // ❌ v0.14.x field - removed in v0.15.0
        failedStepOutput: 'Test failed',    // ❌ v0.14.x field - removed in v0.15.0
      };

      const result = safeValidateResult(v014Result);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some(e =>
          e.includes('Unrecognized key') && (e.includes('rerunCommand') || e.includes('failedStepOutput'))
        )).toBe(true);
      }
    });

    it('should reject deprecated output field in steps (v0.14.x)', () => {
      const v014Result = {
        passed: false,
        timestamp: '2025-11-04T16:00:00.000Z',
        treeHash: 'abc123def456',
        phases: [{
          name: 'Testing',
          passed: false,
          durationSecs: 10.5,
          steps: [{
            name: 'Unit Tests',
            command: 'npm test',
            exitCode: 1,
            durationSecs: 10.5,
            passed: false,
            output: 'Test failed', // ❌ v0.14.x field - removed in v0.15.0
          }]
        }]
      };

      const result = safeValidateResult(v014Result);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some(e =>
          e.includes('Unrecognized key') && e.includes('output')
        )).toBe(true);
      }
    });

    it('should reject deprecated failedTests field in steps (v0.14.x)', () => {
      const v014Result = {
        passed: false,
        timestamp: '2025-11-04T16:00:00.000Z',
        treeHash: 'abc123def456',
        phases: [{
          name: 'Testing',
          passed: false,
          durationSecs: 10.5,
          steps: [{
            name: 'Unit Tests',
            command: 'npm test',
            exitCode: 1,
            durationSecs: 10.5,
            passed: false,
            failedTests: ['test1.ts: should pass'], // ❌ v0.14.x field - removed in v0.15.0
          }]
        }]
      };

      const result = safeValidateResult(v014Result);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some(e =>
          e.includes('Unrecognized key') && e.includes('failedTests')
        )).toBe(true);
      }
    });
  });
});
