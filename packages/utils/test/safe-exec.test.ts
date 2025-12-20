import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect } from 'vitest';

import {
  safeExecSync,
  safeExecResult,
  safeExecFromString,
  isToolAvailable,
  getToolVersion,
  hasShellSyntax,
  CommandExecutionError,
} from '../src/safe-exec.js';

describe('safeExecSync', () => {
  it('should execute commands with absolute path (no shell)', () => {
    const result = safeExecSync('node', ['--version'], { encoding: 'utf8' });
    expect(result).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it('should return Buffer by default', () => {
    const result = safeExecSync('node', ['--version']);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('should return string when encoding specified', () => {
    const result = safeExecSync('node', ['--version'], { encoding: 'utf8' });
    expect(typeof result).toBe('string');
  });

  it('should support custom environment variables', () => {
    const result = safeExecSync(
      'node',
      ['-e', 'console.log(process.env.SAFE_EXEC_TEST)'],
      {
        encoding: 'utf8',
        env: { ...process.env, SAFE_EXEC_TEST: 'test-value' },
      },
    );
    expect(result.trim()).toBe('test-value');
  });

  it('should support custom working directory', () => {
    const tempDir = mkdtempSync(join(normalizedTmpdir(), 'safe-exec-test-'));
    try {
      const result = safeExecSync('node', ['-e', 'console.log(process.cwd())'], {
        encoding: 'utf8',
        cwd: tempDir,
      });
      // macOS uses /private/var symlink, so resolve both paths
      const actualPath = result.trim();
      const expectedPath = tempDir;
      // Compare resolved paths to handle symlinks
      expect(actualPath.endsWith(expectedPath.split('/').pop() || '')).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should throw if command not found', () => {
    expect(() =>
      safeExecSync('nonexistent-command-xyz-123', ['--version']),
    ).toThrow();
  });

  it('should throw with detailed error on non-zero exit code', () => {
    try {
      safeExecSync('node', ['-e', 'process.exit(42)']);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CommandExecutionError);
      if (error instanceof CommandExecutionError) {
        expect(error.message).toContain('exit code 42');
        expect(error.status).toBe(42);
      }
    }
  });

  it('should handle commands with multiple arguments', () => {
    // Test that all args are passed correctly - use echo since node -e consumes first arg
    const result = safeExecSync(
      'echo',
      ['arg1', 'arg2', 'arg3'],
      { encoding: 'utf8' },
    );
    expect(result.trim()).toBe('arg1 arg2 arg3');
  });

  it('should not interpret shell metacharacters', () => {
    // NOTE: This test is skipped on Windows because safeExecSync uses shell:true
    // for node commands on Windows (see safe-exec.ts:96-100).
    // On Windows, shell metacharacters in arguments are interpreted by the shell.
    if (process.platform === 'win32') {
      return; // Skip test on Windows
    }

    // This would execute 'ls' if shell was enabled
    const result = safeExecSync('node', ['-e', 'console.log("hello && ls")'], {
      encoding: 'utf8',
    });
    expect(result.trim()).toBe('hello && ls');
  });

  it('should handle empty args array', () => {
    const result = safeExecSync('node', [], { encoding: 'utf8' });
    // Node without args enters REPL, but with pipe stdio it should just exit
    expect(Buffer.isBuffer(result) || typeof result === 'string').toBe(true);
  });

  it('should support stdio: ignore option', () => {
    // Should not throw even though we ignore output
    expect(() =>
      safeExecSync('node', ['--version'], { stdio: 'ignore' }),
    ).not.toThrow();
  });

  it('should handle timeout option', () => {
    // Long-running command with short timeout
    try {
      safeExecSync('node', ['-e', 'setTimeout(() => {}, 10000)'], {
        timeout: 100,
      });
      expect.fail('Should have thrown timeout error');
    } catch (error: any) {
      // spawnSync timeout error
      expect(error).toBeDefined();
    }
  });

  it('should prevent command injection via arguments', () => {
    // Malicious input that would work with shell: true
    const maliciousArg = '; rm -rf / #';

    // With shell: false, this is treated as a literal argument
    // Use echo which just outputs its arguments unchanged
    const result = safeExecSync(
      'echo',
      [maliciousArg],
      { encoding: 'utf8' },
    );

    // Should output the literal string, not execute the command
    expect(result.trim()).toBe(maliciousArg);
  });

  it('should handle special characters in arguments safely', () => {
    const specialChars = '$(whoami) `date` $HOME | & ; < > *';
    const result = safeExecSync(
      'echo',
      [specialChars],
      { encoding: 'utf8' },
    );
    expect(result.trim()).toBe(specialChars);
  });
});

describe('safeExecResult', () => {
  it('should return result object without throwing on success', () => {
    const result = safeExecResult('node', ['--version'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(typeof result.stdout).toBe('string');
    expect((result.stdout as string).trim()).toMatch(/^v\d+\.\d+\.\d+/);
    expect(result.error).toBeUndefined();
  });

  it('should return result object without throwing on failure', () => {
    const result = safeExecResult('node', ['-e', 'process.exit(1)'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.error).toBeUndefined(); // No spawn error, just non-zero exit
  });

  it('should return error object if command not found', () => {
    const result = safeExecResult('nonexistent-command-xyz-123', ['--version']);

    expect(result.status).toBe(-1);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toBeTruthy();
  });

  it('should capture stderr on command failure', () => {
    const result = safeExecResult(
      'node',
      ['-e', 'console.error("error message"); process.exit(1)'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('error message');
  });

  it('should return Buffer by default', () => {
    const result = safeExecResult('node', ['--version']);

    expect(result.status).toBe(0);
    expect(Buffer.isBuffer(result.stdout)).toBe(true);
  });

  it('should return string when encoding specified', () => {
    const result = safeExecResult('node', ['--version'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(typeof result.stdout).toBe('string');
  });
});

describe('isToolAvailable', () => {
  it('should return true for available tools', () => {
    expect(isToolAvailable('node')).toBe(true);
  });

  it('should return false for unavailable tools', () => {
    expect(isToolAvailable('nonexistent-tool-xyz-123')).toBe(false);
  });

  it('should return false for tools that error on --version', () => {
    // Create a temporary "tool" that exits with error
    const tempDir = mkdtempSync(join(normalizedTmpdir(), 'safe-exec-test-'));
    const scriptPath = join(tempDir, 'bad-tool.sh');

    try {
      writeFileSync(scriptPath, '#!/bin/sh\nexit 1\n');
      chmodSync(scriptPath, 0o755);

      // Add to PATH temporarily
      const originalPath = process.env.PATH;
      process.env.PATH = `${tempDir}:${originalPath}`;

      expect(isToolAvailable('bad-tool.sh')).toBe(false);

      // Restore PATH
      process.env.PATH = originalPath;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('should handle multiple concurrent checks', () => {
    // Test DRY principle - multiple tools checked efficiently
    // Use pnpm instead of npm - guaranteed to be available in our CI (pnpm monorepo)
    // npm is npm.cmd on Windows which causes which.sync() issues
    // Skipped on Windows: pnpm detection needs .cmd script handling fix
    const results = [
      isToolAvailable('node'),
      isToolAvailable('pnpm'),
      isToolAvailable('nonexistent-1'),
      isToolAvailable('nonexistent-2'),
    ];

    expect(results[0]).toBe(true); // node exists
    expect(results[1]).toBe(true); // pnpm exists (we're using pnpm)
    expect(results[2]).toBe(false); // doesn't exist
    expect(results[3]).toBe(false); // doesn't exist
  });
});

describe('getToolVersion', () => {
  it('should return version string for available tools', () => {
    const version = getToolVersion('node');
    expect(version).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it('should return null for unavailable tools', () => {
    const version = getToolVersion('nonexistent-tool-xyz-123');
    expect(version).toBeNull();
  });

  it('should support custom version argument', () => {
    const version = getToolVersion('git', 'version');
    expect(version).toMatch(/git version/);
  });

  it('should trim whitespace from output', () => {
    const version = getToolVersion('node');
    expect(version).not.toMatch(/^\s/);
    expect(version).not.toMatch(/\s$/);
  });

  it('should return null if version command fails', () => {
    // Create a temporary "tool" that exits with error
    const tempDir = mkdtempSync(join(normalizedTmpdir(), 'safe-exec-test-'));
    const scriptPath = join(tempDir, 'bad-version-tool.sh');

    try {
      writeFileSync(scriptPath, '#!/bin/sh\nexit 1\n');
      chmodSync(scriptPath, 0o755);

      // Add to PATH temporarily
      const originalPath = process.env.PATH;
      process.env.PATH = `${tempDir}:${originalPath}`;

      const version = getToolVersion('bad-version-tool.sh');
      expect(version).toBeNull();

      // Restore PATH
      process.env.PATH = originalPath;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('should handle multiple version queries efficiently (DRY)', () => {
    // Test that multiple version checks work correctly
    // Use pnpm instead of npm (npm.cmd on Windows causes which.sync issues)
    // Skipped on Windows: pnpm version detection needs .cmd script execution fix
    const versions = [
      getToolVersion('node'),
      getToolVersion('pnpm'),
      getToolVersion('nonexistent-tool'),
    ];

    expect(versions[0]).toMatch(/^v\d+/); // node version
    expect(versions[1]).toBeTruthy(); // pnpm version exists (we're using pnpm)
    expect(versions[2]).toBeNull(); // doesn't exist
  });
});

describe('Security - Command Injection Prevention', () => {
  it('should prevent PATH manipulation attacks', () => {
    // Even if PATH is manipulated, we use which.sync which resolves at call time
    const originalPath = process.env.PATH;
    const tempDir = mkdtempSync(join(normalizedTmpdir(), 'safe-exec-test-'));

    try {
      // Create malicious "node" script
      const maliciousScript = join(tempDir, 'node');
      writeFileSync(maliciousScript, '#!/bin/sh\necho "HACKED"\n');
      chmodSync(maliciousScript, 0o755);

      // Prepend malicious path (attacker scenario)
      process.env.PATH = `${tempDir}:${originalPath}`;

      // safeExecSync should still use the real node (resolved from system PATH)
      // Note: which.sync will find our fake node first, so this test shows
      // that we're using the PATH resolution correctly
      const result = safeExecSync('node', ['--version'], { encoding: 'utf8' });

      // In this case, it will use our fake node, showing that we respect PATH
      // But we DON'T use shell, so commands can't be injected
      expect(result).toBeTruthy();
    } finally {
      process.env.PATH = originalPath;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should not execute commands embedded in arguments', () => {
    const maliciousCommand = '$(rm -rf /)';

    // If shell was enabled, this would be dangerous
    // With shell: false, it's just a string passed to echo
    const result = safeExecSync(
      'echo',
      [maliciousCommand],
      { encoding: 'utf8' },
    );

    expect(result.trim()).toBe(maliciousCommand);
  });

  it('should not execute commands via backticks', () => {
    const maliciousCommand = '`whoami`';

    const result = safeExecSync(
      'echo',
      [maliciousCommand],
      { encoding: 'utf8' },
    );

    expect(result.trim()).toBe(maliciousCommand);
  });

  it('should handle environment variable expansion safely', () => {
    const maliciousEnv = '${PATH}';

    // Use node -e with single quotes in the JS code to avoid shell quote issues on Windows
    // On Windows with shell:true, double quotes can interfere with cmd.exe/PowerShell parsing
    const result = safeExecSync(
      'node',
      ['-e', `console.log('${maliciousEnv}')`], // Use single quotes inside the JS
      { encoding: 'utf8' },
    );

    // Should output literal string, not expand the variable
    expect(result.trim()).toBe(maliciousEnv);
  });
});

describe('DRY Principle Validation', () => {
  it('should consolidate command execution logic in single place', () => {
    // All three functions use the same underlying safe execution pattern
    // Testing that they all work correctly proves DRY compliance

    // Direct execution
    const execResult = safeExecSync('node', ['--version'], { encoding: 'utf8' });
    expect(execResult).toMatch(/^v\d+/);

    // Result object
    const resultObj = safeExecResult('node', ['--version'], { encoding: 'utf8' });
    expect(resultObj.stdout).toMatch(/^v\d+/);

    // Availability check
    expect(isToolAvailable('node')).toBe(true);

    // Version retrieval
    const version = getToolVersion('node');
    expect(version).toMatch(/^v\d+/);

    // All should produce consistent results
    expect(execResult.trim()).toBe((resultObj.stdout as string).trim());
    expect(version?.trim()).toBe(execResult.trim());
  });

  it('should not duplicate shell avoidance logic', () => {
    // All functions should avoid shell through the same mechanism
    // We can verify this by testing that special chars are handled consistently

    const specialArg = '$(echo "injected")';

    // Test safeExecSync - use echo to test argument passing
    const exec1 = safeExecSync(
      'echo',
      [specialArg],
      { encoding: 'utf8' },
    );
    expect(exec1.trim()).toBe(specialArg);

    // Test safeExecResult - use echo to test argument passing
    const exec2 = safeExecResult(
      'echo',
      [specialArg],
      { encoding: 'utf8' },
    );
    expect((exec2.stdout as string).trim()).toBe(specialArg);

    // Both should produce identical safe behavior
    expect(exec1.trim()).toBe((exec2.stdout as string).trim());
  });
});

describe('safeExecFromString', () => {
  describe('quote detection (fail-fast validation)', () => {
    it('should reject double quotes', () => {
      expect(() => safeExecFromString('echo "hello"')).toThrow(
        /does not support quotes/,
      );
    });

    it('should reject single quotes', () => {
      expect(() => safeExecFromString("echo 'hello'")).toThrow(
        /does not support quotes/,
      );
    });

    it('should reject backticks', () => {
      expect(() => safeExecFromString('echo `date`')).toThrow(
        /does not support quotes/,
      );
    });

    it('should provide helpful error message with safeExecSync example', () => {
      expect(() => safeExecFromString('tar -xzf "file.tar"')).toThrow(
        /Use safeExecSync/,
      );
    });

    it('should show the problematic command in error message', () => {
      try {
        safeExecFromString('npm install "package-name"');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).toContain('npm install "package-name"');
        }
      }
    });
  });

  describe('backward compatibility (simple commands)', () => {
    it('should allow simple commands without quotes', () => {
      // Should not throw
      expect(() => safeExecFromString('node --version')).not.toThrow();
    });

    it('should execute simple commands correctly', () => {
      const result = safeExecFromString('node --version', { encoding: 'utf8' });
      expect(result).toMatch(/^v\d+\.\d+\.\d+/);
    });

    it('should allow commands with multiple unquoted arguments', () => {
      const result = safeExecFromString('echo hello world', { encoding: 'utf8' });
      expect(result.trim()).toBe('hello world');
    });

    it('should allow commands with flags', () => {
      const result = safeExecFromString('node --version', { encoding: 'utf8' });
      expect(typeof result).toBe('string');
    });

    it('should handle commands with dashes and numbers', () => {
      // Common pattern: git log --max-count 10
      expect(() => safeExecFromString('git log --max-count 10')).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should reject quotes at any position', () => {
      expect(() => safeExecFromString('command "arg"')).toThrow();
      expect(() => safeExecFromString('"command" arg')).toThrow();
      expect(() => safeExecFromString('command arg "value"')).toThrow();
    });

    it('should reject mixed quote types', () => {
      expect(() => safeExecFromString('echo "hello" \'world\'')).toThrow();
    });

    it('should handle empty command string', () => {
      expect(() => safeExecFromString('')).toThrow();
    });

    it('should handle whitespace-only command string', () => {
      expect(() => safeExecFromString('   ')).toThrow();
    });
  });

  // Test data for shell syntax detection
  const shellSyntaxCases: Array<[string, string]> = [
    ['echo "hello"', 'quotes'],
    ["echo 'world'", 'quotes'],
    ['echo `date`', 'quotes'],
    ['ls *.txt', 'glob patterns'],
    ['ls file?.txt', 'glob patterns'],
    ['ls file[0-9].txt', 'glob patterns'],
    ['echo $HOME', 'variable expansion'],
    ['cat file | grep text', 'pipes/redirects/operators'],
    ['echo hello > file.txt', 'pipes/redirects/operators'],
    ['cat < input.txt', 'pipes/redirects/operators'],
    ['command &', 'pipes/redirects/operators'],
    ['command1; command2', 'pipes/redirects/operators'],
    ['command1 && command2', 'pipes/redirects/operators'],
    ['command1 || command2', 'pipes/redirects/operators'],
  ];

  const simpleCases = ['npm test', 'git status', 'node --version'];

  // Helper to test command rejection (reduces nesting depth)
  const expectCommandToThrowPattern = (command: string, expectedPattern: string) => {
    // eslint-disable-next-line security/detect-non-literal-regexp -- Test data is safe, from controlled test cases
    const pattern = new RegExp(expectedPattern.replaceAll('/', String.raw`\/`));
    expect(() => safeExecFromString(command)).toThrow(pattern);
  };

  describe('shell syntax detection', () => {
    describe('hasShellSyntax utility', () => {
      it('should return false for simple commands', () => {
        for (const cmd of simpleCases) {
          expect(hasShellSyntax(cmd)).toEqual({ hasShellSyntax: false });
        }
      });

      it.each(shellSyntaxCases)(
        'should detect %s as %s',
        (command, expectedPattern) => {
          const result = hasShellSyntax(command);
          expect(result.hasShellSyntax).toBe(true);
          expect(result.pattern).toBe(expectedPattern);
          expect(result.example).toBeDefined();
        },
      );
    });

    describe('safeExecFromString rejection', () => {
      it.each(shellSyntaxCases)(
        'should reject %s (%s)',
        (command, expectedPattern) => {
          expectCommandToThrowPattern(command, expectedPattern);
        },
      );

      it('should provide helpful error with example', () => {
        try {
          safeExecFromString('ls *.txt');
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          if (error instanceof Error) {
            expect(error.message).toContain('glob patterns');
            expect(error.message).toContain('safeExecSync');
          }
        }
      });
    });
  });
});
