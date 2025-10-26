import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import yaml from 'yaml';

/**
 * Integration tests for the run command with REAL command execution
 *
 * These tests actually execute vibe-validate commands to verify
 * the recursive detection works in real-world scenarios.
 */

const CLI_PATH = 'node packages/cli/dist/bin.js';

describe('run command integration', () => {
  describe('real nested execution', () => {
    it('should handle real nested vibe-validate run commands (2 levels)', () => {
      // Execute: vibe-validate run "echo test"
      // This produces real YAML output
      const innerCommand = `${CLI_PATH} run "echo 'Hello from inner command'"`;

      // Wrap it: vibe-validate run "vibe-validate run 'echo test'"
      const outerCommand = `${CLI_PATH} run "${innerCommand}"`;

      let output: string;
      let exitCode = 0;

      try {
        output = execSync(outerCommand, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: any) {
        output = error.stdout || '';
        exitCode = error.status || 1;
      }

      // Parse YAML output
      const parsed = yaml.parse(output);

      // Should detect nesting and add suggestedDirectCommand
      expect(parsed.suggestedDirectCommand).toBeDefined();
      expect(parsed.suggestedDirectCommand).toContain('echo');

      // Should preserve exit code
      expect(parsed.exitCode).toBe(0);
    });

    it.skip('should handle real nested vibe-validate run commands (3 levels)', () => {
      // Skipped: Slow (2+ seconds per nested execution)
      // 3 levels: run → run → run → echo
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

      // Should unwrap to innermost command (which includes the full CLI_PATH + echo)
      expect(parsed.suggestedDirectCommand).toBeDefined();
      expect(parsed.suggestedDirectCommand).toContain('Deep nesting test');
    });

    it.skip('should handle wrapping pnpm test:llm (which uses run internally)', () => {
      // Skipped: Too slow for unit tests (runs full test suite)
      // This is tested by manual testing
      // test:llm internally calls vibe-validate run
      // Wrapping it should detect the nesting
      const command = `${CLI_PATH} run "pnpm test:llm -- packages/cli/test/commands/run.test.ts"`;

      let output: string;
      let exitCode = 0;

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 60000, // 60 second timeout
        });
      } catch (error: any) {
        output = error.stdout || '';
        exitCode = error.status || 1;
      }

      const parsed = yaml.parse(output);

      // Should detect nested run and add suggestion
      expect(parsed.suggestedDirectCommand).toBeDefined();
      expect(parsed.suggestedDirectCommand).toContain('vitest');
    });
  });

  describe('real error scenarios', () => {
    it('should handle real failing command with error extraction', () => {
      // Command that will fail
      const command = `${CLI_PATH} run "node -e 'process.exit(1)'"`;

      let output: string;
      let exitCode = 0;

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: any) {
        output = error.stdout || '';
        exitCode = error.status || 1;
      }

      const parsed = yaml.parse(output);

      // Should have non-zero exit code
      expect(parsed.exitCode).toBe(1);

      // Should have extraction data
      expect(parsed.extraction).toBeDefined();
    });

    it('should handle real command with non-standard exit code', () => {
      const command = `${CLI_PATH} run "node -e 'process.exit(42)'"`;

      let output: string;
      let exitCode = 0;

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: any) {
        output = error.stdout || '';
        exitCode = error.status || 1;
      }

      const parsed = yaml.parse(output);

      // Should preserve exit code 42
      expect(parsed.exitCode).toBe(42);
    });
  });

  describe('real extractor integration', () => {
    it.skip('should extract real TypeScript errors from tsc', () => {
      // Skipped: tsc stdin may not work reliably across environments
      // Tested via manual testing and unit tests
      // Create temporary TypeScript file with error
      const tsCode = 'const x: number = "string";'; // Type error
      const command = `${CLI_PATH} run "echo '${tsCode}' | npx tsc --noEmit --stdin"`;

      let output: string;

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: any) {
        output = error.stdout || '';
      }

      const parsed = yaml.parse(output);

      // Should detect as TypeScript and extract
      expect(parsed.extraction).toBeDefined();
      expect(parsed.command).toBeDefined();
    });

    it.skip('should extract real vitest test failures', () => {
      // Skipped: Too slow for unit tests (60s timeout)
      // Tested via manual testing
      // Run a specific test file
      const command = `${CLI_PATH} run "npx vitest run packages/cli/test/commands/run.test.ts"`;

      let output: string;

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 60000,
        });
      } catch (error: any) {
        output = error.stdout || '';
      }

      const parsed = yaml.parse(output);

      // Should detect vitest and extract
      expect(parsed.extraction).toBeDefined();
      expect(parsed.extraction.summary).toBeDefined();
      expect(parsed.extraction.errors).toBeDefined();
    });
  });

  describe('real stdout/stderr handling', () => {
    it('should handle commands that write to both stdout and stderr', () => {
      const command = `${CLI_PATH} run "node -e 'console.log(\"stdout\"); console.error(\"stderr\");'"`;

      let output: string;

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: any) {
        output = error.stdout || '';
      }

      const parsed = yaml.parse(output);

      // Should have both in rawOutput (if present)
      expect(parsed.command).toBeDefined();
      expect(parsed.extraction).toBeDefined();
    });
  });

  describe('real YAML output preservation', () => {
    it.skip('should preserve all fields when wrapping validate command', () => {
      // Skipped: Depends on project state and git notes
      // Tested via manual testing and unit tests
      // Note: This test requires validate to be runnable
      // Skip if not in a valid git repo or config missing
      const command = `${CLI_PATH} run "${CLI_PATH} state"`;

      let output: string;

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
        });
      } catch (error: any) {
        // Skip test if state command not available
        if (error.status === 127 || error.message.includes('not found')) {
          return;
        }
        output = error.stdout || '';
      }

      if (output.trim()) {
        const parsed = yaml.parse(output);

        // Should have suggestedDirectCommand
        expect(parsed.suggestedDirectCommand).toBeDefined();

        // Should preserve inner fields (state-specific fields)
        expect(parsed.command).toBeDefined();
      }
    });
  });

  describe('performance', () => {
    it('should handle nested execution without significant overhead', () => {
      const start = Date.now();

      const command = `${CLI_PATH} run "${CLI_PATH} run 'echo fast'"`;

      try {
        execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: any) {
        // Ignore errors, just testing performance
      }

      const duration = Date.now() - start;

      // Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);
    });
  });
});
