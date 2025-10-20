/**
 * Tests for Formatter Utility Functions
 *
 * @package @vibe-validate/formatters
 */

import { describe, it, expect } from 'vitest';
import { stripAnsiCodes, extractErrorLines } from '../src/utils.js';

describe('utils', () => {
  describe('stripAnsiCodes', () => {
    it('should remove red color codes', () => {
      const input = '\x1b[31mError\x1b[0m';
      const result = stripAnsiCodes(input);
      expect(result).toBe('Error');
    });

    it('should remove green color codes', () => {
      const input = '\x1b[32mSuccess\x1b[0m';
      const result = stripAnsiCodes(input);
      expect(result).toBe('Success');
    });

    it('should remove bold formatting', () => {
      const input = '\x1b[1mBold text\x1b[0m';
      const result = stripAnsiCodes(input);
      expect(result).toBe('Bold text');
    });

    it('should remove multiple ANSI codes', () => {
      const input = '\x1b[31m\x1b[1mBold Red\x1b[0m\x1b[0m';
      const result = stripAnsiCodes(input);
      expect(result).toBe('Bold Red');
    });

    it('should handle text without ANSI codes', () => {
      const input = 'Plain text';
      const result = stripAnsiCodes(input);
      expect(result).toBe('Plain text');
    });

    it('should remove ANSI codes from multiline text', () => {
      const input = '\x1b[31mLine 1\x1b[0m\n\x1b[32mLine 2\x1b[0m';
      const result = stripAnsiCodes(input);
      expect(result).toBe('Line 1\nLine 2');
    });

    it('should handle empty string', () => {
      const result = stripAnsiCodes('');
      expect(result).toBe('');
    });

    it('should remove complex color codes with parameters', () => {
      const input = '\x1b[38;5;214mOrange text\x1b[0m';
      const result = stripAnsiCodes(input);
      expect(result).toBe('Orange text');
    });
  });

  describe('extractErrorLines', () => {
    it('should extract lines containing "error"', () => {
      const output = 'Some text\nerror: something went wrong\nMore text';
      const result = extractErrorLines(output);
      expect(result).toEqual(['error: something went wrong']);
    });

    it('should extract lines containing "Error"', () => {
      const output = 'Some text\nTypeError: undefined is not a function\nMore text';
      const result = extractErrorLines(output);
      expect(result).toEqual(['TypeError: undefined is not a function']);
    });

    it('should extract lines containing "warning"', () => {
      const output = 'Some text\nwarning: deprecated API\nMore text';
      const result = extractErrorLines(output);
      expect(result).toEqual(['warning: deprecated API']);
    });

    it('should extract lines containing "FAIL"', () => {
      const output = 'Running tests\nFAIL src/test.ts\nDone';
      const result = extractErrorLines(output);
      expect(result).toEqual(['FAIL src/test.ts']);
    });

    it('should extract lines containing "✗" (cross mark)', () => {
      const output = 'Test results\n✗ should do something\nDone';
      const result = extractErrorLines(output);
      expect(result).toEqual(['✗ should do something']);
    });

    it('should extract lines containing "❯"', () => {
      const output = 'Test output\n   ❯ src/file.test.ts:42:5\nMore';
      const result = extractErrorLines(output);
      expect(result).toEqual(['   ❯ src/file.test.ts:42:5']);
    });

    it('should filter out empty lines', () => {
      const output = 'error: test\n\n\nerror: another';
      const result = extractErrorLines(output);
      expect(result).toEqual(['error: test', 'error: another']);
    });

    it('should filter out npm script headers (lines starting with >)', () => {
      const output = '> npm test\nerror: test failed';
      const result = extractErrorLines(output);
      expect(result).toEqual(['error: test failed']);
    });

    it('should filter out npm ERR! lines', () => {
      const output = 'error: test failed\nnpm ERR! code ELIFECYCLE\nerror: another';
      const result = extractErrorLines(output);
      expect(result).toEqual(['error: test failed', 'error: another']);
    });

    it('should handle output with no error lines', () => {
      const output = 'All tests passed\nEverything is fine';
      const result = extractErrorLines(output);
      expect(result).toEqual([]);
    });

    it('should handle empty output', () => {
      const result = extractErrorLines('');
      expect(result).toEqual([]);
    });

    it('should extract multiple error types together', () => {
      const output = `
Running tests
> npm test
error: TypeScript compilation failed
warning: unused variable
npm ERR! Test failed
FAIL src/test.ts
✗ should pass
❯ src/file.test.ts:10:3
Done
`;
      const result = extractErrorLines(output);
      expect(result).toEqual([
        'error: TypeScript compilation failed',
        'warning: unused variable',
        'FAIL src/test.ts',
        '✗ should pass',
        '❯ src/file.test.ts:10:3',
      ]);
    });

    it('should handle real TypeScript error output', () => {
      const output = `
> tsc --noEmit

src/index.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.

10     const x: number = "hello";
       ~~~~~

Found 1 error.
`;
      const result = extractErrorLines(output);
      expect(result).toContain("src/index.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.");
    });

    it('should handle real ESLint output', () => {
      const output = `
src/file.ts
  10:5  error  'x' is assigned a value but never used  no-unused-vars
  15:3  warning  Unexpected console statement  no-console

✗ 2 problems (1 error, 1 warning)
`;
      const result = extractErrorLines(output);
      expect(result.length).toBeGreaterThan(0);
      expect(result.some(line => line.includes('error'))).toBe(true);
    });
  });
});
