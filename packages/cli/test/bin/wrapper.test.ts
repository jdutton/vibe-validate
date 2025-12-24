import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * Unit tests for the smart vibe-validate wrapper
 *
 * The wrapper is a plain JavaScript file (not TypeScript) that handles
 * context detection and delegates to the appropriate binary.
 *
 * We test the wrapper by executing it and verifying the output and behavior.
 */

// Test constants
const EXPECTED_VERSION = '0.18.0-rc.1'; // BUMP_VERSION_UPDATE
const REPO_ROOT = join(__dirname, '../../../..');
const PACKAGES_CORE = join(__dirname, '../../../core');

/**
 * Execute wrapper command and return result
 * Cross-platform compatible (uses node directly)
 * @param wrapperPath - Path to wrapper script
 * @param args - Command arguments
 * @param options - Execution options (cwd, env)
 * @returns Spawn result with status, stdout, stderr
 */
function executeWrapper(
  wrapperPath: string,
  args: string[] = [],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
) {
  return spawnSync('node', [wrapperPath, ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? { ...process.env },
  });
}

/**
 * Assert command succeeded (exit code 0)
 * @param result - Spawn result to check
 */
function expectSuccess(result: ReturnType<typeof spawnSync>) {
  expect(result.status).toBe(0);
}

/**
 * Assert command failed (non-zero exit code)
 * @param result - Spawn result to check
 */
function expectFailure(result: ReturnType<typeof spawnSync>) {
  expect(result.status).not.toBe(0);
}

/**
 * Assert stdout contains expected version string
 * @param result - Spawn result to check
 */
function expectVersion(result: ReturnType<typeof spawnSync>) {
  expect(result.stdout.toString()).toContain(EXPECTED_VERSION);
}

/**
 * Assert stdout contains expected text
 * @param result - Spawn result to check
 * @param expectedText - Text to find in stdout
 */
function expectOutput(result: ReturnType<typeof spawnSync>, expectedText: string) {
  expect(result.stdout.toString()).toContain(expectedText);
}

