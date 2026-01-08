/**
 * Shared parser utilities for test framework extractors
 *
 * Common patterns extracted from jasmine/mocha/ava/tap extractors to reduce duplication.
 * These utilities handle multi-line collection, stack trace parsing, and error type detection.
 *
 * @package @vibe-validate/extractors
 */

/**
 * Collect lines from an array until a condition is met
 *
 * @param lines - Array of lines to iterate through
 * @param startIndex - Index to start collecting from
 * @param shouldStop - Function that returns true when collection should stop
 * @returns Object containing collected lines and the next index to process
 *
 * @example
 * // Collect until blank line or specific marker
 * const { lines: messageLines, nextIndex } = collectLinesUntil(
 *   allLines,
 *   i + 1,
 *   (line) => line.trim() === '' || line.includes('Stack:')
 * );
 */
export function collectLinesUntil(
  lines: string[],
  startIndex: number,
  shouldStop: (_line: string, _index: number) => boolean
): { lines: string[]; nextIndex: number } {
  const collected: string[] = [];
  let j = startIndex;

  while (j < lines.length) {
    const currentLine = lines[j];
    if (shouldStop(currentLine, j)) {
      break;
    }
    collected.push(currentLine);
    j++;
  }

  return { lines: collected, nextIndex: j };
}

/**
 * Configuration for stack location pattern matching
 */
export interface StackLocationPattern {
  /** Regular expression to match the stack line */
  regex: RegExp;
  /** Capture group index for file path (1-based) */
  fileGroup: number;
  /** Capture group index for line number (1-based) */
  lineGroup: number;
  /** Optional capture group index for column number (1-based) */
  columnGroup?: number;
}

/**
 * Parsed location from stack trace
 */
export interface ParsedLocation {
  /** File path */
  file?: string;
  /** Line number */
  line?: number;
  /** Column number (if available) */
  column?: number;
}

/**
 * Parse a stack trace line to extract file location
 *
 * Handles multiple common stack trace formats:
 * - file:///path/to/file.js:line:col
 * - /absolute/path/file.js:line:col
 * - relative/path/file.js:line:col
 * - at Context.<anonymous> (path:line:col)
 * - at UserContext.<anonymous> (path:line:col)
 *
 * @param line - Stack trace line to parse
 * @param patterns - Array of patterns to try in order
 * @returns Parsed location or empty object if no match
 *
 * @example
 * const location = parseStackLocation(
 *   'at Context.<anonymous> (test.js:42:10)',
 *   [{
 *     regex: /at Context\.<anonymous> \(([^:)]+):(\d+)(?::(\d+))?\)/,
 *     fileGroup: 1,
 *     lineGroup: 2,
 *     columnGroup: 3
 *   }]
 * );
 */
export function parseStackLocation(
  line: string,
  patterns: StackLocationPattern[]
): ParsedLocation {
  for (const pattern of patterns) {
    const match = pattern.regex.exec(line);
    if (match) {
      const file = match[pattern.fileGroup];
      const lineStr = match[pattern.lineGroup];
      const line = lineStr ? Number.parseInt(lineStr, 10) : undefined;
      const columnStr = pattern.columnGroup ? match[pattern.columnGroup] : undefined;
      const column = columnStr ? Number.parseInt(columnStr, 10) : undefined;

      return { file, line, column };
    }
  }

  return {};
}

/**
 * Extract error type from error message
 *
 * Detects common error type prefixes like:
 * - "TypeError: message"
 * - "AssertionError [ERR_ASSERTION]: message"
 * - "Error: message"
 *
 * @param message - Error message to analyze
 * @returns Error type (e.g., "TypeError") or undefined if none detected
 *
 * @example
 * extractErrorType("TypeError: Cannot read properties of null")
 * // Returns: "TypeError"
 *
 * extractErrorType("AssertionError [ERR_ASSERTION]: Expected 1 to equal 2")
 * // Returns: "AssertionError"
 */
export function extractErrorType(message: string): string | undefined {
  // eslint-disable-next-line security/detect-unsafe-regex -- Safe: only parses controlled test framework error messages, not user input
  const errorMatch = /^([A-Za-z]*Error)(?:\s\[\w+\])?\s*:/.exec(message);
  return errorMatch ? errorMatch[1] : undefined;
}

/**
 * Common stack location patterns for popular test frameworks
 */
export const COMMON_STACK_PATTERNS = {
  /**
   * Mocha/Jasmine patterns for Context.<anonymous> and UserContext.<anonymous>
   */
  contextAnonymous: [
    {
      // eslint-disable-next-line security/detect-unsafe-regex -- Safe: only parses controlled test framework output, not user input
      regex: /at (?:User)?Context\.<anonymous> \((?:file:\/\/)?([^:)]+):(\d+)(?::(\d+))?\)/,
      fileGroup: 1,
      lineGroup: 2,
      columnGroup: 3,
    },
  ] as StackLocationPattern[],

  /**
   * Generic stack trace pattern for any function call
   */
  generic: [
    {
      // eslint-disable-next-line security/detect-unsafe-regex -- Safe: only parses controlled test framework output, not user input
      regex: /at .+ \((?:file:\/\/)?([^:)]+):(\d+)(?::(\d+))?\)/,
      fileGroup: 1,
      lineGroup: 2,
      columnGroup: 3,
    },
  ] as StackLocationPattern[],

  /**
   * Ava file:// URL format
   */
  avaFileUrl: [
    {
      // eslint-disable-next-line security/detect-unsafe-regex -- Safe: only parses controlled test framework output, not user input
      regex: /› file:\/\/([^:]+):(\d+)(?::(\d+))?/,
      fileGroup: 1,
      lineGroup: 2,
      columnGroup: 3,
    },
    {
      // eslint-disable-next-line security/detect-unsafe-regex -- Safe: only parses controlled test framework output, not user input
      regex: /at file:\/\/([^:]+):(\d+)(?::(\d+))?/,
      fileGroup: 1,
      lineGroup: 2,
      columnGroup: 3,
    },
  ] as StackLocationPattern[],

  /**
   * Simple file:line format (used by some frameworks)
   */
  simpleFileLine: [
    {
      regex: /^([^:]+\.(?:js|ts|mjs|cjs)):(\d+)$/,
      fileGroup: 1,
      lineGroup: 2,
    },
  ] as StackLocationPattern[],
};
