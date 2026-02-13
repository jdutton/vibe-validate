/**
 * Tests for ExtractionModeDetector
 *
 * Tests cover:
 * - Matrix mode detection & extraction
 * - Non-matrix mode detection & extraction
 * - Extractor detection (from check name, logs, VIBE_VALIDATE_COMMAND marker)
 * - Integration with real YAML output
 * - Integration with real vitest output
 * - Graceful failure handling
 *
 * @packageDocumentation
 */

import { autoDetectAndExtract } from '@vibe-validate/extractors';
import type { ErrorExtractorResult } from '@vibe-validate/extractors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExtractionModeDetector } from '../../src/services/extraction-mode-detector.js';
import { createTestCheck } from '../helpers/watch-pr-fixtures.js';

// Mock autoDetectAndExtract
vi.mock('@vibe-validate/extractors', () => ({
  autoDetectAndExtract: vi.fn(),
}));

/**
 * Assert extraction result matches expected summary, error count, and error array length
 */
function expectExtraction(
  result: ErrorExtractorResult | null,
  expected: { summary: string; totalErrors: number; errorCount: number },
): void {
  expect(result).toBeDefined();
  expect(result?.summary).toBe(expected.summary);
  expect(result?.totalErrors).toBe(expected.totalErrors);
  expect(result?.errors).toHaveLength(expected.errorCount);
}

/**
 * Mock autoDetectAndExtract to return a simple fallback result and assert it was used
 */
function setupNonMatrixFallback(summary = 'Fallback result', totalErrors = 1): void {
  vi.mocked(autoDetectAndExtract).mockReturnValue({
    summary,
    totalErrors,
    errors: [{ message: 'Error' }],
  });
}

/**
 * Assert that non-matrix fallback was used (autoDetectAndExtract was called)
 */
function expectNonMatrixFallbackUsed(result: ErrorExtractorResult | null): void {
  expect(result).toBeDefined();
  expect(autoDetectAndExtract).toHaveBeenCalled();
}

