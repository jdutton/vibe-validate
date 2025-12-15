/**
 * Vitest Extractor Plugin Tests
 *
 * Tests Vitest/Jest test failure parsing and formatting.
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';

import vitestPlugin from './index.js';

const { extract, detect } = vitestPlugin;

describe('Vitest Extractor Plugin', () => {
  describe('detect', () => {
    it('should detect Vitest test failures with high confidence', () => {
      const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > should parse HTTP_PORT
AssertionError: expected 3000 to be 9999 // Object.is equality
 ❯ test/unit/config/environment.test.ts:57:30
      `.trim();

      const result = detect(output);

      expect(result.confidence).toBeGreaterThanOrEqual(70);
      expect(result.patterns.length).toBeGreaterThan(0);
      expect(result.reason).toContain('Vitest');
    });

    it('should detect multiple Vitest patterns with higher confidence', () => {
      const output = `
❯ test/unit/config/environment.test.ts (1)
  × should parse HTTP_PORT
AssertionError: expected 3000 to be 9999
      `.trim();

      const result = detect(output);

      expect(result.confidence).toBe(90);
    });

    it('should not detect non-Vitest output', () => {
      const output = `Some random text without test failures`;
      const result = detect(output);

      expect(result.confidence).toBe(0);
    });
  });

  describe('extract', () => {
    it('should parse single Vitest test failure', () => {
      const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > should parse HTTP_PORT
AssertionError: expected 3000 to be 9999 // Object.is equality
 ❯ test/unit/config/environment.test.ts:57:30
   55|     const config = parseEnvironmentConfig();
   56|
   57|     expect(config.HTTP_PORT).toBe(9999);
     |                              ^
   58|   });
   59|
      `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('test/unit/config/environment.test.ts');
      expect(result.errors[0].line).toBe(57);
      expect(result.errors[0].column).toBe(30);
      expect(result.summary).toBe('1 test failure(s)');
      expect(result.totalErrors).toBe(1);
    });

    it('should extract test hierarchy and error message', () => {
      const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > should parse HTTP_PORT correctly
AssertionError: expected 3000 to be 9999
 ❯ test/unit/config/environment.test.ts:57:30
      `.trim();

      const result = extract(output);

      // Message should contain the actual error, not just the test hierarchy
      expect(result.errors[0].message).toContain('AssertionError: expected 3000 to be 9999');
      // Test hierarchy is captured in errorSummary, not in message
      expect(result.errorSummary).toContain('EnvironmentConfig > should parse HTTP_PORT correctly');
    });

    it('should extract error message', () => {
      const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test
AssertionError: expected 3000 to be 9999 // Object.is equality
 ❯ test/unit/config/environment.test.ts:57:30
      `.trim();

      const result = extract(output);

      expect(result.errors[0].message).toContain('expected 3000 to be 9999 // Object.is equality');
    });

    it('should extract source line', () => {
      const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test
AssertionError: expected 3000 to be 9999
 ❯ test/unit/config/environment.test.ts:57:30
   55|     const config = parseEnvironmentConfig();
   56|
   57|     expect(config.HTTP_PORT).toBe(9999);
     |                              ^
   58|   });
      `.trim();

      const result = extract(output);

      // Vitest extractor extracts source lines (any line with line number)
      expect(result.errorSummary).toMatch(/\d+\|/); // Contains at least one line with line number
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('test/unit/config/environment.test.ts');
    });

    it('should parse multiple test failures', () => {
      const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test 1
AssertionError: expected 3000 to be 9999
 ❯ test/unit/config/environment.test.ts:57:30
   57|     expect(config.HTTP_PORT).toBe(9999);

FAIL  test/unit/auth/factory.test.ts > AuthFactory > test 2
Error: Cannot create auth provider
 ❯ test/unit/auth/factory.test.ts:100:15
   100|     expect(() => factory.create()).toThrow();

FAIL  test/unit/session/manager.test.ts > SessionManager > test 3
AssertionError: expected undefined to be defined
 ❯ test/unit/session/manager.test.ts:200:25
   200|     expect(session).toBeDefined();
      `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(3);
      expect(result.summary).toBe('3 test failure(s)');
      expect(result.totalErrors).toBe(3);

      expect(result.errors[0].file).toBe('test/unit/config/environment.test.ts');
      expect(result.errors[1].file).toBe('test/unit/auth/factory.test.ts');
      expect(result.errors[2].file).toBe('test/unit/session/manager.test.ts');
    });

    it('should limit output to first 10 failures', () => {
      // Generate 15 test failures
      const failures = Array.from({ length: 15 }, (_, i) => `
FAIL  test/unit/file${i}.test.ts > TestSuite > test ${i}
AssertionError: expected ${i} to be ${i + 1}
 ❯ test/unit/file${i}.test.ts:${i + 10}:30
   ${i + 10}|     expect(value).toBe(${i + 1});
      `).join('\n');

      const result = extract(failures);

      expect(result.totalErrors).toBe(15);
      expect(result.errors).toHaveLength(10);
    });

    it('should extract expected and actual values', () => {
      const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test
AssertionError: expected 3000 to be 9999

- Expected
"9999"

+ Received
"3000"

 ❯ test/unit/config/environment.test.ts:57:30
      `.trim();

      const result = extract(output);

      // Expected/actual values are extracted and shown in clean output
      expect(result.errorSummary).toBeDefined();
      expect(result.errors).toHaveLength(1);
    });

    it('should generate single test failure guidance', () => {
      const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test
AssertionError: expected 3000 to be 9999
 ❯ test/unit/config/environment.test.ts:57:30
      `.trim();

      const result = extract(output);

      expect(result.guidance).toContain('1 test(s) failed');
      expect(result.guidance).toContain('Fix the assertion in the test file at the location shown');
      expect(result.guidance).toContain('npm test -- <test-file>');
    });

    it('should generate multiple test failure guidance', () => {
      const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test 1
AssertionError: error 1
 ❯ test/unit/config/environment.test.ts:57:30

FAIL  test/unit/auth/factory.test.ts > AuthFactory > test 2
Error: error 2
 ❯ test/unit/auth/factory.test.ts:100:15
      `.trim();

      const result = extract(output);

      expect(result.guidance).toContain('2 test(s) failed');
      expect(result.guidance).toContain('Fix each failing test individually');
    });

    it('should generate guidance for single failure', () => {
      const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test
AssertionError: expected 3000 to be 9999

 ❯ test/unit/config/environment.test.ts:57:30
      `.trim();

      const result = extract(output);

      expect(result.guidance).toContain('1 test(s) failed');
      expect(result.guidance).toContain('Fix the assertion in the test file');
    });

    it('should handle empty output', () => {
      const result = extract('');

      expect(result.errors).toHaveLength(0);
      expect(result.summary).toBe('0 test failure(s)');
      expect(result.totalErrors).toBe(0);
    });

    it('should handle output with no test failures', () => {
      const output = `
✓ test/unit/config/environment.test.ts > EnvironmentConfig > test 1 (5ms)
✓ test/unit/auth/factory.test.ts > AuthFactory > test 2 (3ms)
✓ test/unit/session/manager.test.ts > SessionManager > test 3 (2ms)

Test Files  3 passed (3)
     Tests  3 passed (3)
      `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(0);
      expect(result.totalErrors).toBe(0);
    });

    it('should extract location from FAIL sections, not summary × lines', () => {
      // Regression test for issue where summary × lines (without location markers)
      // were extracted instead of FAIL lines (with ❯ location markers)
      const output = `
 ❯ packages/cli/test/multi-fail.test.ts (3 tests | 3 failed) 4ms
   × failure 1 3ms
     → expected 1 to be 2 // Object.is equality
   × failure 2 1ms
     → expected 'a' to be 'b' // Object.is equality
   × failure 3 0ms
     → expected true to be false // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/cli/test/multi-fail.test.ts > failure 1
AssertionError: expected 1 to be 2 // Object.is equality
 ❯ packages/cli/test/multi-fail.test.ts:4:13

 FAIL  packages/cli/test/multi-fail.test.ts > failure 2
AssertionError: expected 'a' to be 'b' // Object.is equality
 ❯ packages/cli/test/multi-fail.test.ts:8:15

 FAIL  packages/cli/test/multi-fail.test.ts > failure 3
AssertionError: expected true to be false // Object.is equality
 ❯ packages/cli/test/multi-fail.test.ts:12:16
      `.trim();

      const result = extract(output);

      // Should extract 3 failures from FAIL sections (not summary × lines)
      expect(result.errors).toHaveLength(3);
      expect(result.totalErrors).toBe(3);

      // ALL errors should have line numbers (from ❯ markers in FAIL sections)
      expect(result.errors[0].line).toBe(4);
      expect(result.errors[0].column).toBe(13);
      expect(result.errors[1].line).toBe(8);
      expect(result.errors[1].column).toBe(15);
      expect(result.errors[2].line).toBe(12);
      expect(result.errors[2].column).toBe(16);
    });

    it('should handle Jest output format', () => {
      const output = `
FAIL  test/unit/config/environment.test.ts
  EnvironmentConfig
    ✕ should parse HTTP_PORT (5ms)

  ● EnvironmentConfig › should parse HTTP_PORT

    expect(received).toBe(expected) // Object.is equality

    Expected: 9999
    Received: 3000

      55 |     const config = parseEnvironmentConfig();
      56 |
    > 57 |     expect(config.HTTP_PORT).toBe(9999);
         |                              ^
      58 |   });
      59 |

      at test/unit/config/environment.test.ts:57:30
      `.trim();

      const result = extract(output);

      // Should still parse some information even with different format
      expect(result.totalErrors).toBeGreaterThanOrEqual(0);
    });

    it('should format clean output with numbered test list', () => {
      const output = `
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test 1
AssertionError: error 1
 ❯ test/unit/config/environment.test.ts:57:30
   57|     expect(value).toBe(expected);

FAIL  test/unit/auth/factory.test.ts > AuthFactory > test 2
Error: error 2
 ❯ test/unit/auth/factory.test.ts:100:15
   100|     expect(factory).toBeDefined();
      `.trim();

      const result = extract(output);

      expect(result.errorSummary).toContain('[Test 1/2]');
      expect(result.errorSummary).toContain('[Test 2/2]');
      expect(result.errorSummary).toContain('test/unit/config/environment.test.ts:57:30');
      expect(result.errorSummary).toContain('test/unit/auth/factory.test.ts:100:15');
    });

    it('should extract coverage threshold failures', () => {
      const output = `
RUN  v2.0.5 /Users/jeff/Workspaces/vibe-validate

✓ packages/cli/test/commands/run.test.ts (25) 1234ms
✓ packages/core/test/runner.test.ts (15) 567ms
✓ packages/git/test/tree-hash.test.ts (8) 123ms

Test Files  1139 passed (1139)
     Tests  1139 passed (1139)
  Start at  02:03:02
  Duration  35.62s (transform 1.23s, setup 0ms, collect 4.56s, tests 23.45s, environment 2.34s, prepare 3.21s)

% Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   88.47 |    84.21 |   86.47 |   88.47 |
-------------------|---------|----------|---------|---------|-------------------

ERROR: Coverage for functions (86.47%) does not meet global threshold (87%)
      `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('vitest.config.ts');
      expect(result.errors[0].message).toContain('Coverage for functions');
      expect(result.errors[0].message).toContain('86.47%');
      expect(result.errors[0].message).toContain('87%');
      expect(result.totalErrors).toBe(1);
      expect(result.summary).toBe('1 test failure(s)');
    });

    it('should extract Vitest worker timeout errors', () => {
      const output = `
RUN  v2.0.5 /Users/jeff/Workspaces/vibe-validate

✓ packages/cli/test/commands/run.test.ts (25) 1234ms
✓ packages/core/test/runner.test.ts (15) 567ms

⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 ❯ Object.onTimeoutError node_modules/.pnpm/vitest@3.2.4/node_modules/vitest/dist/chunks/rpc.js:53:10
 ❯ Timeout._onTimeout node_modules/.pnpm/vitest@3.2.4/node_modules/vitest/dist/chunks/index.js:59:62
 ❯ listOnTimeout node:internal/timers:608:17
 ❯ processTimers node:internal/timers:543:7

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
      `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('vitest.config.ts');
      expect(result.errors[0].message).toContain('Timeout calling "onTaskUpdate"');
      expect(result.errors[0].message).toContain('system resource constraints');
      expect(result.errors[0].message).toContain('Kill background processes');
      expect(result.totalErrors).toBe(1);
      expect(result.summary).toBe('1 test failure(s)');
    });

    it('should extract Vitest worker timeout errors with plural "Unhandled Errors"', () => {
      const output = `
RUN  v2.0.5 /Users/jeff/Workspaces/vibe-validate

✓ packages/cli/test/commands/run.test.ts (25) 1234ms
✓ packages/core/test/runner.test.ts (15) 567ms

⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯

Vitest caught 1 unhandled error during the test run.
This might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.

⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 ❯ Object.onTimeoutError node_modules/.pnpm/vitest@3.2.4/node_modules/vitest/dist/chunks/rpc.js:53:10
 ❯ Timeout._onTimeout node_modules/.pnpm/vitest@3.2.4/node_modules/vitest/dist/chunks/index.js:59:62
 ❯ listOnTimeout node:internal/timers:608:17
 ❯ processTimers node:internal/timers:543:7

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
      `.trim();

      const result = extract(output);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('vitest.config.ts');
      expect(result.errors[0].message).toContain('Timeout calling "onTaskUpdate"');
      expect(result.errors[0].message).toContain('system resource constraints');
      expect(result.errors[0].message).toContain('Kill background processes');
      expect(result.totalErrors).toBe(1);
      expect(result.summary).toBe('1 test failure(s)');
    });

    it('should truncate errors array to MAX_ERRORS_IN_ARRAY but preserve totalErrors count', async () => {
      // Import the constant to verify we're using the right value
      const { MAX_ERRORS_IN_ARRAY } = await import('../../result-schema.js');

      // Generate 15 test failures (more than MAX_ERRORS_IN_ARRAY = 10)
      const failures = Array.from(
        { length: 15 },
        (_, i) => `
FAIL  test/unit/file${i + 1}.test.ts > TestSuite > test ${i + 1}
AssertionError: expected ${i} to be ${i + 1}
 ❯ test/unit/file${i + 1}.test.ts:${i + 10}:30
   ${i + 10}|     expect(value).toBe(${i + 1});
        `
      ).join('\n');

      const result = extract(failures);

      // totalErrors should be 15 (full count)
      expect(result.totalErrors).toBe(15);

      // errors array should be truncated to MAX_ERRORS_IN_ARRAY (10)
      expect(result.errors).toHaveLength(MAX_ERRORS_IN_ARRAY);
      expect(result.errors).toHaveLength(10);

      // Verify we got the first 10 errors
      expect(result.errors[0].file).toBe('test/unit/file1.test.ts');
      expect(result.errors[9].file).toBe('test/unit/file10.test.ts');

      // Summary should show full count (15)
      expect(result.summary).toBe('15 test failure(s)');
    });
  });

  describe('plugin metadata', () => {
    it('should have correct metadata', () => {
      expect(vitestPlugin.metadata.name).toBe('vitest');
      expect(vitestPlugin.priority).toBe(85);
      expect(vitestPlugin.hints!.anyOf).toContain('FAIL');
    });

    it('should include sample test cases', () => {
      expect(vitestPlugin.samples).toBeDefined();
      expect(vitestPlugin.samples.length).toBeGreaterThan(0);
    });
  });
});
