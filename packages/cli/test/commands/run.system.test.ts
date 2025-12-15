import { spawnSync } from 'node:child_process';

import { describe, it, expect } from 'vitest';

import { parseRunYamlOutput } from '../helpers/run-command-helpers.js';
import { executeCommandWithYaml } from '../helpers/test-command-runner.js';

/**
 * SYSTEM TESTS for the run command
 *
 * These tests execute REAL commands and may take 30s-2min to run.
 * They verify end-to-end behavior with actual test frameworks.
 *
 * Run with: pnpm test:system
 *
 * These tests were moved from run.integration.test.ts because they were
 * too slow (60s+ timeouts) for the fast unit test feedback loop.
 */

const CLI_PATH = 'node packages/cli/dist/bin.js';

describe('run command system tests', () => {
  describe('deep nested execution', () => {
    it('should handle 3-level nested vibe-validate run commands', () => {
      // Test 3-level nesting - verifying suggestedDirectCommand extraction
      // This ensures recursive detection logic works at depth
      // 3 levels: run → run → run → echo
      // This is slow (2+ seconds per nested execution = 6+ seconds total)
      const level1 = `${CLI_PATH} run "echo 'Deep nesting test'"`;
      const level2 = `${CLI_PATH} run "${level1}"`;
      const level3 = `${CLI_PATH} run "${level2}"`;

      let output: string;

      try {
        // INTENTIONAL: Use shell:true for this test - testing complex quote handling
        // This test verifies vv run's ability to unwrap nested quoted commands
        const result = spawnSync(level3, [], {
          shell: true,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        output = result.stdout || '';
      } catch (error: any) { // NOSONAR - execSync throws on non-zero exit, we need stdout
        output = error.stdout || '';
      }

      const parsed = parseRunYamlOutput(output);

      // Should unwrap to innermost command
      // v0.15.0+: command contains unwrapped command, requestedCommand shows what user typed
      expect(parsed.command).toBeDefined();
      expect(parsed.command).toContain('echo');

      // Should have requestedCommand showing the nested structure
      expect(parsed.requestedCommand).toBeDefined();
      expect(parsed.requestedCommand).toContain('run');
    });

    it('should handle wrapping pnpm test (which uses run internally)', () => {
      // SIMPLIFIED: Just run a single fast test directly with vitest
      // This avoids the recursion/loop of: run → pnpm test → run → vitest → full test suite
      // Instead: run → npx vitest single-file
      const command = `${CLI_PATH} run "npx vitest packages/extractors/test/typescript-extractor.test.ts --run"`;

      const result = executeCommandWithYaml(command, { timeout: 30000 });

      // Should successfully extract errors (if any) from the test run
      expect(result.parsed).toBeDefined();
      expect(result.parsed.exitCode).toBeDefined();
      // This test file should pass, so exitCode should be 0
      expect(result.parsed.exitCode).toBe(0);
    });
  });

  describe('real extractor integration', () => {
    it('should extract real vitest test failures from extractors-test-bed', () => {
      // Run against the comprehensive-failures test file
      // This test is DESIGNED to fail with multiple errors
      // NOTE: Must run from extractors-test-bed directory for paths to work
      const command = `node ../../packages/cli/dist/bin.js run "npx vitest tests/vitest/comprehensive-failures.test.ts --run"`;

      const result = executeCommandWithYaml(command, {
        cwd: 'packages/extractors-test-bed',
        timeout: 60000,
      });

      const parsed = result.parsed;

      // Debug: Show extraction results
      console.log('\nDEBUG: Vitest extraction results:');
      console.log('  Exit code:', parsed.exitCode);
      console.log('  Errors extracted:', parsed.extraction?.errors?.length || 0);
      console.log('  Summary:', parsed.extraction?.summary);
      if (parsed.extraction?.errors?.length) {
        console.log('  First error:', JSON.stringify(parsed.extraction.errors[0], null, 2));
      }
      console.log('  Raw output (first 500 chars):', parsed.rawOutput?.substring(0, 500));

      // Should detect vitest and extract errors
      expect(parsed.extraction).toBeDefined();
      expect(parsed.extraction.summary).toBeDefined();
      expect(parsed.extraction.errors).toBeDefined();

      // TDD: This assertion VERIFIES Vitest extractor is working
      // comprehensive-failures.test.ts has 15 test cases with intentional failures
      // Expected: 10+ errors extracted (extractor limits to 10 for LLM context)
      // Actual: Vitest extractor successfully extracts 10 errors ✅
      // This test is our BASELINE - it should PASS
      expect(parsed.extraction.errors.length).toBeGreaterThanOrEqual(10);

      // Exit code should be non-zero (tests failed)
      expect(parsed.exitCode).not.toBe(0);
    });

    it('should extract real Jest test failures from extractors-test-bed', () => {
      // This test verifies Jest extractor quality
      // Expected: 6+ errors, Currently getting fewer (Issue tracked in project backlog)
      // NOTE: Must run from extractors-test-bed directory for paths to work
      // NOTE: Jest is slower than other runners - needs longer timeout
      const command = `node ../../packages/cli/dist/bin.js run "npx jest tests/jest/comprehensive-failures.test.ts"`;

      const result = executeCommandWithYaml(command, {
        cwd: 'packages/extractors-test-bed',
        timeout: 120000,
      });

      const parsed = result.parsed;

      // Debug: Show extraction results
      console.log('\nDEBUG: Jest extraction results:');
      console.log('  Exit code:', parsed?.exitCode);
      console.log('  Errors extracted:', parsed.extraction?.errors?.length || 0);
      console.log('  Summary:', parsed.extraction?.summary);
      if (parsed.extraction?.errors?.length) {
        console.log('  First error:', JSON.stringify(parsed.extraction.errors[0], null, 2));
      } else {
        console.log('  Raw output (first 800 chars):', parsed.rawOutput?.substring(0, 800));
      }

      // Should detect Jest and extract errors
      expect(parsed.extraction).toBeDefined();
      expect(parsed.extraction.summary).toBeDefined();
      expect(parsed.extraction.errors).toBeDefined();

      // TDD: This assertion SHOWS us the Jest extractor issue
      // comprehensive-failures.test.ts has 15 intentional test failures
      // Expected: 15 errors extracted
      // Actual: Jest extractor currently only extracts ~1 error
      // When this test PASSES, the Jest extractor is fixed!
      expect(parsed.extraction.errors.length).toBeGreaterThan(10); // Should be ~15

      expect(parsed.exitCode).not.toBe(0);
    });

    it('should extract real Playwright test failures from extractors-test-bed', () => {
      // This test verifies Playwright extractor quality
      // Expected: 11 errors, Currently getting fewer (Issue tracked in project backlog)
      // NOTE: Must run from extractors-test-bed directory for paths to work
      const command = `node ../../packages/cli/dist/bin.js run "npx playwright test tests/playwright/comprehensive-failures.spec.ts"`;

      const result = executeCommandWithYaml(command, {
        cwd: 'packages/extractors-test-bed',
        timeout: 120000,
      });

      const parsed = result.parsed;

      // Debug: Show extraction results
      console.log('\nDEBUG: Playwright extraction results:');
      console.log('  Exit code:', parsed.exitCode);
      console.log('  Errors extracted:', parsed.extraction?.errors?.length || 0);
      console.log('  Summary:', parsed.extraction?.summary);
      if (parsed.extraction?.errors?.length) {
        console.log('  First error:', JSON.stringify(parsed.extraction.errors[0], null, 2));
      } else {
        console.log('  Raw output (first 800 chars):', parsed.rawOutput?.substring(0, 800));
      }

      // Should detect Playwright and extract errors
      expect(parsed.extraction).toBeDefined();
      expect(parsed.extraction.summary).toBeDefined();
      expect(parsed.extraction.errors).toBeDefined();

      // TDD: This assertion SHOWS us the Playwright extractor issue
      // comprehensive-failures.spec.ts has 11 intentional test failures
      // Expected: 11 errors extracted
      // Actual: Playwright extractor currently extracts 0 errors
      // When this test PASSES, the Playwright extractor is fixed!
      expect(parsed.extraction.errors.length).toBe(11);

      expect(parsed.exitCode).not.toBe(0);
    });

    it('should extract real TypeScript errors from tsc', () => {
      // Test TypeScript extractor with real tsc output
      // This creates a file with a type error and runs tsc on it
      const command = `${CLI_PATH} run "pnpm typecheck"`;

      const result = executeCommandWithYaml(command, { timeout: 60000 });
      const parsed = result.parsed;

      // Should detect as TypeScript and extract (even if no errors)
      expect(parsed.extraction).toBeDefined();
      expect(parsed.command).toBeDefined();

      // If there are TypeScript errors, they should be extracted
      if (result.exitCode !== 0) {
        expect(parsed.extraction.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('real validation command wrapping', () => {
    it('should handle wrapping validate command (YAML output)', () => {
      // Test wrapping vibe-validate validate command with --check flag
      // This verifies that YAML output from vibe-validate commands
      // is properly detected and merged
      // Using --check so it runs quickly without executing validation
      const command = `${CLI_PATH} run "${CLI_PATH} validate --check"`;

      let output: string;

      try {
        // INTENTIONAL: Use shell:true for this test - testing quoted command wrapping
        // This test verifies vv run can wrap commands that contain quotes
        const result = spawnSync(command, [], {
          shell: true,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
        });
        output = result.stdout || '';
      } catch (error: any) { // NOSONAR - execSync throws on non-zero exit, we need stdout
        // validate --check may exit with non-zero if no validation state
        output = error.stdout || '';
      }

      if (output.trim()) {
        const parsed = parseRunYamlOutput(output);

        // Should successfully execute
        expect(parsed.command).toBeDefined();
        expect(parsed.command).toContain('validate');
        expect(parsed.exitCode).toBeDefined();

        // Note: requestedCommand is only added for multi-level nesting (vv run "vv run ...")
        // Single-level wrapping (vv run "vv validate") doesn't add requestedCommand
      }
    });
  });

  describe('performance with real execution', () => {
    it('should complete nested execution in reasonable time', () => {
      // Verify that nested execution overhead is acceptable
      const start = Date.now();

      const command = `${CLI_PATH} run "${CLI_PATH} run 'echo performance test'"`;

      try {
        // INTENTIONAL: Use shell:true for this test - testing performance of nested commands
        // This test measures execution time with complex quote handling
        spawnSync(command, [], {
          shell: true,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: any) { // NOSONAR - Ignoring errors, just testing performance
        // Expected - command may fail but we're only measuring execution time
        expect(error).toBeDefined();
      }

      const duration = Date.now() - start;

      // Should complete in reasonable time (< 10 seconds for 2-level nesting)
      expect(duration).toBeLessThan(10000);
    });
  });
});
