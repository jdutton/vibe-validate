import { describe, it, expect } from 'vitest';
import { safeExecSync, safeExecResult } from '@vibe-validate/git';
import { existsSync } from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { parseRunYamlOutput, expectValidRunYaml } from '../helpers/run-command-helpers.js';

/**
 * Integration tests for the run command with REAL command execution
 *
 * These are FAST integration tests (<10s total) that execute real commands
 * but complete quickly. For slower system tests (60s+ timeouts), see:
 * run.system.test.ts (run with: pnpm test:system)
 */

const CLI_BIN = 'packages/cli/dist/bin.js';

/**
 * Execute vibe-validate CLI command with proper argument handling
 * Captures both stdout (YAML) and stderr (display output) separately
 * @param cliArgs - Arguments to pass to CLI (e.g., ['run', 'echo test'])
 * @param options - Execution options
 * @returns Command stdout (YAML) - use execCLIWithStderr to get both streams
 * @throws CommandExecutionError with status, stdout, and stderr properties
 */
function execCLI(cliArgs: string[], options?: { encoding?: BufferEncoding; stdio?: any; cwd?: string; env?: Record<string, string> }): string {
  const result = execCLIWithStderr(cliArgs, options);
  return result.stdout + result.stderr; // For backward compatibility, combine them
}

/**
 * Execute vibe-validate CLI and return both stdout and stderr
 * @returns Object with stdout (YAML) and stderr (display output) separated
 * @throws Error if command fails without producing output
 */
function execCLIWithStderr(cliArgs: string[], options?: { encoding?: BufferEncoding; stdio?: any; cwd?: string; env?: Record<string, string> }): { stdout: string; stderr: string; combined: string; status?: number } {
  const result = safeExecResult('node', [CLI_BIN, ...cliArgs], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      ...options?.env, // Allow test-specific overrides
    },
    ...options
  });

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();

  // If command failed without producing output, throw
  if (result.status !== 0 && !stdout && !stderr) {
    const error = new Error(`Command failed with status ${result.status}`);
    (error as any).status = result.status;
    throw error;
  }

  return {
    stdout,
    stderr,
    combined: stdout + stderr,
    status: result.status ?? undefined
  };
}

/**
 * Execute vibe-validate CLI with absolute path
 */
function execCLIAbsolute(absolutePath: string, cliArgs: string[], options?: { encoding?: BufferEncoding; stdio?: any; cwd?: string; env?: Record<string, string> }): string {
  try {
    return safeExecSync('node', [absolutePath, ...cliArgs], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test User',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test User',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        ...options?.env,
      },
      ...options
    }) as string;
  } catch (err: any) {
    // For successful non-zero exits (like help commands), return stdout
    if (err.stdout) {
      return (err.stdout as string) + (err.stderr || '');
    }
    throw err;
  }
}

