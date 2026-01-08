/**
 * Tests for parser-utils.ts shared parsing utilities
 *
 * @package @vibe-validate/extractors
 */

/* eslint-disable sonarjs/publicly-writable-directories -- Test file: all /tmp/ references are in expected output objects for parsing tests, not actual file operations */

import { describe, it, expect } from 'vitest';

import {
  collectLinesUntil,
  parseStackLocation,
  extractErrorType,
  COMMON_STACK_PATTERNS,
  type ParsedLocation,
  type StackLocationPattern,
} from './parser-utils.js';

// ============================================================================
// TEST HELPERS - DRY pattern for assertions
// ============================================================================

/**
 * Helper: Assert parseStackLocation result matches expected location
 */
function expectParsedLocation(
  line: string,
  patterns: StackLocationPattern[],
  expected: ParsedLocation
): void {
  const result = parseStackLocation(line, patterns);
  expect(result).toEqual(expected);
}

/**
 * Helper: Assert extractErrorType returns expected type
 */
function expectErrorType(message: string, expectedType?: string): void {
  const result = extractErrorType(message);
  if (expectedType === undefined) {
    expect(result).toBeUndefined();
  } else {
    expect(result).toBe(expectedType);
  }
}

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
      expectParsedLocation(
        '      at Context.<anonymous> (file:///tmp/test.js:42:10)',
        COMMON_STACK_PATTERNS.contextAnonymous,
        { file: '/tmp/test.js', line: 42, column: 10 }
      );
    });

    it('should parse Context.<anonymous> without file URL', () => {
      expectParsedLocation(
        '      at Context.<anonymous> (test.js:42:10)',
        COMMON_STACK_PATTERNS.contextAnonymous,
        { file: 'test.js', line: 42, column: 10 }
      );
    });

    it('should parse Context.<anonymous> without column', () => {
      expectParsedLocation(
        '      at Context.<anonymous> (/path/to/test.js:42)',
        COMMON_STACK_PATTERNS.contextAnonymous,
        { file: '/path/to/test.js', line: 42, column: undefined }
      );
    });
  });

  describe('UserContext.<anonymous> patterns (Jasmine)', () => {
    it('should parse UserContext.<anonymous>', () => {
      expectParsedLocation(
        '        at UserContext.<anonymous> (/private/tmp/jasmine-test.js:9:17)',
        COMMON_STACK_PATTERNS.contextAnonymous,
        { file: '/private/tmp/jasmine-test.js', line: 9, column: 17 }
      );
    });
  });

  describe('Ava file:// URL patterns', () => {
    it('should parse › file:// format', () => {
      expectParsedLocation(
        '  › file:///Users/jeff/project/tests/ava/test.js:28:5',
        COMMON_STACK_PATTERNS.avaFileUrl,
        { file: '/Users/jeff/project/tests/ava/test.js', line: 28, column: 5 }
      );
    });

    it('should parse at file:// format', () => {
      expectParsedLocation(
        '    at file:///tmp/test.js:118:21',
        COMMON_STACK_PATTERNS.avaFileUrl,
        { file: '/tmp/test.js', line: 118, column: 21 }
      );
    });
  });

  describe('Simple file:line format', () => {
    it('should parse file.js:line format', () => {
      expectParsedLocation(
        'tests/unit/helpers.test.js:128',
        COMMON_STACK_PATTERNS.simpleFileLine,
        { file: 'tests/unit/helpers.test.js', line: 128, column: undefined }
      );
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
      expectParsedLocation(
        '      at Object.someFunction (test.js:42:15)',
        COMMON_STACK_PATTERNS.generic,
        { file: 'test.js', line: 42, column: 15 }
      );
    });
  });

  it('should return empty object when no patterns match', () => {
    expectParsedLocation(
      'some random line with no location',
      COMMON_STACK_PATTERNS.contextAnonymous,
      {}
    );
  });

  it('should try patterns in order and return first match', () => {
    const patterns = [
      ...COMMON_STACK_PATTERNS.simpleFileLine, // Won't match
      ...COMMON_STACK_PATTERNS.contextAnonymous, // Will match
    ];

    expectParsedLocation(
      '  at Context.<anonymous> (test.js:10:5)',
      patterns,
      { file: 'test.js', line: 10, column: 5 }
    );
  });
});

describe('extractErrorType', () => {
  it('should extract TypeError', () => {
    expectErrorType("TypeError: Cannot read properties of null (reading 'value')", 'TypeError');
  });

  it('should extract AssertionError', () => {
    expectErrorType('AssertionError: Expected 4 to equal 5', 'AssertionError');
  });

  it('should extract AssertionError with code', () => {
    expectErrorType('AssertionError [ERR_ASSERTION]: Expected 1 to equal 2', 'AssertionError');
  });

  it('should extract plain Error', () => {
    expectErrorType('Error: ENOENT: no such file or directory', 'Error');
  });

  it('should extract ReferenceError', () => {
    expectErrorType('ReferenceError: foo is not defined', 'ReferenceError');
  });

  it('should extract custom error types', () => {
    expectErrorType('ValidationError: Invalid input format', 'ValidationError');
  });

  it('should return undefined for messages without error type', () => {
    expectErrorType('Expected 4 to equal 5');
  });

  it('should return undefined for non-error messages', () => {
    expectErrorType('Some random text');
  });

  it('should handle messages with colons but no error type', () => {
    expectErrorType('Warning: This is not an error');
  });
});