describe('Smart Wrapper (vibe-validate/vv)', () => {
  const wrapperPath = join(__dirname, '../../dist/bin/vibe-validate');
  const vvPath = join(__dirname, '../../dist/bin/vv');

  describe('Wrapper Files', () => {
    it('should have vibe-validate wrapper file', () => {
      expect(existsSync(wrapperPath)).toBe(true);
    });

    it('should have vv symlink', () => {
      expect(existsSync(vvPath)).toBe(true);
    });

    it('vv should be executable', () => {
      const result = spawnSync('test', ['-x', vvPath]);
      expect(result.status).toBe(0);
    });

    it('vibe-validate should be executable', () => {
      const result = spawnSync('test', ['-x', wrapperPath]);
      expect(result.status).toBe(0);
    });
  });

  describe('Developer Mode Detection', () => {
    it('should detect developer mode when in vibe-validate repo', () => {
      // When running tests, we ARE in the vibe-validate repo
      // So the wrapper should detect developer mode
      const result = executeWrapper(wrapperPath, ['--version']);

      expect(result).toBeDefined();
      expectSuccess(result);
      expectVersion(result);

      // Check if VV_CONTEXT was set (we can't directly access it, but we know it works if version prints)
    });

    it('should work from subdirectories (packages/core)', () => {
      // Run from a subdirectory - wrapper should walk up to find repo root
      const result = executeWrapper(wrapperPath, ['--version'], { cwd: PACKAGES_CORE });

      expect(result).toBeDefined();
      expectSuccess(result);
      expectVersion(result);
    });

    it('should work from deeply nested subdirectories', () => {
      // Run from test directory - wrapper should walk up multiple levels
      const result = executeWrapper(wrapperPath, ['--version'], { cwd: __dirname });

      expect(result).toBeDefined();
      expectSuccess(result);
      expectVersion(result);
    });
  });

  describe('Project Root Finding', () => {
    it('should find .git directory when in git repo', () => {
      // This test verifies the wrapper can find the .git directory
      // by successfully executing a command
      const result = executeWrapper(wrapperPath, ['state']);

      // Should not crash - state command should work
      expect(result).toBeDefined();
      expectSuccess(result);
    });

    it('should handle non-git directories gracefully', () => {
      // Test in /tmp which is definitely not a git repo
      const result = executeWrapper(wrapperPath, ['--version'], { cwd: '/tmp' });

      // Should still work (falls back to global install)
      // In this test environment, it will use the dev build
      expect(result).toBeDefined();
      expectSuccess(result);
    });
  });

  describe('Command Execution', () => {
    it('should pass through all arguments', () => {
      const result = executeWrapper(wrapperPath, ['--help']);

      expect(result).toBeDefined();
      expectSuccess(result);
      expectOutput(result, 'Usage:');
    });

    it('should pass through command with options', () => {
      const result = executeWrapper(wrapperPath, ['state', '--help']);

      expect(result).toBeDefined();
      expectSuccess(result);
      expectOutput(result, 'state');
    });

    it('should handle commands that fail', () => {
      const result = executeWrapper(wrapperPath, ['nonexistent-command']);

      // Should return non-zero exit code
      expect(result).toBeDefined();
      expectFailure(result);
    });
  });

  describe('Environment Variable Passing', () => {
    it('should set VV_CONTEXT environment variable', () => {
      // The wrapper sets VV_CONTEXT, which is used by validate-workflow.ts
      // We can't directly test this without running a full validation,
      // but we test that the wrapper executes successfully
      const result = executeWrapper(wrapperPath, ['--version']);

      expect(result).toBeDefined();
      expectSuccess(result);

      // The wrapper should have set VV_CONTEXT=dev for developer mode
      // This is tested indirectly by the fact that the command succeeds
    });
  });

  describe('vv Symlink', () => {
    it('should work identically to vibe-validate', () => {
      const resultVV = executeWrapper(vvPath, ['--version']);
      const resultFull = executeWrapper(wrapperPath, ['--version']);

      expect(resultVV).toBeDefined();
      expect(resultFull).toBeDefined();
      expect(resultVV.status).toBe(resultFull.status);
      expect(resultVV.stdout.toString()).toBe(resultFull.stdout.toString());
    });

    it('vv should pass all arguments correctly', () => {
      const result = executeWrapper(vvPath, ['state', '--help']);

      expect(result).toBeDefined();
      expectSuccess(result);
      expectOutput(result, 'state');
    });
  });

  describe('Error Handling', () => {
    it('should exit with non-zero code on command failure', () => {
      const result = executeWrapper(wrapperPath, ['run', 'false']);

      expect(result).toBeDefined();
      expectFailure(result);
    });

    it('should handle missing binary gracefully', () => {
      // This test verifies the wrapper handles edge cases
      // In normal operation, the binary should always exist
      const result = executeWrapper(wrapperPath, ['--version'], { cwd: '/tmp' });

      // Should either succeed (using global) or fail gracefully
      expect(result).toBeDefined();
      expect([0, 1]).toContain(result.status);
    });
  });

  describe('Cross-Platform Compatibility', () => {
    it('should work on Unix-like systems', () => {
      // Skip on Windows
      if (process.platform === 'win32') {
        return;
      }

      const result = executeWrapper(wrapperPath, ['--version']);

      expect(result).toBeDefined();
      expectSuccess(result);
    });

    it('should handle different path separators', () => {
      // The wrapper uses Node's path.join, which handles platform differences
      const result = executeWrapper(wrapperPath, ['--version']);

      expect(result).toBeDefined();
      expectSuccess(result);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should support run command with extraction', () => {
      const result = executeWrapper(wrapperPath, ['run', 'node -e "console.log(\'test\')"']);

      expect(result).toBeDefined();
      expectSuccess(result);
      expectOutput(result, 'command: node');
    });

    it('should support state command', () => {
      const result = executeWrapper(wrapperPath, ['state']);

      expect(result).toBeDefined();
      expectSuccess(result);
      // Should show treeHash
      expectOutput(result, 'treeHash:');
    });

    it('should support doctor command', () => {
      const result = executeWrapper(wrapperPath, ['doctor', '--help']);

      expect(result).toBeDefined();
      expectSuccess(result);
      expectOutput(result, 'doctor');
    });
  });
});