describe('ExtractionModeDetector', () => {
  let detector: ExtractionModeDetector;

  beforeEach(() => {
    detector = new ExtractionModeDetector();
    vi.clearAllMocks();
  });

  describe('matrix mode detection', () => {
    it('should detect matrix mode with validate YAML output', async () => {
      const check = createTestCheck();

      const logs = `
2025-12-16T10:01:00.000Z ##[group]Run validation
2025-12-16T10:01:01.000Z ---
2025-12-16T10:01:01.000Z command: npm test
2025-12-16T10:01:01.000Z exitCode: 1
2025-12-16T10:01:01.000Z durationSecs: 2.5
2025-12-16T10:01:01.000Z timestamp: 2025-12-16T10:01:01.000Z
2025-12-16T10:01:01.000Z treeHash: abc123
2025-12-16T10:01:01.000Z extraction:
2025-12-16T10:01:01.000Z   summary: 2 test failure(s)
2025-12-16T10:01:01.000Z   totalErrors: 2
2025-12-16T10:01:01.000Z   errors:
2025-12-16T10:01:01.000Z     - file: test/example.test.ts
2025-12-16T10:01:01.000Z       line: 10
2025-12-16T10:01:01.000Z       message: Expected 5 to equal 6
2025-12-16T10:01:01.000Z     - file: test/other.test.ts
2025-12-16T10:01:01.000Z       line: 20
2025-12-16T10:01:01.000Z       message: Timeout exceeded
2025-12-16T10:01:01.000Z   guidance: Fix the failing tests
2025-12-16T10:01:01.000Z ---
2025-12-16T10:01:02.000Z ##[endgroup]
`;

      const result = await detector.detectAndExtract(check, logs);

      expectExtraction(result, { summary: '2 test failure(s)', totalErrors: 2, errorCount: 2 });
      expect(result?.guidance).toBe('Fix the failing tests');
    });

    it('should handle matrix mode with nested YAML', async () => {
      const check = createTestCheck({ name: 'CI / Lint', run_id: 12346, duration: '1m15s' });

      const logs = `
---
command: pnpm lint
exitCode: 1
extraction:
  summary: 3 ESLint error(s)
  totalErrors: 3
  errors:
    - file: src/example.ts
      line: 5
      column: 10
      message: 'Unexpected console statement'
      code: no-console
    - file: src/other.ts
      line: 15
      message: 'Missing return type'
  guidance: Fix ESLint errors
---
`;

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(result?.summary).toBe('3 ESLint error(s)');
      expect(result?.errors).toHaveLength(2);
    });

    it('should return null if no YAML markers found', async () => {
      const check = createTestCheck({ run_id: 12347 });

      const logs = `
Running tests...
Test 1: PASS
Test 2: FAIL
Done.
`;

      vi.mocked(autoDetectAndExtract).mockReturnValue({
        summary: '1 test failure(s)',
        totalErrors: 1,
        errors: [{ message: 'Test 2 failed' }],
      });

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(autoDetectAndExtract).toHaveBeenCalled();
    });

    it('should handle malformed YAML gracefully', async () => {
      const check = createTestCheck({ run_id: 12348 });

      const logs = `
---
extraction:
  summary: malformed { yaml
  errors: [not closed
---
`;

      setupNonMatrixFallback('1 error');

      const result = await detector.detectAndExtract(check, logs);

      // Should fall back to non-matrix mode
      expectNonMatrixFallbackUsed(result);
    });
  });

  describe('GitHub Actions log format parsing', () => {
    it('should extract YAML from GitHub Actions logs with job/step prefix', async () => {
      const check = createTestCheck({
        name: 'Validation Pipeline',
        run_id: 20275187200,
        workflow: 'Validation Pipeline',
        started_at: '2025-12-16T16:27:37Z',
        duration: '5m43s',
      });

      // Real GitHub Actions log format with job name, step name, and timestamp prefix
      const logs = `Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1212265Z ---
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1212528Z command: pnpm test
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1212767Z exitCode: 1
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1212971Z extraction:
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1213343Z   errors:
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1213731Z     - file: packages/cli/test/commands/doctor-config-errors.test.ts
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1213994Z       line: 67
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1214393Z       message: "AssertionError: expected '' to contain 'Configuration valid'"
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1214931Z     - file: packages/cli/test/commands/doctor-config-errors.test.ts
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1215763Z       line: 47
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1216693Z       message: "Error: EBUSY: resource busy or locked"
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1222159Z   summary: 2 test failure(s)
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1222450Z   totalErrors: 2
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1222877Z   guidance: Fix the failing tests
Run vibe-validate validation (windows-latest, 22)\tRun validation\t2025-12-16T16:33:10.1223303Z ---`;

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(result?.summary).toBe('2 test failure(s)');
      expect(result?.totalErrors).toBe(2);
      expect(result?.errors).toHaveLength(2);
      expect(result?.errors[0].file).toBe('packages/cli/test/commands/doctor-config-errors.test.ts');
      expect(result?.errors[0].line).toBe(67);
      expect(result?.guidance).toBe('Fix the failing tests');
    });

    it('should extract YAML from GitHub Actions logs with UTF-8 BOM', async () => {
      const check = createTestCheck({ run_id: 12361 });

      // Log with UTF-8 BOM (U+FEFF) after second tab
      const logs = `Run CI Test\tSetup\t\uFEFF2025-12-16T10:01:00.000Z ---
Run CI Test\tSetup\t\uFEFF2025-12-16T10:01:01.000Z command: npm test
Run CI Test\tSetup\t\uFEFF2025-12-16T10:01:01.000Z exitCode: 1
Run CI Test\tSetup\t\uFEFF2025-12-16T10:01:01.000Z extraction:
Run CI Test\tSetup\t\uFEFF2025-12-16T10:01:01.000Z   summary: 1 test failure(s)
Run CI Test\tSetup\t\uFEFF2025-12-16T10:01:01.000Z   totalErrors: 1
Run CI Test\tSetup\t\uFEFF2025-12-16T10:01:01.000Z   errors:
Run CI Test\tSetup\t\uFEFF2025-12-16T10:01:01.000Z     - message: Test failed
Run CI Test\tSetup\t\uFEFF2025-12-16T10:01:01.000Z   guidance: Fix test
Run CI Test\tSetup\t\uFEFF2025-12-16T10:01:01.000Z ---`;

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(result?.summary).toBe('1 test failure(s)');
      expect(result?.totalErrors).toBe(1);
    });

    it('should handle GitHub Actions logs with varying timestamp precision', async () => {
      const check = createTestCheck({ name: 'Test', run_id: 12362, duration: '1m00s' });

      // Some logs have millisecond precision, others have microseconds
      const logs = `Job Name\tStep Name\t2025-12-16T10:01:00.123Z ---
Job Name\tStep Name\t2025-12-16T10:01:00.123456Z extraction:
Job Name\tStep Name\t2025-12-16T10:01:00.1234567Z   summary: Error occurred
Job Name\tStep Name\t2025-12-16T10:01:00.12345678Z   totalErrors: 1
Job Name\tStep Name\t2025-12-16T10:01:00.123456789Z   errors:
Job Name\tStep Name\t2025-12-16T10:01:00.1Z     - message: Failed
Job Name\tStep Name\t2025-12-16T10:01:00.12Z   guidance: Fix it
Job Name\tStep Name\t2025-12-16T10:01:00.123Z ---`;

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(result?.totalErrors).toBe(1);
    });

    it('should handle mixed format logs (GitHub Actions + plain timestamps)', async () => {
      const check = createTestCheck({ name: 'Test', run_id: 12363, duration: '1m30s' });

      // Some lines have GitHub Actions prefix, others just timestamps
      const logs = `Job\tStep\t2025-12-16T10:01:00.000Z ---
2025-12-16T10:01:01.000Z extraction:
Job\tStep\t2025-12-16T10:01:01.000Z   summary: Mixed format
2025-12-16T10:01:01.000Z   totalErrors: 1
Job\tStep\t2025-12-16T10:01:01.000Z   errors:
2025-12-16T10:01:01.000Z     - message: Error
Job\tStep\t2025-12-16T10:01:01.000Z   guidance: Fix
2025-12-16T10:01:01.000Z ---`;

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(result?.summary).toBe('Mixed format');
    });

    it('should extract from nested validate output (phases/steps)', async () => {
      const check = createTestCheck({
        name: 'Validation Pipeline',
        run_id: 12365,
        workflow: 'Validation Pipeline',
        duration: '5m00s',
      });

      // Validate output has extraction nested in phases/steps
      const logs = `Job\tStep\t2025-12-16T10:01:00.000Z ---
Job\tStep\t2025-12-16T10:01:00.000Z passed: false
Job\tStep\t2025-12-16T10:01:00.000Z summary: Unit Tests with Coverage failed
Job\tStep\t2025-12-16T10:01:00.000Z phases:
Job\tStep\t2025-12-16T10:01:00.000Z   - name: Testing
Job\tStep\t2025-12-16T10:01:00.000Z     passed: false
Job\tStep\t2025-12-16T10:01:00.000Z     steps:
Job\tStep\t2025-12-16T10:01:00.000Z       - name: Unit Tests with Coverage
Job\tStep\t2025-12-16T10:01:00.000Z         passed: false
Job\tStep\t2025-12-16T10:01:00.000Z         extraction:
Job\tStep\t2025-12-16T10:01:00.000Z           summary: 4 test failure(s)
Job\tStep\t2025-12-16T10:01:00.000Z           totalErrors: 4
Job\tStep\t2025-12-16T10:01:00.000Z           errors:
Job\tStep\t2025-12-16T10:01:00.000Z             - file: test/example.test.ts
Job\tStep\t2025-12-16T10:01:00.000Z               line: 10
Job\tStep\t2025-12-16T10:01:00.000Z               message: Test failed
Job\tStep\t2025-12-16T10:01:00.000Z           guidance: Fix the tests
Job\tStep\t2025-12-16T10:01:00.000Z ---`;

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(result?.summary).toBe('4 test failure(s)');
      expect(result?.totalErrors).toBe(4);
      expect(result?.errors).toHaveLength(1); // Only one error in this fixture
      expect(result?.errors[0].file).toBe('test/example.test.ts');
      expect(result?.guidance).toBe('Fix the tests');
    });

    it('should extract from second YAML block when first block fails to parse', async () => {
      const check = createTestCheck({
        name: 'Run vibe-validate validation (windows-latest, 24)',
        run_id: 22003731703,
        workflow: 'Validation Pipeline',
        duration: '6m21s',
      });

      // Real scenario: skills validation emits a YAML block with @ in package name
      // (causes YAML parse error), followed by the validate state YAML with real errors
      const logs = `Job\tStep\t2025-12-16T10:01:00.000Z ---
Job\tStep\t2025-12-16T10:01:00.000Z status: success
Job\tStep\t2025-12-16T10:01:00.000Z package: @vibe-agent-toolkit/vat-development-agents
Job\tStep\t2025-12-16T10:01:00.000Z skillsBuilt: 1
Job\tStep\t2025-12-16T10:01:00.000Z ---
Job\tStep\t2025-12-16T10:01:01.000Z some other output
Job\tStep\t2025-12-16T10:01:02.000Z ---
Job\tStep\t2025-12-16T10:01:02.000Z passed: false
Job\tStep\t2025-12-16T10:01:02.000Z summary: Unit tests with coverage failed
Job\tStep\t2025-12-16T10:01:02.000Z failedStep: Unit tests with coverage
Job\tStep\t2025-12-16T10:01:02.000Z phases:
Job\tStep\t2025-12-16T10:01:02.000Z   - name: Testing
Job\tStep\t2025-12-16T10:01:02.000Z     passed: false
Job\tStep\t2025-12-16T10:01:02.000Z     steps:
Job\tStep\t2025-12-16T10:01:02.000Z       - name: Unit tests with coverage
Job\tStep\t2025-12-16T10:01:02.000Z         passed: false
Job\tStep\t2025-12-16T10:01:02.000Z         exitCode: 1
Job\tStep\t2025-12-16T10:01:02.000Z         extraction:
Job\tStep\t2025-12-16T10:01:02.000Z           errors:
Job\tStep\t2025-12-16T10:01:02.000Z             - file: packages/test/walk.test.ts
Job\tStep\t2025-12-16T10:01:02.000Z               line: 200
Job\tStep\t2025-12-16T10:01:02.000Z               message: "AssertionError: expected 'D:\\\\project\\\\docs' to be '/project/docs'"
Job\tStep\t2025-12-16T10:01:02.000Z           summary: 1 test failure(s)
Job\tStep\t2025-12-16T10:01:02.000Z           totalErrors: 1
Job\tStep\t2025-12-16T10:01:02.000Z           guidance: Fix the failing tests
Job\tStep\t2025-12-16T10:01:02.000Z ---`;

      // Non-matrix fallback should NOT be used when YAML has real extraction data
      vi.mocked(autoDetectAndExtract).mockReturnValue({
        summary: 'WRONG: non-matrix fallback used',
        totalErrors: 0,
        errors: [],
      });

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(result?.summary).toBe('1 test failure(s)');
      expect(result?.totalErrors).toBe(1);
      expect(result?.errors).toHaveLength(1);
      expect(result?.errors[0].file).toBe('packages/test/walk.test.ts');
      expect(result?.guidance).toBe('Fix the failing tests');
      // Verify we used YAML extraction, not the non-matrix fallback
      expect(autoDetectAndExtract).not.toHaveBeenCalled();
    });

    it('should preserve indentation when stripping prefixes', async () => {
      const check = createTestCheck({ name: 'Test', run_id: 12364, duration: '1m00s' });

      // YAML requires correct indentation
      const logs = `Job\tStep\t2025-12-16T10:01:00.000Z ---
Job\tStep\t2025-12-16T10:01:00.000Z extraction:
Job\tStep\t2025-12-16T10:01:00.000Z   errors:
Job\tStep\t2025-12-16T10:01:00.000Z     - file: test.ts
Job\tStep\t2025-12-16T10:01:00.000Z       line: 10
Job\tStep\t2025-12-16T10:01:00.000Z       nested:
Job\tStep\t2025-12-16T10:01:00.000Z         deeply: value
Job\tStep\t2025-12-16T10:01:00.000Z   summary: Test
Job\tStep\t2025-12-16T10:01:00.000Z   totalErrors: 1
Job\tStep\t2025-12-16T10:01:00.000Z ---`;

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(result?.errors[0].file).toBe('test.ts');
      expect(result?.errors[0].line).toBe(10);
    });
  });

  describe('non-matrix mode detection', () => {
    it('should detect vitest from check name', async () => {
      const check = createTestCheck({ name: 'Test (vitest)', run_id: 12349 });

      const logs = `
RUN  v1.0.0
× test/example.test.ts > should work
  Expected 5 to equal 6
`;

      vi.mocked(autoDetectAndExtract).mockReturnValue({
        summary: '1 test failure(s)',
        totalErrors: 1,
        errors: [{ file: 'test/example.test.ts', message: 'Expected 5 to equal 6' }],
      });

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(autoDetectAndExtract).toHaveBeenCalledWith(logs);
    });

    it('should detect jest from check name', async () => {
      const check = createTestCheck({ name: 'Test (jest)', run_id: 12350 });

      const logs = `
 FAIL  test/example.test.ts
  ● should work
    expect(received).toBe(expected)
`;

      vi.mocked(autoDetectAndExtract).mockReturnValue({
        summary: '1 test failure(s)',
        totalErrors: 1,
        errors: [{ file: 'test/example.test.ts', message: 'expect(received).toBe(expected)' }],
      });

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(autoDetectAndExtract).toHaveBeenCalled();
    });

    it('should detect eslint from check name', async () => {
      const check = createTestCheck({ name: 'Lint (ESLint)', run_id: 12351, duration: '1m15s' });

      const logs = `
src/example.ts
  5:10  error  Unexpected console statement  no-console
`;

      vi.mocked(autoDetectAndExtract).mockReturnValue({
        summary: '1 ESLint error(s)',
        totalErrors: 1,
        errors: [{ file: 'src/example.ts', line: 5, column: 10, message: 'Unexpected console statement' }],
      });

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(autoDetectAndExtract).toHaveBeenCalled();
    });

    it('should detect typescript from check name', async () => {
      const check = createTestCheck({ name: 'TypeCheck', run_id: 12352, duration: '30s' });

      const logs = `
src/example.ts:5:10 - error TS2322: Type 'number' is not assignable to type 'string'.
`;

      vi.mocked(autoDetectAndExtract).mockReturnValue({
        summary: '1 type error(s)',
        totalErrors: 1,
        errors: [{ file: 'src/example.ts', line: 5, column: 10, message: "Type 'number' is not assignable to type 'string'" }],
      });

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(autoDetectAndExtract).toHaveBeenCalled();
    });

    it('should detect extractor from VIBE_VALIDATE_COMMAND marker in logs', async () => {
      const check = createTestCheck({ run_id: 12353 });

      const logs = `
VIBE_VALIDATE_COMMAND=vitest run
RUN  v1.0.0
× test/example.test.ts > should work
`;

      vi.mocked(autoDetectAndExtract).mockReturnValue({
        summary: '1 test failure(s)',
        totalErrors: 1,
        errors: [{ message: 'Test failed' }],
      });

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(autoDetectAndExtract).toHaveBeenCalled();
    });

    it('should use generic extractor if no specific extractor detected', async () => {
      const check = createTestCheck({ name: 'Unknown Check', run_id: 12354, duration: '1m00s' });

      const logs = `
Error: Something went wrong
Failed to execute command
`;

      vi.mocked(autoDetectAndExtract).mockReturnValue({
        summary: 'Command failed',
        totalErrors: 1,
        errors: [{ message: 'Something went wrong' }],
      });

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(autoDetectAndExtract).toHaveBeenCalled();
    });
  });

  describe('integration tests with real output', () => {
    it('should extract from real vitest output', async () => {
      const check = createTestCheck({ name: 'Test', run_id: 12355 });

      const logs = `
 RUN  v1.0.0 /path/to/project

 ✓ test/passing.test.ts (1 test)
 × test/failing.test.ts (1 test | 1 failed)
   × should work
     AssertionError: expected 5 to equal 6

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 1 passed (2)
   Start at  10:00:00
   Duration  2.30s
`;

      vi.mocked(autoDetectAndExtract).mockReturnValue({
        summary: '1 test failure(s)',
        totalErrors: 1,
        errors: [{ file: 'test/failing.test.ts', message: 'AssertionError: expected 5 to equal 6' }],
        guidance: 'Fix the failing test',
      });

      const result = await detector.detectAndExtract(check, logs);

      expect(result).toBeDefined();
      expect(result?.summary).toBeDefined();
    });

    it('should extract from real validate YAML output', async () => {
      const check = createTestCheck({ name: 'Validate', run_id: 12356, duration: '5m00s' });

      const logs = `
Running validation...
---
command: pnpm test
exitCode: 1
durationSecs: 3.5
timestamp: 2025-12-16T10:00:05.000Z
treeHash: abc123def456
extraction:
  summary: 2 test failure(s)
  totalErrors: 2
  errors:
    - file: packages/cli/test/example.test.ts
      line: 42
      message: Expected function to be called
    - file: packages/cli/test/other.test.ts
      line: 100
      message: Timeout exceeded
  guidance: Fix the failing tests
---
`;

      const result = await detector.detectAndExtract(check, logs);

      expectExtraction(result, { summary: '2 test failure(s)', totalErrors: 2, errorCount: 2 });
    });
  });

  describe('edge cases', () => {
    it('should handle empty logs', async () => {
      const check = createTestCheck({ name: 'Test', run_id: 12357, duration: '1s' });

      const result = await detector.detectAndExtract(check, '');

      expect(result).toBeNull();
    });

    it('should handle successful checks (no extraction needed)', async () => {
      const check = createTestCheck({ name: 'Test', run_id: 12358, conclusion: 'success' });

      const logs = `
All tests passed!
`;

      const result = await detector.detectAndExtract(check, logs);

      // Should still try to extract (might find warnings)
      expect(result).toBeDefined();
    });

    it('should handle extractor errors gracefully', async () => {
      const check = createTestCheck({ name: 'Test', run_id: 12359 });

      const logs = `Some logs`;

      vi.mocked(autoDetectAndExtract).mockImplementation(() => {
        throw new Error('Extractor error');
      });

      const result = await detector.detectAndExtract(check, logs);

      // Should return null on error, not throw
      expect(result).toBeNull();
    });

    it('should handle missing extraction field in YAML', async () => {
      const check = createTestCheck({ name: 'Test', run_id: 12360 });

      const logs = `
---
command: npm test
exitCode: 1
---
`;

      setupNonMatrixFallback('Generic error');

      const result = await detector.detectAndExtract(check, logs);

      // Should fall back to non-matrix mode
      expectNonMatrixFallbackUsed(result);
    });
  });
});
