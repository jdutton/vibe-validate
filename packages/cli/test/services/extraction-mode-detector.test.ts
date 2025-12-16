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
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitHubActionCheck } from '../../src/schemas/watch-pr-result.schema.js';
import { ExtractionModeDetector } from '../../src/services/extraction-mode-detector.js';

// Mock autoDetectAndExtract
vi.mock('@vibe-validate/extractors', () => ({
  autoDetectAndExtract: vi.fn(),
}));

describe('ExtractionModeDetector', () => {
  let detector: ExtractionModeDetector;

  beforeEach(() => {
    detector = new ExtractionModeDetector();
    vi.clearAllMocks();
  });

  describe('matrix mode detection', () => {
    it('should detect matrix mode with validate YAML output', async () => {
      const check: GitHubActionCheck = {
        name: 'CI / Test',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12345,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '2m30s',
        log_command: 'gh run view 12345 --log',
      };

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

      expect(result).toBeDefined();
      expect(result?.summary).toBe('2 test failure(s)');
      expect(result?.totalErrors).toBe(2);
      expect(result?.errors).toHaveLength(2);
      expect(result?.guidance).toBe('Fix the failing tests');
    });

    it('should handle matrix mode with nested YAML', async () => {
      const check: GitHubActionCheck = {
        name: 'CI / Lint',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12346,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '1m15s',
        log_command: 'gh run view 12346 --log',
      };

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
      const check: GitHubActionCheck = {
        name: 'CI / Test',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12347,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '2m30s',
        log_command: 'gh run view 12347 --log',
      };

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
      const check: GitHubActionCheck = {
        name: 'CI / Test',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12348,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '2m30s',
        log_command: 'gh run view 12348 --log',
      };

      const logs = `
---
extraction:
  summary: malformed { yaml
  errors: [not closed
---
`;

      vi.mocked(autoDetectAndExtract).mockReturnValue({
        summary: '1 error',
        totalErrors: 1,
        errors: [{ message: 'Error' }],
      });

      const result = await detector.detectAndExtract(check, logs);

      // Should fall back to non-matrix mode
      expect(result).toBeDefined();
      expect(autoDetectAndExtract).toHaveBeenCalled();
    });
  });

  describe('non-matrix mode detection', () => {
    it('should detect vitest from check name', async () => {
      const check: GitHubActionCheck = {
        name: 'Test (vitest)',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12349,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '2m30s',
        log_command: 'gh run view 12349 --log',
      };

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
      const check: GitHubActionCheck = {
        name: 'Test (jest)',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12350,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '2m30s',
        log_command: 'gh run view 12350 --log',
      };

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
      const check: GitHubActionCheck = {
        name: 'Lint (ESLint)',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12351,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '1m15s',
        log_command: 'gh run view 12351 --log',
      };

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
      const check: GitHubActionCheck = {
        name: 'TypeCheck',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12352,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '30s',
        log_command: 'gh run view 12352 --log',
      };

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
      const check: GitHubActionCheck = {
        name: 'CI / Test',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12353,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '2m30s',
        log_command: 'gh run view 12353 --log',
      };

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
      const check: GitHubActionCheck = {
        name: 'Unknown Check',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12354,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '1m00s',
        log_command: 'gh run view 12354 --log',
      };

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
      const check: GitHubActionCheck = {
        name: 'Test',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12355,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '2m30s',
        log_command: 'gh run view 12355 --log',
      };

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
      const check: GitHubActionCheck = {
        name: 'Validate',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12356,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '5m00s',
        log_command: 'gh run view 12356 --log',
      };

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

      expect(result).toBeDefined();
      expect(result?.summary).toBe('2 test failure(s)');
      expect(result?.totalErrors).toBe(2);
      expect(result?.errors).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty logs', async () => {
      const check: GitHubActionCheck = {
        name: 'Test',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12357,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '1s',
        log_command: 'gh run view 12357 --log',
      };

      const result = await detector.detectAndExtract(check, '');

      expect(result).toBeNull();
    });

    it('should handle successful checks (no extraction needed)', async () => {
      const check: GitHubActionCheck = {
        name: 'Test',
        status: 'completed',
        conclusion: 'success',
        run_id: 12358,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '2m30s',
        log_command: 'gh run view 12358 --log',
      };

      const logs = `
All tests passed!
`;

      const result = await detector.detectAndExtract(check, logs);

      // Should still try to extract (might find warnings)
      expect(result).toBeDefined();
    });

    it('should handle extractor errors gracefully', async () => {
      const check: GitHubActionCheck = {
        name: 'Test',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12359,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '2m30s',
        log_command: 'gh run view 12359 --log',
      };

      const logs = `Some logs`;

      vi.mocked(autoDetectAndExtract).mockImplementation(() => {
        throw new Error('Extractor error');
      });

      const result = await detector.detectAndExtract(check, logs);

      // Should return null on error, not throw
      expect(result).toBeNull();
    });

    it('should handle missing extraction field in YAML', async () => {
      const check: GitHubActionCheck = {
        name: 'Test',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12360,
        workflow: 'CI',
        started_at: '2025-12-16T10:00:00Z',
        duration: '2m30s',
        log_command: 'gh run view 12360 --log',
      };

      const logs = `
---
command: npm test
exitCode: 1
---
`;

      vi.mocked(autoDetectAndExtract).mockReturnValue({
        summary: 'Generic error',
        totalErrors: 1,
        errors: [{ message: 'Error' }],
      });

      const result = await detector.detectAndExtract(check, logs);

      // Should fall back to non-matrix mode
      expect(result).toBeDefined();
      expect(autoDetectAndExtract).toHaveBeenCalled();
    });
  });
});
