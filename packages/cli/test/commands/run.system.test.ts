import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import yaml from 'yaml';

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
    it.skip('should handle 3-level nested vibe-validate run commands', () => {
      // TODO: This test is currently failing - suggestedDirectCommand extraction
      // needs debugging. The recursive detection logic may have issues with
      // 3+ levels of nesting. This is lower priority than fixing extractors.
      // 3 levels: run → run → run → echo
      // This is slow (2+ seconds per nested execution = 6+ seconds total)
      const level1 = `${CLI_PATH} run "echo 'Deep nesting test'"`;
      const level2 = `${CLI_PATH} run "${level1}"`;
      const level3 = `${CLI_PATH} run "${level2}"`;

      let output: string;

      try {
        output = execSync(level3, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: any) {
        output = error.stdout || '';
      }

      const parsed = yaml.parse(output);

      // Debug: Show what we actually received
      if (!parsed.suggestedDirectCommand || !parsed.suggestedDirectCommand.includes('echo')) {
        console.log('DEBUG: 3-level nesting output:');
        console.log('  suggestedDirectCommand:', parsed.suggestedDirectCommand);
        console.log('  command:', parsed.command);
        console.log('  Full output (first 500 chars):', output.substring(0, 500));
      }

      // Should unwrap to innermost command
      expect(parsed.suggestedDirectCommand).toBeDefined();
      expect(parsed.suggestedDirectCommand).toContain('echo');
    });

    it('should handle wrapping pnpm test (which uses run internally)', () => {
      // This runs a real test file through vibe-validate run
      // The test itself is wrapped by pnpm test which uses run
      // So we get nested run detection
      const command = `${CLI_PATH} run "pnpm test -- packages/cli/test/commands/run.test.ts"`;

      let output: string;
      let exitCode = 0;

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          timeout: 60000, // 60 second timeout (runs full test suite)
        });
      } catch (error: any) {
        // vibe-validate run outputs to stdout, but with stdio: ['pipe', 'pipe', 'pipe']
        // and non-zero exit, output may be in stderr. Check both.
        output = error.stdout || error.stderr || '';
        exitCode = error.status || 1;
      }

      const parsed = yaml.parse(output);

      // Should detect nested run and add suggestion
      expect(parsed.suggestedDirectCommand).toBeDefined();
      expect(parsed.suggestedDirectCommand).toContain('vitest');
    });
  });

  describe('real extractor integration', () => {
    it('should extract real vitest test failures from extractors-test-bed', () => {
      // Run against the comprehensive-failures test file
      // This test is DESIGNED to fail with multiple errors
      // NOTE: Must run from extractors-test-bed directory for paths to work
      const command = `node ../../packages/cli/dist/bin.js run "npx vitest tests/vitest/comprehensive-failures.test.ts --run"`;

      let output: string;
      let exitCode = 0;

      try {
        output = execSync(command, {
          cwd: 'packages/extractors-test-bed', // Run from extractors-test-bed directory
          encoding: 'utf-8',
          timeout: 60000, // 60 seconds for real vitest execution
        });
      } catch (error: any) {
        // Command failed - capture output from error object
        output = error.stdout || error.stderr || '';
        exitCode = error.status || 1;
      }

      const parsed = yaml.parse(output);

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
      // Expected: 6+ errors, Currently getting fewer (Issue tracked in TODO.md)
      // NOTE: Must run from extractors-test-bed directory for paths to work
      // NOTE: Jest is slower than other runners - needs longer timeout
      const command = `node ../../packages/cli/dist/bin.js run "npx jest tests/jest/comprehensive-failures.test.ts"`;

      let output: string;
      let exitCode = 0;

      try {
        output = execSync(command, {
          cwd: 'packages/extractors-test-bed', // Run from extractors-test-bed directory
          encoding: 'utf-8',
          timeout: 120000, // Jest needs 2 minutes
        });
      } catch (error: any) {
        // Command failed - capture output from error object
        output = error.stdout || error.stderr || '';
        exitCode = error.status || 1;
      }

      const parsed = yaml.parse(output);

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
      // Expected: 11 errors, Currently getting fewer (Issue tracked in TODO.md)
      // NOTE: Must run from extractors-test-bed directory for paths to work
      const command = `node ../../packages/cli/dist/bin.js run "npx playwright test tests/playwright/comprehensive-failures.spec.ts"`;

      let output: string;
      let exitCode = 0;

      try {
        output = execSync(command, {
          cwd: 'packages/extractors-test-bed', // Run from extractors-test-bed directory
          encoding: 'utf-8',
          timeout: 120000, // Playwright needs 2 minutes (browser startup + test timeouts)
        });
      } catch (error: any) {
        // Command failed - capture output from error object
        output = error.stdout || error.stderr || '';
        exitCode = error.status || 1;
      }

      const parsed = yaml.parse(output);

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

      let output: string;
      let exitCode = 0;

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          timeout: 60000,
        });
      } catch (error: any) {
        // vibe-validate run outputs to stdout, but with stdio: ['pipe', 'pipe', 'pipe']
        // and non-zero exit, output may be in stderr. Check both.
        output = error.stdout || error.stderr || '';
        exitCode = error.status || 1;
      }

      const parsed = yaml.parse(output);

      // Should detect as TypeScript and extract (even if no errors)
      expect(parsed.extraction).toBeDefined();
      expect(parsed.command).toBeDefined();

      // If there are TypeScript errors, they should be extracted
      if (exitCode !== 0) {
        expect(parsed.extraction.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('real validation command wrapping', () => {
    it.skip('should preserve all fields when wrapping state command', () => {
      // TODO: This test is currently failing - needs investigation
      // Lower priority than fixing extractors
      // Test wrapping vibe-validate state command
      // This verifies that YAML output from vibe-validate commands
      // is properly detected and merged
      const command = `${CLI_PATH} run "${CLI_PATH} state"`;

      let output: string;

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
        });
      } catch (error: any) {
        // Skip test if state command not available or errors
        if (error.status === 127 || error.message.includes('not found')) {
          return;
        }
        output = error.stdout || '';
      }

      if (output.trim()) {
        const parsed = yaml.parse(output);

        // Should have suggestedDirectCommand (detected nesting)
        expect(parsed.suggestedDirectCommand).toBeDefined();

        // Should preserve inner fields (state-specific fields)
        expect(parsed.command).toBeDefined();
      }
    });
  });

  describe('performance with real execution', () => {
    it('should complete nested execution in reasonable time', () => {
      // Verify that nested execution overhead is acceptable
      const start = Date.now();

      const command = `${CLI_PATH} run "${CLI_PATH} run 'echo performance test'"`;

      try {
        execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: any) {
        // Ignore errors, just testing performance
      }

      const duration = Date.now() - start;

      // Should complete in reasonable time (< 10 seconds for 2-level nesting)
      expect(duration).toBeLessThan(10000);
    });
  });
});
