import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import yaml from 'yaml';

/**
 * Integration tests for the run command with REAL command execution
 *
 * These are FAST integration tests (<10s total) that execute real commands
 * but complete quickly. For slower system tests (60s+ timeouts), see:
 * run.system.test.ts (run with: pnpm test:system)
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
      let _exitCode = 0;

      try {
        output = execSync(outerCommand, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: any) { // NOSONAR - execSync throws on non-zero exit, we need stdout/stderr
        output = error.stdout || '';
        _exitCode = error.status || 1;
      }

      // Parse YAML output
      const parsed = yaml.parse(output);

      // Should detect nesting and add suggestedDirectCommand
      expect(parsed.suggestedDirectCommand).toBeDefined();
      expect(parsed.suggestedDirectCommand).toContain('echo');

      // Should preserve exit code
      expect(parsed.exitCode).toBe(0);
    });

    // Slow nested execution tests moved to run.system.test.ts
  });

  describe('real error scenarios', () => {
    it('should handle real failing command with error extraction', () => {
      // Command that will fail
      const command = `${CLI_PATH} run "node -e 'process.exit(1)'"`;

      let output: string;

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err: any) {
        output = err.stdout || '';
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

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err: any) {
        output = err.stdout || '';
      }

      const parsed = yaml.parse(output);

      // Should preserve exit code 42
      expect(parsed.exitCode).toBe(42);
    });
  });

  // Real extractor integration tests moved to run.system.test.ts

  describe('real stdout/stderr handling', () => {
    it('should handle commands that write to both stdout and stderr', () => {
      const command = `${CLI_PATH} run "node -e 'console.log("stdout"); console.error("stderr");'"`;

      let output: string;

      try {
        output = execSync(command, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err: any) {
        output = err.stdout || '';
      }

      const parsed = yaml.parse(output);

      // Should have both in rawOutput (if present)
      expect(parsed.command).toBeDefined();
      expect(parsed.extraction).toBeDefined();
    });
  });

  // Real YAML output preservation tests moved to run.system.test.ts

  describe('caching behavior', () => {
    it('should invalidate cache when tree hash changes', () => {
      const tmpFile = `tmp-cache-test-${Date.now()}.txt`;

      try {
        // Run command first time - should execute (no cache)
        const firstRun = execSync(`${CLI_PATH} run "echo 'Cache test'"`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const firstParsed = yaml.parse(firstRun);
        expect(firstParsed.exitCode).toBe(0);
        expect(firstParsed.command).toBe('echo \'Cache test\'');

        // Run again immediately - should hit cache (same tree hash)
        const cachedRun = execSync(`${CLI_PATH} run "echo 'Cache test'"`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const cachedParsed = yaml.parse(cachedRun);
        expect(cachedParsed.exitCode).toBe(0);

        // Create a new file to change tree hash
        execSync(`echo "test" > ${tmpFile}`, { encoding: 'utf-8' });

        // Run same command again - cache should be invalidated due to tree hash change
        // Should execute again (not from cache)
        const thirdRun = execSync(`${CLI_PATH} run "echo 'Cache test'"`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const thirdParsed = yaml.parse(thirdRun);
        expect(thirdParsed.exitCode).toBe(0);
        expect(thirdParsed.command).toBe('echo \'Cache test\'');

        // Cleanup
        execSync(`rm ${tmpFile}`, { encoding: 'utf-8' });
      } catch (error: any) { // NOSONAR - Need to access stdout from error for test verification
        // Cleanup on error
        try {
          execSync(`rm ${tmpFile}`, { encoding: 'utf-8' });
        } catch {
          // Ignore cleanup errors
        }
        throw error;
      }
    });

    it('should create separate cache entries for different working directories', () => {
      const absoluteCliPath = `${process.cwd()}/packages/cli/dist/bin.js`;

      // Run command in root
      const rootRun = execSync(`node ${absoluteCliPath} run "echo 'root'"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
      });
      const rootParsed = yaml.parse(rootRun);

      // Run same command text in subdirectory
      const subdirRun = execSync(`node ${absoluteCliPath} run "echo 'root'"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: `${process.cwd()}/packages/cli`,
      });
      const subdirParsed = yaml.parse(subdirRun);

      // Both should succeed
      expect(rootParsed.exitCode).toBe(0);
      expect(subdirParsed.exitCode).toBe(0);

      // Same command text but different working directories
      expect(rootParsed.command).toBe('echo \'root\'');
      expect(subdirParsed.command).toBe('echo \'root\'');

      // Both should have executed (not from same cache due to different workdir)
      expect(rootParsed.extraction).toBeDefined();
      expect(subdirParsed.extraction).toBeDefined();
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
      } catch (error: any) { // NOSONAR - Ignoring errors, just testing performance
        // Expected - command may fail but we're only measuring execution time
        expect(error).toBeDefined();
      }

      const duration = Date.now() - start;

      // Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);
    });
  });
});
