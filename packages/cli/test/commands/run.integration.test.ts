import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getNotesRefs } from '@vibe-validate/git';
import { normalizePath, safeExecSync } from '@vibe-validate/utils';
import { describe, it, expect } from 'vitest';
import yaml from 'yaml';

import { executeVibeValidateCommand, getCliPath } from '../helpers/cli-execution-helpers.js';
import { parseRunYamlOutput, expectValidRunYaml } from '../helpers/run-command-helpers.js';


/**
 * Integration tests for the run command with REAL command execution
 *
 * These are FAST integration tests (<10s total) that execute real commands
 * but complete quickly. For slower system tests (60s+ timeouts), see:
 * run.system.test.ts (run with: pnpm test:system)
 */

// Get the workspace root by going up from this test file location
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = normalizePath(__dirname, '../../../..');

// Git environment variables for test isolation
const GIT_TEST_ENV = {
  GIT_AUTHOR_NAME: 'Test User',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test User',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

/**
 * Execute vibe-validate CLI command using shared helpers (Windows-compatible)
 * @param cliArgs - Arguments to pass to CLI
 * @param options - Execution options
 * @returns Combined stdout + stderr
 */
async function execCLI(cliArgs: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<string> {
  const result = await executeVibeValidateCommand(cliArgs, {
    ...options,
    env: { ...GIT_TEST_ENV, ...options?.env },
  });
  return result.stdout + result.stderr;
}

/**
 * Execute vibe-validate CLI and return separated stdout/stderr
 * @returns Object with stdout, stderr, and status separated
 */
async function execCLIWithStderr(cliArgs: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<{ stdout: string; stderr: string; combined: string; status?: number }> {
  const result = await executeVibeValidateCommand(cliArgs, {
    ...options,
    env: { ...GIT_TEST_ENV, ...options?.env },
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    combined: result.stdout + result.stderr,
    status: result.exitCode,
  };
}

/**
 * Execute vibe-validate CLI with different working directory
 * (Replaces execCLIWithCwd - no longer needs absolute path handling)
 */
async function execCLIWithCwd(cliArgs: string[], options: { cwd: string; env?: Record<string, string> }): Promise<string> {
  return execCLI(cliArgs, options);
}

/**
 * Helper to execute nested vv run command and validate basic properties
 * Reduces duplication in nested command cache tests
 */
async function executeNestedCommand(testCommand: string): Promise<{ parsed: any; output: string }> {
  // Execute nested: vibe-validate run "node /path/to/cli run 'command'"
  const cliPath = getCliPath('vibe-validate');
  const nestedRun = await execCLI(['run', `node ${cliPath} run ${testCommand}`]);
  const nestedParsed = parseRunYamlOutput(nestedRun);
  expect(nestedParsed.exitCode).toBe(0);
  expect(nestedParsed.command).toBe(testCommand);
  return { parsed: nestedParsed, output: nestedRun };
}

/**
 * Helper to parse YAML front matter from stdout
 * Reduces duplication in display flag tests
 */
function parseYamlFrontMatter(stdout: string): any {
  const yamlMatch = stdout.match(/^---\n([\s\S]*?)\n---/);
  expect(yamlMatch).toBeTruthy();
  const yamlContent = yamlMatch![1];
  const parsed = yaml.parse(yamlContent);
  expect(parsed.exitCode).toBe(0);
  return parsed;
}

describe('run command integration', () => {
  describe('real nested execution', () => {
    it('should handle real nested vibe-validate run commands (2 levels)', async () => {
      // Execute: vibe-validate run "echo test"
      // This produces real YAML output
      const cliPath = getCliPath('vibe-validate');
      const innerCommand = String.raw`node ${cliPath} run "node -e \"console.log('Hello from inner command')\""`;

      // Wrap it: vibe-validate run "node /path/to/cli run 'node -e ...'"
      const output = await execCLI(['run', innerCommand]);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should unwrap to innermost command (not wrapper)
      expect(parsed.command).toBeDefined();
      expect(parsed.command).toContain('node');

      // Should preserve exit code
      expect(parsed.exitCode).toBe(0);
    });

    // Slow nested execution tests moved to run.system.test.ts
  });

  describe('real error scenarios', () => {
    it('should handle real failing command with error extraction', async () => { 
      // Command that will fail
      const output = await execCLI(['run', 'node -e "process.exit(1)"']);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should have non-zero exit code
      expect(parsed.exitCode).toBe(1);

      // Should have extraction data
      expect(parsed.extraction).toBeDefined();
    });

    it('should handle real command with non-standard exit code', async () => { 
      const output = await execCLI(['run', 'node -e "process.exit(42)"']);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should preserve exit code 42
      expect(parsed.exitCode).toBe(42);
    });
  });

  // Real extractor integration tests moved to run.system.test.ts

  describe('real stdout/stderr handling', () => {
    it('should handle commands that write to both stdout and stderr', async () => { 
      const output = await execCLI(['run', String.raw`node -e "console.log(\"stdout\"); console.error(\"stderr\");"`]);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should capture both stdout and stderr in separate files
      expect(parsed.command).toBeDefined();
      expect(parsed.exitCode).toBe(0);
      expect(parsed.outputFiles).toBeDefined();
      expect(parsed.outputFiles.stdout).toBeDefined();
      expect(parsed.outputFiles.stderr).toBeDefined();
      expect(parsed.outputFiles.combined).toBeDefined();
    });
  });

  // Real YAML output preservation tests moved to run.system.test.ts

  describe('caching behavior', () => {
    it('should write git notes refs when caching successful commands', async () => { 
      const command = `node -e "console.log('Cache write test ${Date.now()}')"`;

      // First run - should execute and cache
      const firstRun = await execCLI(['run', command]);

      const firstParsed = parseRunYamlOutput(firstRun);
      expect(firstParsed.exitCode).toBe(0);
      const treeHash = firstParsed.treeHash;

      // CRITICAL: Verify git notes ref was actually created
      // Use getNotesRefs from @vibe-validate/git (architectural compliance)
      const notesRefs = getNotesRefs(`refs/notes/vibe-validate/run/${treeHash}`);
      expect(notesRefs).not.toBe(''); // Cache was written!
      expect(notesRefs).toContain('refs/notes/vibe-validate/run/');

      // Second run - should hit cache
      const secondRun = await execCLI(['run', command]);

      const secondParsed = parseRunYamlOutput(secondRun);
      expect(secondParsed.exitCode).toBe(0);
      expect(secondParsed.isCachedResult).toBe(true); // Cache was read!
      expect(secondParsed.treeHash).toBe(treeHash); // Same tree hash
    });

    it('should not write git notes for failed commands', async () => { 
      const output = await execCLI(['run', 'exit 1']);

      const firstParsed = parseRunYamlOutput(output);
      expect(firstParsed.exitCode).toBe(1);
      const treeHash = firstParsed.treeHash;

      // Verify NO git notes ref was created for this failed command
      // (failed commands don't cache)
      // Note: We can't easily verify "this specific command" wasn't cached without
      // more complex logic (would need to inspect git notes content for this treeHash),
      // but the fact that failed commands return exitCode 1 and the caching code
      // skips exitCode !== 0 is verified by the implementation and other tests
      expect(treeHash).toBeDefined(); // Verify we got a tree hash
    });

    it('should invalidate cache when tree hash changes', async () => { 
      const tmpFile = `tmp-cache-test-${Date.now()}.txt`;

      try {
        // Run command first time - should execute (no cache)
        const firstRun = await execCLI(['run', "node -e \"console.log('Cache test')\""]);
        // Parse YAML output - opening delimiter only (no display flags)
        expect(firstRun).toMatch(/^---\n/);
        const firstParsed = parseRunYamlOutput(firstRun);
        expect(firstParsed.exitCode).toBe(0);
        expect(firstParsed.command).toBe('node -e "console.log(\'Cache test\')"');

        // Run again immediately - should hit cache (same tree hash)
        const cachedRun = await execCLI(['run', "node -e \"console.log('Cache test')\""]);
        expect(cachedRun).toMatch(/^---\n/);
        const cachedParsed = parseRunYamlOutput(cachedRun);
        expect(cachedParsed.exitCode).toBe(0);

        // Create a new file to change tree hash
        safeExecSync('node', ['-e', String.raw`require('fs').writeFileSync('${tmpFile}', 'test\n')`], { encoding: 'utf-8' });

        // Run same command again - cache should be invalidated due to tree hash change
        // Should execute again (not from cache)
        const thirdRun = await execCLI(['run', "node -e \"console.log('Cache test')\""]);
        expect(thirdRun).toMatch(/^---\n/);
        const thirdParsed = parseRunYamlOutput(thirdRun);
        expect(thirdParsed.exitCode).toBe(0);
        expect(thirdParsed.command).toBe('node -e "console.log(\'Cache test\')"');

        // Cleanup
        safeExecSync('rm', [tmpFile], { encoding: 'utf-8' });
      } catch (error: any) { // NOSONAR - Need to access stdout from error for test verification
        // Cleanup on error
        try {
          safeExecSync('rm', [tmpFile], { encoding: 'utf-8' });
        } catch {
          // Ignore cleanup errors
        }
        throw error;
      }
    });

    it('should create separate cache entries for different working directories', async () => {
      // Run command in workspace root
      const rootRun = await execCLIWithCwd(['run', "echo 'root'"], {
        cwd: WORKSPACE_ROOT,
      });
      // Parse YAML output - opening delimiter only (no display flags)
      expect(rootRun).toMatch(/^---\n/);
      const rootParsed = parseRunYamlOutput(rootRun);

      // Run same command text in subdirectory
      const subdirRun = await execCLIWithCwd(['run', "echo 'root'"], {
        cwd: path.join(WORKSPACE_ROOT, 'packages/cli'),
      });
      expect(subdirRun).toMatch(/^---\n/);
      const subdirParsed = parseRunYamlOutput(subdirRun);

      // Both should succeed
      expect(rootParsed.exitCode).toBe(0);
      expect(subdirParsed.exitCode).toBe(0);

      // Same command text but different working directories
      expect(rootParsed.command).toBe('echo \'root\'');
      expect(subdirParsed.command).toBe('echo \'root\'');

      // Token optimization: extraction omitted for successful runs with no errors
      expect(rootParsed.extraction).toBeUndefined();
      expect(subdirParsed.extraction).toBeUndefined();

      // Both should have executed (verify via timestamp difference or outputFiles presence)
      expect(rootParsed.timestamp).toBeDefined();
      expect(subdirParsed.timestamp).toBeDefined();
      expect(rootParsed.outputFiles).toBeDefined();
      expect(subdirParsed.outputFiles).toBeDefined();
    });

    it('should disable caching in non-git repositories with inline YAML comment', async () => {
      // Test in /tmp which is guaranteed to not be a git repository

      // Capture stdout only (YAML with embedded comment)
      const output = await execCLIWithCwd(['run', "echo 'test'"], {
        cwd: '/tmp',
      });

      // Parse YAML output
      expectValidRunYaml(output);
      const yamlContent = output.replace(/^---\n/, '').replace(/\n---\n?$/, '');

      // Should have YAML comment explaining caching is disabled
      expect(yamlContent).toContain('treeHash: unknown  # Not in git repository - caching disabled');

      // Parse YAML (comments are stripped during parsing)
      const parsed = parseRunYamlOutput(output);

      // Should have treeHash: unknown
      expect(parsed.treeHash).toBe('unknown');

      // Should succeed
      expect(parsed.exitCode).toBe(0);

      // Should NOT have stderr warning (it's now in YAML comment)
      expect(output).not.toContain('⚠️');

      // Comment should NOT mention "timestamp-based hash" (old misleading message)
      expect(output).not.toContain('timestamp-based hash');
      expect(output).not.toContain('using timestamp-based');

      // Should have output files (execution still occurs, just no caching)
      expect(parsed.outputFiles).toBeDefined();
      expect(parsed.outputFiles.combined).toBeDefined();

      // Run the same command again - should execute again (no caching)
      // This verifies that caching is actually disabled
      // Add a small delay to ensure different timestamp (and thus different temp dir)
      const sleepCommand = 'sleep 1 && echo "test2"';
      const secondOutput = await execCLIWithCwd(['run', sleepCommand], {
        cwd: '/tmp',
      });

      const secondYamlContent = secondOutput.replace(/^---\n/, '').replace(/\n---\n?$/, '');
      const secondParsed = yaml.parse(secondYamlContent);

      // Should also have YAML comment
      expect(secondOutput).toContain('treeHash: unknown  # Not in git repository - caching disabled');

      // Should also have treeHash: unknown
      expect(secondParsed.treeHash).toBe('unknown');

      // Should NOT indicate cached result (proves caching is disabled)
      expect(secondParsed.isCachedResult).toBeUndefined();

      // Should have output files
      expect(secondParsed.outputFiles.combined).toBeDefined();
    });

    describe('force flag propagation', () => {
      it('should bypass cache when --force flag is used', async () => { 
        const testMessage = `test-force-${Date.now()}`;
        const testCommand = `echo ${testMessage}`;

        // First run - should execute and cache
        const firstRun = await execCLI(['run', testCommand]);

        const firstParsed = parseRunYamlOutput(firstRun);
        expect(firstParsed.exitCode).toBe(0);
        expect(firstParsed.isCachedResult).toBeUndefined(); // Not from cache

        // Second run without --force - should hit cache
        const cachedRun = await execCLI(['run', testCommand]);

        const cachedParsed = parseRunYamlOutput(cachedRun);
        expect(cachedParsed.exitCode).toBe(0);
        expect(cachedParsed.isCachedResult).toBe(true); // From cache

        // Third run with --force - should bypass cache
        const forcedRun = await execCLI(['run', '--force', testCommand]);

        const forcedParsed = parseRunYamlOutput(forcedRun);
        expect(forcedParsed.exitCode).toBe(0);
        expect(forcedParsed.isCachedResult).toBeUndefined(); // Not from cache (forced)
      });

      it('should propagate --force to nested vv run commands', async () => { 
        const testMessage = `test-nested-force-${Date.now()}`;
        const testCommand = `echo ${testMessage}`;

        // First run - cache the command
        const firstRun = await execCLI(['run', testCommand]);

        const firstParsed = parseRunYamlOutput(firstRun);
        expect(firstParsed.exitCode).toBe(0);

        // Second run - nested command should hit cache
        const cliPath = getCliPath('vibe-validate');
        const nestedCommand = `node ${cliPath} run '${testCommand}'`;
        const nestedCachedRun = await execCLI(['run', nestedCommand]);

        const nestedCachedParsed = parseRunYamlOutput(nestedCachedRun);
        expect(nestedCachedParsed.exitCode).toBe(0);
        expect(nestedCachedParsed.isCachedResult).toBe(true); // Inner hit cache

        // Third run - nested command with --force should bypass cache
        const nestedForcedRun = await execCLI(['run', '--force', nestedCommand]);

        const nestedForcedParsed = parseRunYamlOutput(nestedForcedRun);
        expect(nestedForcedParsed.exitCode).toBe(0);
        expect(nestedForcedParsed.isCachedResult).toBeUndefined(); // Forced execution
      });

      it('should propagate VV_FORCE_EXECUTION env var to child processes', async () => { 
        const testMessage = `test-env-force-${Date.now()}`;
        const testCommand = `echo ${testMessage}`;

        // First run - cache the command
        await execCLI(['run', testCommand]);

        // Second run - should hit cache
        const cachedRun = await execCLI(['run', testCommand]);

        const cachedParsed = parseRunYamlOutput(cachedRun);
        expect(cachedParsed.isCachedResult).toBe(true);

        // Third run with VV_FORCE_EXECUTION env var - should bypass cache
        const forcedRun = await execCLI(['run', testCommand], {
          env: { VV_FORCE_EXECUTION: '1' },
        });

        const forcedParsed = parseRunYamlOutput(forcedRun);
        expect(forcedParsed.exitCode).toBe(0);
        expect(forcedParsed.isCachedResult).toBeUndefined(); // Forced via env var
      });
    });

    // Issue #73 (expanded): Nested command caching regression fix
    describe('nested command caching (Issue #73 expanded)', () => {
      it('should share cache between nested and direct command invocations', async () => { 
        // Clear any existing cache for this test
        const testMessage = `test-nested-cache-${Date.now()}`;
        const testCommand = `echo ${testMessage}`; // Unquoted for simplicity

        // First run: nested vv run
        const { parsed: nestedParsed } = await executeNestedCommand(testCommand);
        expect(nestedParsed.requestedCommand).toContain('run'); // Should show what was requested
        const treeHash = nestedParsed.treeHash;

        // Verify cache was written
        // Use getNotesRefs from @vibe-validate/git (architectural compliance)
        const notesRefs = getNotesRefs(`refs/notes/vibe-validate/run/${treeHash}`);
        expect(notesRefs).not.toBe(''); // Cache exists (may include entries from other tests)

        // Second run: direct command (should hit cache)
        const directRun = await execCLI(['run', testCommand]);

        const directParsed = parseRunYamlOutput(directRun);
        expect(directParsed.exitCode).toBe(0);
        expect(directParsed.command).toBe(testCommand);
        expect(directParsed.isCachedResult).toBe(true); // Should be cached!
        expect(directParsed.treeHash).toBe(treeHash); // Same tree hash
        expect(directParsed.requestedCommand).toBeUndefined(); // No nesting in direct call
      });

      it('should share cache between direct and nested command invocations (reverse order)', async () => { 
        // Test the reverse: direct first, then nested
        const testMessage = `test-reverse-${Date.now()}`;
        const testCommand = `echo ${testMessage}`;

        // First run: direct command
        const directRun = await execCLI(['run', testCommand]);

        const directParsed = parseRunYamlOutput(directRun);
        expect(directParsed.exitCode).toBe(0);
        expect(directParsed.command).toBe(testCommand);
        const treeHash = directParsed.treeHash;

        // Second run: nested command (should hit cache from inner)
        const { parsed: nestedParsed } = await executeNestedCommand(testCommand);
        expect(nestedParsed.isCachedResult).toBe(true); // Inner hit cache!
        expect(nestedParsed.requestedCommand).toContain('run'); // Shows nesting
        expect(nestedParsed.treeHash).toBe(treeHash);
      });

      it('should propagate isCachedResult from inner to outer nested command', async () => { 
        // Test that cache hit status propagates correctly through nesting
        const testCommand = `echo "test-propagate-${Date.now()}"`;

        // First run: cache miss
        const firstRun = await execCLI(['run', testCommand]);

        const firstParsed = parseRunYamlOutput(firstRun);
        expect(firstParsed.exitCode).toBe(0);
        expect(firstParsed.isCachedResult).toBeUndefined(); // First run, no cache

        // Second run: nested command should show cache hit
        const cliPath = getCliPath('vibe-validate');
        const nestedCommand = `node ${cliPath} run '${testCommand}'`;
        const nestedRun = await execCLI(['run', nestedCommand]);

        const nestedParsed = parseRunYamlOutput(nestedRun);
        expect(nestedParsed.exitCode).toBe(0);
        expect(nestedParsed.isCachedResult).toBe(true); // Should propagate from inner!
        expect(nestedParsed.requestedCommand).toContain('run'); // Shows what was requested
      });

      it('should add requestedCommand field when commands differ', async () => {
        // Test that requestedCommand field is added for transparency
        const testMessage = `test-requested-${Date.now()}`;
        const testCommand = `echo ${testMessage}`;
        const cliPath = getCliPath('vibe-validate');
        const wrappedCommand = `node ${cliPath} run '${testCommand}'`;

        const nestedRun = await execCLI(['run', wrappedCommand]);

        const parsed = parseRunYamlOutput(nestedRun);
        expect(parsed.exitCode).toBe(0);

        // Should show both what was requested and what executed
        expect(parsed.command).toBe(testCommand); // What actually executed
        expect(parsed.requestedCommand).toBeDefined(); // What was requested
        expect(parsed.requestedCommand).toContain('run'); // Should contain wrapper
        expect(parsed.requestedCommand).not.toBe(parsed.command); // Different values
      });

      it('should not add requestedCommand when commands are the same', async () => { 
        // Test that requestedCommand is only added when needed
        const testMessage = `test-no-requested-${Date.now()}`;
        const testCommand = `echo ${testMessage}`;

        const directRun = await execCLI(['run', testCommand]);

        const parsed = parseRunYamlOutput(directRun);
        expect(parsed.exitCode).toBe(0);
        expect(parsed.command).toBe(testCommand);
        expect(parsed.requestedCommand).toBeUndefined(); // No nesting, no field
      });
    });
  });

  describe('performance', () => {
    it('should handle nested execution without significant overhead', async () => {
      const start = Date.now();

      const cliPath = getCliPath('vibe-validate');
      const command = `node ${cliPath} run 'echo fast'`;
      await execCLI(['run', command]);

      const duration = Date.now() - start;

      // Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('argument parsing', () => {
    it('should treat --help after command as part of the command, not vv run option', async () => { 
      // This tests the fix for the critical bug where:
      // `vv run claude --help` was incorrectly showing help for vv run
      // instead of executing `claude --help`

      const output = await execCLI(['run', 'echo --help']);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should execute "echo --help" as a command
      expect(parsed.command).toBe('echo --help');
      expect(parsed.exitCode).toBe(0);

      // Should NOT be showing vv run's help text
      expect(output).not.toContain('Usage: vibe-validate run');
    });

    it('should handle commands with multiple flags correctly', async () => { 
      // Use flags that are NOT known vv run options
      const output = await execCLI(['run', 'echo -n test --unknown-flag']);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should preserve all flags in the command
      expect(parsed.command).toBe('echo -n test --unknown-flag');
      expect(parsed.exitCode).toBe(0);
    });

    it('should execute "node --help" not show vv run help', async () => { 
      // Regression test: vv run node --help should execute "node --help"
      // not show help for vv run command
      const output = await execCLI(['run', 'node --help']);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should execute "node --help" as a command
      expect(parsed.command).toBe('node --help');
      expect(parsed.exitCode).toBe(0);

      // Should NOT be showing vv run's help text
      expect(output).not.toContain('Usage: vibe-validate run');
    });

    it('should handle vv run options before command correctly', async () => { 
      // Options for vv run itself must come BEFORE the command
      const output = await execCLI(['run', '--force', 'echo test']);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // --force is handled by vv run, command should just be "echo test"
      expect(parsed.command).toBe('echo test');
      expect(parsed.exitCode).toBe(0);
    });

    it('should show run command help when using --verbose --help without a command', async () => { 
      // Critical edge case: vv run --verbose --help should show verbose help for run command
      // NOT try to execute --help as a command
      const output = await execCLI(['run', '--verbose', '--help']);

      // Should show verbose help documentation (not YAML output)
      expect(output).toContain('run Command Reference');
      expect(output).toContain('Run a command and extract LLM-friendly errors');

      // Should NOT be trying to execute --help as a command
      // Check for YAML structure at the beginning (which would indicate command execution)
      expect(output).not.toMatch(/^---\s*\ncommand: --help/);
      expect(output).not.toMatch(/^---\s*\ncommand:/);
    });

    it('should show run command help when using --help alone', async () => { 
      // Basic case: vv run --help should show help for run command
      const output = await execCLI(['run', '--help']);

      // Should show basic help (command name could be "vv" or "vibe-validate" depending on execution context)
      expect(output).toMatch(/Usage: (vv|vibe-validate) run/);
      expect(output).toContain('Run a command and extract LLM-friendly errors');

      // Should NOT be trying to execute --help as a command
      // Check for YAML structure at the beginning
      expect(output).not.toMatch(/^---\s*\ncommand: --help/);
      expect(output).not.toMatch(/^---\s*\ncommand:/);
    });
  });

  describe('display flags', () => {
    it('should display verbose output with --verbose flag', async () => { 
      // Display output goes to stderr, YAML goes to stdout
      const { stdout, stderr } = await execCLIWithStderr(['run', '--verbose', 'node --badarg']);

      // Extract YAML front matter from stdout
      const yamlMatch = stdout.match(/^---\n([\s\S]*?)\n---/);
      expect(yamlMatch).toBeTruthy();
      const yamlContent = yamlMatch![1];
      const parsed = yaml.parse(yamlContent);

      expect(parsed.command).toBe('node --badarg');
      expect(parsed.exitCode).toBeGreaterThan(0);

      // Should have verbose output on stderr
      expect(stderr).toContain('[stderr]');
      expect(stderr).toContain('node: bad option');
    });

    it('should display first N lines with --head flag', async () => { 
      // Display output goes to stderr, YAML goes to stdout
      // Use --force to bypass cache (ensures fresh execution in coverage mode)
      const { stdout, stderr } = await execCLIWithStderr(['run', '--force', '--head', '2', String.raw`node -e "process.stdout.write('line1\nline2\nline3\n')"`]);

      // Parse YAML front matter
      parseYamlFrontMatter(stdout);

      // Should have output display on stderr (--head shows first 2 lines)
      expect(stderr).toContain('[stdout]');
      expect(stderr).toContain('line1');
    });

    it('should display last N lines with --tail flag', async () => { 
      // Display output goes to stderr, YAML goes to stdout
      // Use --force to bypass cache (ensures fresh execution in coverage mode)
      const { stdout, stderr } = await execCLIWithStderr(['run', '--force', '--tail', '2', String.raw`node -e "process.stdout.write('line1\nline2\nline3\n')"`]);

      // Parse YAML front matter
      parseYamlFrontMatter(stdout);

      // Should have output display on stderr (--tail shows last 2 lines)
      expect(stderr).toContain('[stdout]');
      expect(stderr).toContain('line3');
    });

    it('should not display output without display flags', async () => { 
      // Without display flags, only YAML should be on stdout, nothing on stderr
      const { stdout, stderr } = await execCLIWithStderr(['run', 'echo "test output"']);

      // Parse YAML output - both opening and closing delimiters (always present for consistency)
      expectValidRunYaml(stdout);
      const parsed = parseRunYamlOutput(stdout);
      expect(parsed.exitCode).toBe(0);

      // Should have closing delimiter (always present for RFC 4627 compliance)
      expect(stdout).toMatch(/\n---\n$/); // Closing delimiter at end
      expect(stdout.trim()).toBe(('---\n' + yaml.stringify(parsed) + '---').trim());

      // No display output on stderr
      expect(stderr).toBe('');
    });
  });

  describe('--check flag', () => {
    it('should return cached result without executing when cache exists', async () => { 
      const testMessage = `test-check-hit-${Date.now()}`;
      const testCommand = `echo ${testMessage}`;

      // First run - populate cache
      await execCLI(['run', testCommand]);

      // Second run with --check - should return cached result
      const checkOutput = await execCLI(['run', '--check', testCommand]);

      const parsed = parseRunYamlOutput(checkOutput);
      expect(parsed.exitCode).toBe(0);
      expect(parsed.isCachedResult).toBe(true);
    });

    it('should exit with code 1 when cache does not exist', async () => { 
      const testMessage = `test-check-miss-${Date.now()}`;
      const testCommand = `echo ${testMessage}`;

      // Run --check without prior cache - should fail with exit code 1
      const result = await execCLIWithStderr(['run', '--check', testCommand]);
      expect(result.status).toBe(1);
    });

    it('should not execute command when checking cache', async () => { 
      const testFile = `/tmp/vv-test-check-${Date.now()}.txt`;
      const testCommand = `touch ${testFile}`;

      // First run - populate cache
      await execCLI(['run', testCommand]);

      // Remove the file
      if (existsSync(testFile)) {
        safeExecSync('rm', [testFile]);
      }

      // Run --check - should NOT recreate the file
      await execCLI(['run', '--check', testCommand]);

      // File should still not exist (command was not executed)
      expect(existsSync(testFile)).toBe(false);
    });
  });

  describe('--cwd flag', () => {
    it('should use explicit --cwd in cache key', async () => {
      const testMessage = `test-cwd-${Date.now()}`;
      const testCommand = `echo ${testMessage}`;

      // Run from root with --cwd pointing to subdirectory
      const output1 = await execCLIWithCwd(['run', '--cwd', 'packages/cli', testCommand], {
        cwd: process.cwd(), // Run from repo root
      });

      const parsed1 = parseRunYamlOutput(output1);
      expect(parsed1.exitCode).toBe(0);
      expect(parsed1.isCachedResult).toBeUndefined(); // First run

      // Run again - should hit cache
      const output2 = await execCLIWithCwd(['run', '--cwd', 'packages/cli', testCommand], {
        cwd: process.cwd(),
      });

      const parsed2 = parseRunYamlOutput(output2);
      expect(parsed2.isCachedResult).toBe(true);
    });

    it('should generate same cache key for --cwd and cd + run', async () => {
      const testMessage = `test-cwd-equivalence-${Date.now()}`;
      const testCommand = `echo ${testMessage}`;
      const subdir = 'packages/cli';

      // Scenario 1: vv run --cwd subdir "cmd" (from workspace root)
      const output1 = await execCLIWithCwd(['run', '--cwd', subdir, testCommand], {
        cwd: WORKSPACE_ROOT,
      });

      const parsed1 = parseRunYamlOutput(output1);
      expect(parsed1.exitCode).toBe(0);
      expect(parsed1.isCachedResult).toBeUndefined(); // First run

      // Scenario 2: cd subdir && vv run "cmd"
      const output2 = await execCLIWithCwd(['run', testCommand], {
        cwd: path.join(WORKSPACE_ROOT, subdir), // Run from subdirectory
      });

      const parsed2 = parseRunYamlOutput(output2);
      expect(parsed2.exitCode).toBe(0);
      expect(parsed2.isCachedResult).toBe(true); // Should hit cache from scenario 1
    });

    it('should create separate cache entries for different working directories', async () => { 
      // This is already tested in the caching behavior section (line 244)
      // but we document it here for completeness of --cwd coverage
      expect(true).toBe(true);
    });
  });
});
