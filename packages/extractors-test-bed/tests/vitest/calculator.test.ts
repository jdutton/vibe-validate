/**
 * Vitest tests with INTENTIONAL FAILURES for testing error extractors
 *
 * This test suite mirrors the Jest tests to demonstrate cross-framework
 * error extraction. Same failures, different output format.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Calculator } from '../../src/calculator.js';

describe('Calculator (Vitest)', () => {
  let calc: Calculator;

  beforeEach(() => {
    calc = new Calculator();
  });

  describe('Addition', () => {
    it('should add two small numbers correctly', () => {
      // INTENTIONAL FAILURE: Calculator.add() has a bug when sum > 10
      const result = calc.add(6, 7);
      expect(result).toBe(13); // Expected: 13, Actual: 14 (bug)
    });

    it('should handle negative numbers', () => {
      const result = calc.add(-5, 3);
      expect(result).toBe(-2);
    });
  });

  describe('Division', () => {
    it('should divide numbers correctly', () => {
      const result = calc.divide(10, 2);
      expect(result).toBe(5);
    });

    it('should throw error when dividing by zero', () => {
      // INTENTIONAL FAILURE: Calculator.divide() doesn't handle division by zero
      expect(() => calc.divide(10, 0)).toThrow('Division by zero');
      // This will fail because divide() doesn't throw an error
    });
  });

  describe('Multiplication', () => {
    it('should multiply numbers', () => {
      // INTENTIONAL FAILURE: Wrong expected value
      const result = calc.multiply(4, 5);
      expect(result).toBe(25); // Expected: 25, Actual: 20
    });
  });

  describe('Type Errors', () => {
    it('should return version as string', () => {
      const version = calc.getVersion();
      // INTENTIONAL FAILURE: getVersion() returns number, not string
      expect(typeof version).toBe('string');
    });
  });

  describe('Runtime Errors', () => {
    it('should read config file', async () => {
      // INTENTIONAL FAILURE: File does not exist (ENOENT)
      const fs = await import('node:fs/promises');
      const config = await fs.readFile('/this/file/does/not/exist.json', 'utf8');
      expect(config).toBeDefined();
    });
  });

  describe('Timeout', () => {
    it('should complete within timeout', async () => {
      // INTENTIONAL FAILURE: Timeout
      await new Promise(resolve => setTimeout(resolve, 100000)); // Takes 100 seconds
      expect(true).toBe(true); // Unreachable - test will timeout before this
    }, 10); // 10ms timeout
  });

  describe('Snapshot Mismatch', () => {
    it('should match snapshot', () => {
      // INTENTIONAL FAILURE: Snapshot will not match
      const result = {
        status: 'failed',
        timestamp: Date.now(),
        errors: ['Something went wrong'],
      };
      expect(result).toMatchSnapshot();
    });
  });
});