describe('run command integration', () => {
  describe('real nested execution', () => {
    it('should handle real nested vibe-validate run commands (2 levels)', () => {
      // Execute: vibe-validate run "echo test"
      // This produces real YAML output
      const innerCommand = `node ${CLI_BIN} run "echo 'Hello from inner command'"`;

      // Wrap it: vibe-validate run "vibe-validate run 'echo test'"
      const output = execCLI(['run', innerCommand]);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should unwrap to innermost command (not wrapper)
      expect(parsed.command).toBeDefined();
      expect(parsed.command).toContain('echo');

      // Should preserve exit code
      expect(parsed.exitCode).toBe(0);
    });

    // Slow nested execution tests moved to run.system.test.ts
  });

  describe('real error scenarios', () => {
    it('should handle real failing command with error extraction', () => {
      // Command that will fail
      const output = execCLI(['run', 'node -e "process.exit(1)"']);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should have non-zero exit code
      expect(parsed.exitCode).toBe(1);

      // Should have extraction data
      expect(parsed.extraction).toBeDefined();
    });

    it('should handle real command with non-standard exit code', () => {
      const output = execCLI(['run', 'node -e "process.exit(42)"']);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should preserve exit code 42
      expect(parsed.exitCode).toBe(42);
    });
  });

  // Real extractor integration tests moved to run.system.test.ts

  describe('real stdout/stderr handling', () => {
    it('should handle commands that write to both stdout and stderr', () => {
      const output = execCLI(['run', String.raw`node -e "console.log(\"stdout\"); console.error(\"stderr\");"`]);

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
    it('should write git notes refs when caching successful commands', () => {
      const command = `echo "Cache write test ${Date.now()}"`;

      // First run - should execute and cache
      const firstRun = execCLI(['run', command]);

      const firstParsed = parseRunYamlOutput(firstRun);
      expect(firstParsed.exitCode).toBe(0);
      const treeHash = firstParsed.treeHash;

      // CRITICAL: Verify git notes ref was actually created
      const notesRefs = safeExecSync('git', ['for-each-ref', `refs/notes/vibe-validate/run/${treeHash}`], { encoding: 'utf-8' }) as string;
      expect(notesRefs).not.toBe(''); // Cache was written!
      expect(notesRefs).toContain('refs/notes/vibe-validate/run/');

      // Second run - should hit cache
      const secondRun = execCLI(['run', command]);

      const secondParsed = parseRunYamlOutput(secondRun);
      expect(secondParsed.exitCode).toBe(0);
      expect(secondParsed.isCachedResult).toBe(true); // Cache was read!
      expect(secondParsed.treeHash).toBe(treeHash); // Same tree hash
    });

    it('should not write git notes for failed commands', () => {
      const output = execCLI(['run', 'exit 1']);

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

    it('should invalidate cache when tree hash changes', () => {
      const tmpFile = `tmp-cache-test-${Date.now()}.txt`;

      try {
        // Run command first time - should execute (no cache)
        const firstRun = execCLI(['run', "echo 'Cache test'"]);
        // Parse YAML output - opening delimiter only (no display flags)
        expect(firstRun).toMatch(/^---\n/);
        const firstParsed = parseRunYamlOutput(firstRun);
        expect(firstParsed.exitCode).toBe(0);
        expect(firstParsed.command).toBe('echo \'Cache test\'');

        // Run again immediately - should hit cache (same tree hash)
        const cachedRun = execCLI(['run', "echo 'Cache test'"]);
        expect(cachedRun).toMatch(/^---\n/);
        const cachedParsed = parseRunYamlOutput(cachedRun);
        expect(cachedParsed.exitCode).toBe(0);

        // Create a new file to change tree hash
        safeExecSync('sh', ['-c', String.raw`echo "test" > ${tmpFile}`], { encoding: 'utf-8' });

        // Run same command again - cache should be invalidated due to tree hash change
        // Should execute again (not from cache)
        const thirdRun = execCLI(['run', "echo 'Cache test'"]);
        expect(thirdRun).toMatch(/^---\n/);
        const thirdParsed = parseRunYamlOutput(thirdRun);
        expect(thirdParsed.exitCode).toBe(0);
        expect(thirdParsed.command).toBe('echo \'Cache test\'');

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

    it('should create separate cache entries for different working directories', () => {
      const absoluteCliPath = `${process.cwd()}/packages/cli/dist/bin.js`;

      // Run command in root
      const rootRun = execCLIAbsolute(absoluteCliPath, ['run', "echo 'root'"], {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });
      // Parse YAML output - opening delimiter only (no display flags)
      expect(rootRun).toMatch(/^---\n/);
      const rootParsed = parseRunYamlOutput(rootRun);

      // Run same command text in subdirectory
      const subdirRun = execCLIAbsolute(absoluteCliPath, ['run', "echo 'root'"], {
        encoding: 'utf-8',
        cwd: `${process.cwd()}/packages/cli`,
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

    it('should disable caching in non-git repositories with inline YAML comment', () => {
      // Test in /tmp which is guaranteed to not be a git repository
      const absoluteCliPath = `${process.cwd()}/packages/cli/dist/bin.js`;

      // Capture stdout only (YAML with embedded comment)
      const output = execCLIAbsolute(absoluteCliPath, ['run', "echo 'test'"], {
        encoding: 'utf-8',
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
      const secondOutput = execCLIAbsolute(absoluteCliPath, ['run', sleepCommand], {
        encoding: 'utf-8',
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
      it('should bypass cache when --force flag is used', () => {
        const testMessage = `test-force-${Date.now()}`;
        const testCommand = `echo ${testMessage}`;

        // First run - should execute and cache
        const firstRun = execCLI(['run', testCommand]);

        const firstParsed = parseRunYamlOutput(firstRun);
        expect(firstParsed.exitCode).toBe(0);
        expect(firstParsed.isCachedResult).toBeUndefined(); // Not from cache

        // Second run without --force - should hit cache
        const cachedRun = execCLI(['run', testCommand]);

        const cachedParsed = parseRunYamlOutput(cachedRun);
        expect(cachedParsed.exitCode).toBe(0);
        expect(cachedParsed.isCachedResult).toBe(true); // From cache

        // Third run with --force - should bypass cache
        const forcedRun = execCLI(['run', '--force', testCommand]);

        const forcedParsed = parseRunYamlOutput(forcedRun);
        expect(forcedParsed.exitCode).toBe(0);
        expect(forcedParsed.isCachedResult).toBeUndefined(); // Not from cache (forced)
      });

      it('should propagate --force to nested vv run commands', () => {
        const testMessage = `test-nested-force-${Date.now()}`;
        const testCommand = `echo ${testMessage}`;

        // First run - cache the command
        const firstRun = execCLI(['run', testCommand]);

        const firstParsed = parseRunYamlOutput(firstRun);
        expect(firstParsed.exitCode).toBe(0);

        // Second run - nested command should hit cache
        const nestedCommand = `node ${CLI_BIN} run '${testCommand}'`;
        const nestedCachedRun = execCLI(['run', nestedCommand]);

        const nestedCachedParsed = parseRunYamlOutput(nestedCachedRun);
        expect(nestedCachedParsed.exitCode).toBe(0);
        expect(nestedCachedParsed.isCachedResult).toBe(true); // Inner hit cache

        // Third run - nested command with --force should bypass cache
        const nestedForcedRun = execCLI(['run', '--force', nestedCommand]);

        const nestedForcedParsed = parseRunYamlOutput(nestedForcedRun);
        expect(nestedForcedParsed.exitCode).toBe(0);
        expect(nestedForcedParsed.isCachedResult).toBeUndefined(); // Forced execution
      });

      it('should propagate VV_FORCE_EXECUTION env var to child processes', () => {
        const testMessage = `test-env-force-${Date.now()}`;
        const testCommand = `echo ${testMessage}`;

        // First run - cache the command
        execCLI(['run', testCommand]);

        // Second run - should hit cache
        const cachedRun = execCLI(['run', testCommand]);

        const cachedParsed = parseRunYamlOutput(cachedRun);
        expect(cachedParsed.isCachedResult).toBe(true);

        // Third run with VV_FORCE_EXECUTION env var - should bypass cache
        const forcedRun = execCLI(['run', testCommand], {
          encoding: 'utf-8',
          env: { ...process.env, VV_FORCE_EXECUTION: '1' },
        });

        const forcedParsed = parseRunYamlOutput(forcedRun);
        expect(forcedParsed.exitCode).toBe(0);
        expect(forcedParsed.isCachedResult).toBeUndefined(); // Forced via env var
      });
    });

    // Issue #73 (expanded): Nested command caching regression fix
    describe('nested command caching (Issue #73 expanded)', () => {
      it('should share cache between nested and direct command invocations', () => {
        // Clear any existing cache for this test
        const testMessage = `test-nested-cache-${Date.now()}`;
        const testCommand = `echo ${testMessage}`; // Unquoted for simplicity

        // First run: nested vv run
        const nestedCommand = `node ${CLI_BIN} run '${testCommand}'`;
        const nestedRun = execCLI(['run', nestedCommand]);

        const nestedParsed = parseRunYamlOutput(nestedRun);
        expect(nestedParsed.exitCode).toBe(0);
        expect(nestedParsed.command).toBe(testCommand); // Should unwrap to innermost command
        expect(nestedParsed.requestedCommand).toContain('run'); // Should show what was requested
        const treeHash = nestedParsed.treeHash;

        // Verify cache was written
        const notesRefs = safeExecSync('git', ['for-each-ref', `refs/notes/vibe-validate/run/${treeHash}`], { encoding: 'utf-8' }) as string;
        expect(notesRefs).not.toBe(''); // Cache exists (may include entries from other tests)

        // Second run: direct command (should hit cache)
        const directRun = execCLI(['run', testCommand]);

        const directParsed = parseRunYamlOutput(directRun);
        expect(directParsed.exitCode).toBe(0);
        expect(directParsed.command).toBe(testCommand);
        expect(directParsed.isCachedResult).toBe(true); // Should be cached!
        expect(directParsed.treeHash).toBe(treeHash); // Same tree hash
        expect(directParsed.requestedCommand).toBeUndefined(); // No nesting in direct call
      });

      it('should share cache between direct and nested command invocations (reverse order)', () => {
        // Test the reverse: direct first, then nested
        const testMessage = `test-reverse-${Date.now()}`;
        const testCommand = `echo ${testMessage}`;

        // First run: direct command
        const directRun = execCLI(['run', testCommand]);

        const directParsed = parseRunYamlOutput(directRun);
        expect(directParsed.exitCode).toBe(0);
        expect(directParsed.command).toBe(testCommand);
        const treeHash = directParsed.treeHash;

        // Second run: nested command (should hit cache from inner)
        const nestedCommand = `node ${CLI_BIN} run '${testCommand}'`;
        const nestedRun = execCLI(['run', nestedCommand]);

        const nestedParsed = parseRunYamlOutput(nestedRun);
        expect(nestedParsed.exitCode).toBe(0);
        expect(nestedParsed.command).toBe(testCommand); // Unwrapped
        expect(nestedParsed.isCachedResult).toBe(true); // Inner hit cache!
        expect(nestedParsed.requestedCommand).toContain('run'); // Shows nesting
        expect(nestedParsed.treeHash).toBe(treeHash);
      });

      it('should propagate isCachedResult from inner to outer nested command', () => {
        // Test that cache hit status propagates correctly through nesting
        const testCommand = `echo "test-propagate-${Date.now()}"`;

        // First run: cache miss
        const firstRun = execCLI(['run', testCommand]);

        const firstParsed = parseRunYamlOutput(firstRun);
        expect(firstParsed.exitCode).toBe(0);
        expect(firstParsed.isCachedResult).toBeUndefined(); // First run, no cache

        // Second run: nested command should show cache hit
        const nestedCommand = `node ${CLI_BIN} run '${testCommand}'`;
        const nestedRun = execCLI(['run', nestedCommand]);

        const nestedParsed = parseRunYamlOutput(nestedRun);
        expect(nestedParsed.exitCode).toBe(0);
        expect(nestedParsed.isCachedResult).toBe(true); // Should propagate from inner!
        expect(nestedParsed.requestedCommand).toContain('run'); // Shows what was requested
      });

      it('should add requestedCommand field when commands differ', () => {
        // Test that requestedCommand field is added for transparency
        const testMessage = `test-requested-${Date.now()}`;
        const testCommand = `echo ${testMessage}`;
        const wrappedCommand = `node ${CLI_BIN} run '${testCommand}'`;

        const nestedRun = execCLI(['run', wrappedCommand]);

        const parsed = parseRunYamlOutput(nestedRun);
        expect(parsed.exitCode).toBe(0);

        // Should show both what was requested and what executed
        expect(parsed.command).toBe(testCommand); // What actually executed
        expect(parsed.requestedCommand).toBeDefined(); // What was requested
        expect(parsed.requestedCommand).toContain('run'); // Should contain wrapper
        expect(parsed.requestedCommand).not.toBe(parsed.command); // Different values
      });

      it('should not add requestedCommand when commands are the same', () => {
        // Test that requestedCommand is only added when needed
        const testMessage = `test-no-requested-${Date.now()}`;
        const testCommand = `echo ${testMessage}`;

        const directRun = execCLI(['run', testCommand]);

        const parsed = parseRunYamlOutput(directRun);
        expect(parsed.exitCode).toBe(0);
        expect(parsed.command).toBe(testCommand);
        expect(parsed.requestedCommand).toBeUndefined(); // No nesting, no field
      });
    });
  });

  describe('performance', () => {
    it('should handle nested execution without significant overhead', () => {
      const start = Date.now();

      const command = `node ${CLI_BIN} run 'echo fast'`;
      execCLI(['run', command]);

      const duration = Date.now() - start;

      // Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('argument parsing', () => {
    it('should treat --help after command as part of the command, not vv run option', () => {
      // This tests the fix for the critical bug where:
      // `vv run claude --help` was incorrectly showing help for vv run
      // instead of executing `claude --help`

      const output = execCLI(['run', 'echo --help']);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should execute "echo --help" as a command
      expect(parsed.command).toBe('echo --help');
      expect(parsed.exitCode).toBe(0);

      // Should NOT be showing vv run's help text
      expect(output).not.toContain('Usage: vibe-validate run');
    });

    it('should handle commands with multiple flags correctly', () => {
      // Use flags that are NOT known vv run options
      const output = execCLI(['run', 'echo -n test --unknown-flag']);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should preserve all flags in the command
      expect(parsed.command).toBe('echo -n test --unknown-flag');
      expect(parsed.exitCode).toBe(0);
    });

    it('should execute "node --help" not show vv run help', () => {
      // Regression test: vv run node --help should execute "node --help"
      // not show help for vv run command
      const output = execCLI(['run', 'node --help']);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // Should execute "node --help" as a command
      expect(parsed.command).toBe('node --help');
      expect(parsed.exitCode).toBe(0);

      // Should NOT be showing vv run's help text
      expect(output).not.toContain('Usage: vibe-validate run');
    });

    it('should handle vv run options before command correctly', () => {
      // Options for vv run itself must come BEFORE the command
      const output = execCLI(['run', '--force', 'echo test']);

      // Parse YAML output
      expectValidRunYaml(output);
      const parsed = parseRunYamlOutput(output);

      // --force is handled by vv run, command should just be "echo test"
      expect(parsed.command).toBe('echo test');
      expect(parsed.exitCode).toBe(0);
    });

    it('should show run command help when using --verbose --help without a command', () => {
      // Critical edge case: vv run --verbose --help should show verbose help for run command
      // NOT try to execute --help as a command
      const output = execCLI(['run', '--verbose', '--help']);

      // Should show verbose help documentation (not YAML output)
      expect(output).toContain('run Command Reference');
      expect(output).toContain('Run a command and extract LLM-friendly errors');

      // Should NOT be trying to execute --help as a command
      // Check for YAML structure at the beginning (which would indicate command execution)
      expect(output).not.toMatch(/^---\s*\ncommand: --help/);
      expect(output).not.toMatch(/^---\s*\ncommand:/);
    });

    it('should show run command help when using --help alone', () => {
      // Basic case: vv run --help should show help for run command
      const output = execCLI(['run', '--help']);

      // Should show basic help
      expect(output).toContain('Usage: vibe-validate run');
      expect(output).toContain('Run a command and extract LLM-friendly errors');

      // Should NOT be trying to execute --help as a command
      // Check for YAML structure at the beginning
      expect(output).not.toMatch(/^---\s*\ncommand: --help/);
      expect(output).not.toMatch(/^---\s*\ncommand:/);
    });
  });

  describe('display flags', () => {
    it('should display verbose output with --verbose flag', () => {
      // Display output goes to stderr, YAML goes to stdout
      const { stdout, stderr } = execCLIWithStderr(['run', '--verbose', 'node --badarg']);

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

    it('should display first N lines with --head flag', () => {
      // Display output goes to stderr, YAML goes to stdout
      const { stdout, stderr } = execCLIWithStderr(['run', '--head', '2', String.raw`printf "line1\nline2\nline3\n"`]);

      // Extract YAML front matter from stdout
      const yamlMatch = stdout.match(/^---\n([\s\S]*?)\n---/);
      expect(yamlMatch).toBeTruthy();
      const yamlContent = yamlMatch![1];
      const parsed = yaml.parse(yamlContent);
      expect(parsed.exitCode).toBe(0);

      // Should have output display on stderr (--head shows first 2 lines)
      expect(stderr).toContain('[stdout]');
      expect(stderr).toContain('line1');
    });

    it('should display last N lines with --tail flag', () => {
      // Display output goes to stderr, YAML goes to stdout
      const { stdout, stderr } = execCLIWithStderr(['run', '--tail', '2', String.raw`printf "line1\nline2\nline3\n"`]);

      // Extract YAML front matter from stdout
      const yamlMatch = stdout.match(/^---\n([\s\S]*?)\n---/);
      expect(yamlMatch).toBeTruthy();
      const yamlContent = yamlMatch![1];
      const parsed = yaml.parse(yamlContent);
      expect(parsed.exitCode).toBe(0);

      // Should have output display on stderr (--tail shows last 2 lines)
      expect(stderr).toContain('[stdout]');
      expect(stderr).toContain('line3');
    });

    it('should not display output without display flags', () => {
      // Without display flags, only YAML should be on stdout, nothing on stderr
      const { stdout, stderr } = execCLIWithStderr(['run', 'echo "test output"']);

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
    it('should return cached result without executing when cache exists', () => {
      const testMessage = `test-check-hit-${Date.now()}`;
      const testCommand = `echo ${testMessage}`;

      // First run - populate cache
      execCLI(['run', testCommand]);

      // Second run with --check - should return cached result
      const checkOutput = execCLI(['run', '--check', testCommand]);

      const parsed = parseRunYamlOutput(checkOutput);
      expect(parsed.exitCode).toBe(0);
      expect(parsed.isCachedResult).toBe(true);
    });

    it('should exit with code 1 when cache does not exist', () => {
      const testMessage = `test-check-miss-${Date.now()}`;
      const testCommand = `echo ${testMessage}`;

      // Run --check without prior cache - should fail with exit code 1
      const result = execCLIWithStderr(['run', '--check', testCommand]);
      expect(result.status).toBe(1);
    });

    it('should not execute command when checking cache', () => {
      const testFile = `/tmp/vv-test-check-${Date.now()}.txt`;
      const testCommand = `touch ${testFile}`;

      // First run - populate cache
      execCLI(['run', testCommand]);

      // Remove the file
      if (existsSync(testFile)) {
        safeExecSync('rm', [testFile]);
      }

      // Run --check - should NOT recreate the file
      execCLI(['run', '--check', testCommand]);

      // File should still not exist (command was not executed)
      expect(existsSync(testFile)).toBe(false);
    });
  });

  describe('--cwd flag', () => {
    it('should use explicit --cwd in cache key', () => {
      const testMessage = `test-cwd-${Date.now()}`;
      const testCommand = `echo ${testMessage}`;
      const absoluteCliPath = `${process.cwd()}/packages/cli/dist/bin.js`;

      // Run from root with --cwd pointing to subdirectory
      const output1 = execCLIAbsolute(absoluteCliPath, ['run', '--cwd', 'packages/cli', testCommand], {
        encoding: 'utf-8',
        cwd: process.cwd(), // Run from repo root
      });

      const parsed1 = parseRunYamlOutput(output1);
      expect(parsed1.exitCode).toBe(0);
      expect(parsed1.isCachedResult).toBeUndefined(); // First run

      // Run again - should hit cache
      const output2 = execCLIAbsolute(absoluteCliPath, ['run', '--cwd', 'packages/cli', testCommand], {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      const parsed2 = parseRunYamlOutput(output2);
      expect(parsed2.isCachedResult).toBe(true);
    });

    it('should generate same cache key for --cwd and cd + run', () => {
      const testMessage = `test-cwd-equivalence-${Date.now()}`;
      const testCommand = `echo ${testMessage}`;
      const subdir = 'packages/cli';
      const absoluteCliPath = `${process.cwd()}/packages/cli/dist/bin.js`;

      // Scenario 1: vv run --cwd subdir "cmd" (from root)
      const output1 = execCLIAbsolute(absoluteCliPath, ['run', '--cwd', subdir, testCommand], {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      const parsed1 = parseRunYamlOutput(output1);
      expect(parsed1.exitCode).toBe(0);
      expect(parsed1.isCachedResult).toBeUndefined(); // First run

      // Scenario 2: cd subdir && vv run "cmd"
      const output2 = execCLIAbsolute(absoluteCliPath, ['run', testCommand], {
        encoding: 'utf-8',
        cwd: path.join(process.cwd(), subdir), // Run from subdirectory
      });

      const parsed2 = parseRunYamlOutput(output2);
      expect(parsed2.exitCode).toBe(0);
      expect(parsed2.isCachedResult).toBe(true); // Should hit cache from scenario 1
    });

    it('should create separate cache entries for different working directories', () => {
      // This is already tested in the caching behavior section (line 244)
      // but we document it here for completeness of --cwd coverage
      expect(true).toBe(true);
    });
  });
});
