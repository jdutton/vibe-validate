/**
 * Tests for parser-utils.ts shared parsing utilities
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';

import {
  collectLinesUntil,
  parseStackLocation,
  extractErrorType,
  COMMON_STACK_PATTERNS,
} from './parser-utils.js';

describe('collectLinesUntil', () => {
  it('should collect lines until condition is met', () => {
    const lines = ['line1', 'line2', 'STOP', 'line4', 'line5'];
    const result = collectLinesUntil(lines, 0, (line) => line === 'STOP');

    expect(result.lines).toEqual(['line1', 'line2']);
    expect(result.nextIndex).toBe(2);
  });

  it('should collect all remaining lines if condition never met', () => {
    const lines = ['line1', 'line2', 'line3'];
    const result = collectLinesUntil(lines, 0, (line) => line === 'NEVER');

    expect(result.lines).toEqual(['line1', 'line2', 'line3']);
    expect(result.nextIndex).toBe(3);
  });

  it('should start from specified index', () => {
    const lines = ['skip', 'skip', 'collect1', 'collect2', 'STOP'];
    const result = collectLinesUntil(lines, 2, (line) => line === 'STOP');

    expect(result.lines).toEqual(['collect1', 'collect2']);
    expect(result.nextIndex).toBe(4);
  });

  it('should handle empty line condition', () => {
    const lines = ['line1', 'line2', '', 'line4'];
    const result = collectLinesUntil(lines, 0, (line) => line.trim() === '');

    expect(result.lines).toEqual(['line1', 'line2']);
    expect(result.nextIndex).toBe(2);
  });

  it('should provide index to shouldStop callback', () => {
    const lines = ['line1', 'line2', 'line3', 'line4'];
    const result = collectLinesUntil(lines, 0, (_line, index) => index >= 2);

    expect(result.lines).toEqual(['line1', 'line2']);
    expect(result.nextIndex).toBe(2);
  });
});

describe('parseStackLocation', () => {
  describe('Context.<anonymous> patterns (Mocha)', () => {
    it('should parse Context.<anonymous> with file URL', () => {
      const line = '      at Context.<anonymous> (file:///tmp/test.js:42:10)';
      const result = parseStackLocation(line, COMMON_STACK_PATTERNS.contextAnonymous);

      expect(result).toEqual({
        // eslint-disable-next-line sonarjs/publicly-writable-directories -- Safe: test file path, not actual file operations
        file: '/tmp/test.js',
        line: 42,
        column: 10,
      });
    });

    it('should parse Context.<anonymous> without file URL', () => {
      const line = '      at Context.<anonymous> (test.js:42:10)';
      const result = parseStackLocation(line, COMMON_STACK_PATTERNS.contextAnonymous);

      expect(result).toEqual({
        file: 'test.js',
        line: 42,
        column: 10,
      });
    });

    it('should parse Context.<anonymous> without column', () => {
      const line = '      at Context.<anonymous> (/path/to/test.js:42)';
      const result = parseStackLocation(line, COMMON_STACK_PATTERNS.contextAnonymous);

      expect(result).toEqual({
        file: '/path/to/test.js',
        line: 42,
        column: undefined,
      });
    });
  });

  describe('UserContext.<anonymous> patterns (Jasmine)', () => {
    it('should parse UserContext.<anonymous>', () => {
      const line = '        at UserContext.<anonymous> (/private/tmp/jasmine-test.js:9:17)';
      const result = parseStackLocation(line, COMMON_STACK_PATTERNS.contextAnonymous);

      expect(result).toEqual({
        // eslint-disable-next-line sonarjs/publicly-writable-directories -- Safe: test file path, not actual file operations
        file: '/private/tmp/jasmine-test.js',
        line: 9,
        column: 17,
      });
    });
  });

  describe('Ava file:// URL patterns', () => {
    it('should parse › file:// format', () => {
      const line = '  › file:///Users/jeff/project/tests/ava/test.js:28:5';
      const result = parseStackLocation(line, COMMON_STACK_PATTERNS.avaFileUrl);

      expect(result).toEqual({
        file: '/Users/jeff/project/tests/ava/test.js',
        line: 28,
        column: 5,
      });
    });

    it('should parse at file:// format', () => {
      const line = '    at file:///tmp/test.js:118:21';
      const result = parseStackLocation(line, COMMON_STACK_PATTERNS.avaFileUrl);

      expect(result).toEqual({
        // eslint-disable-next-line sonarjs/publicly-writable-directories -- Safe: test file path, not actual file operations
        file: '/tmp/test.js',
        line: 118,
        column: 21,
      });
    });
  });

  describe('Simple file:line format', () => {
    it('should parse file.js:line format', () => {
      const line = 'tests/unit/helpers.test.js:128';
      const result = parseStackLocation(line, COMMON_STACK_PATTERNS.simpleFileLine);

      expect(result).toEqual({
        file: 'tests/unit/helpers.test.js',
        line: 128,
        column: undefined,
      });
    });

    it('should parse various file extensions', () => {
      const extensions = ['js', 'ts', 'mjs', 'cjs'];

      for (const ext of extensions) {
        const line = `test.${ext}:42`;
        const result = parseStackLocation(line, COMMON_STACK_PATTERNS.simpleFileLine);

        expect(result.file).toBe(`test.${ext}`);
        expect(result.line).toBe(42);
      }
    });
  });

  describe('Generic stack patterns', () => {
    it('should parse generic at function pattern', () => {
      const line = '      at Object.someFunction (test.js:42:15)';
      const result = parseStackLocation(line, COMMON_STACK_PATTERNS.generic);

      expect(result).toEqual({
        file: 'test.js',
        line: 42,
        column: 15,
      });
    });
  });

  it('should return empty object when no patterns match', () => {
    const line = 'some random line with no location';
    const result = parseStackLocation(line, COMMON_STACK_PATTERNS.contextAnonymous);

    expect(result).toEqual({});
  });

  it('should try patterns in order and return first match', () => {
    const line = '  at Context.<anonymous> (test.js:10:5)';
    const patterns = [
      ...COMMON_STACK_PATTERNS.simpleFileLine, // Won't match
      ...COMMON_STACK_PATTERNS.contextAnonymous, // Will match
    ];

    const result = parseStackLocation(line, patterns);

    expect(result).toEqual({
      file: 'test.js',
      line: 10,
      column: 5,
    });
  });
});

describe('extractErrorType', () => {
  it('should extract TypeError', () => {
    const message = "TypeError: Cannot read properties of null (reading 'value')";
    expect(extractErrorType(message)).toBe('TypeError');
  });

  it('should extract AssertionError', () => {
    const message = 'AssertionError: Expected 4 to equal 5';
    expect(extractErrorType(message)).toBe('AssertionError');
  });

  it('should extract AssertionError with code', () => {
    const message = 'AssertionError [ERR_ASSERTION]: Expected 1 to equal 2';
    expect(extractErrorType(message)).toBe('AssertionError');
  });

  it('should extract plain Error', () => {
    const message = 'Error: ENOENT: no such file or directory';
    expect(extractErrorType(message)).toBe('Error');
  });

  it('should extract ReferenceError', () => {
    const message = 'ReferenceError: foo is not defined';
    expect(extractErrorType(message)).toBe('ReferenceError');
  });

  it('should extract custom error types', () => {
    const message = 'ValidationError: Invalid input format';
    expect(extractErrorType(message)).toBe('ValidationError');
  });

  it('should return undefined for messages without error type', () => {
    const message = 'Expected 4 to equal 5';
    expect(extractErrorType(message)).toBeUndefined();
  });

  it('should return undefined for non-error messages', () => {
    const message = 'Some random text';
    expect(extractErrorType(message)).toBeUndefined();
  });

  it('should handle messages with colons but no error type', () => {
    const message = 'Warning: This is not an error';
    expect(extractErrorType(message)).toBeUndefined();
  });
});
