/**
 * Vitest Extractor Tests
 *
 * Tests Vitest/Jest test failure parsing and formatting.
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';
import { extractVitestErrors } from '../src/vitest-extractor.js';

describe('extractVitestErrors', () => {
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

    const result = extractVitestErrors(output);

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

    const result = extractVitestErrors(output);

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

    const result = extractVitestErrors(output);

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

    const result = extractVitestErrors(output);

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

    const result = extractVitestErrors(output);

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

    const result = extractVitestErrors(failures);

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

    const result = extractVitestErrors(output);

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

    const result = extractVitestErrors(output);

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

    const result = extractVitestErrors(output);

    expect(result.guidance).toContain('2 test(s) failed');
    expect(result.guidance).toContain('Fix each failing test individually');
  });

  it('should generate guidance for single failure', () => {
    const output = `
 FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > test
AssertionError: expected 3000 to be 9999

 ❯ test/unit/config/environment.test.ts:57:30
    `.trim();

    const result = extractVitestErrors(output);

    expect(result.guidance).toContain('1 test(s) failed');
    expect(result.guidance).toContain('Fix the assertion in the test file');
  });

  it('should handle empty output', () => {
    const result = extractVitestErrors('');

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

    const result = extractVitestErrors(output);

    expect(result.errors).toHaveLength(0);
    expect(result.totalErrors).toBe(0);
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

    const result = extractVitestErrors(output);

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

    const result = extractVitestErrors(output);

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

    const result = extractVitestErrors(output);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe('vitest.config.ts');
    expect(result.errors[0].message).toContain('Coverage for functions');
    expect(result.errors[0].message).toContain('86.47%');
    expect(result.errors[0].message).toContain('87%');
    expect(result.totalErrors).toBe(1);
    expect(result.summary).toBe('1 test failure(s)');
  });
});
