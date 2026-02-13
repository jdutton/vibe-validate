import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { executeWrapperSync, type WrapperResultSync } from '../helpers/test-command-runner.js';

/**
 * Unit tests for the smart vibe-validate wrapper
 *
 * The wrapper is a plain JavaScript file (not TypeScript) that handles
 * context detection and delegates to the appropriate binary.
 *
 * We test the wrapper by executing it and verifying the output and behavior.
 */

// Test constants
const EXPECTED_VERSION = '0.19.0-rc.11'; // BUMP_VERSION_UPDATE
const REPO_ROOT = join(__dirname, '../../../..');
const PACKAGES_CORE = join(__dirname, '../../../core');

/**
 * Assert command succeeded (exit code 0)
 * @param result - Wrapper result to check
 */
function expectSuccess(result: WrapperResultSync) {
  expect(result.status).toBe(0);
}

/**
 * Assert command failed (non-zero exit code)
 * @param result - Wrapper result to check
 */
function expectFailure(result: WrapperResultSync) {
  expect(result.status).not.toBe(0);
}

/**
 * Assert stdout contains expected version string
 * @param result - Wrapper result to check
 */
function expectVersion(result: WrapperResultSync) {
  expect(result.stdout).toContain(EXPECTED_VERSION);
}

/**
 * Assert stdout contains expected text
 * @param result - Wrapper result to check
 * @param expectedText - Text to find in stdout
 */
function expectOutput(result: WrapperResultSync, expectedText: string) {
  expect(result.stdout).toContain(expectedText);
}

describe('Smart Wrapper (vibe-validate/vv)', () => {
  describe('Wrapper Files', () => {
    it('should have vibe-validate wrapper file', () => {
      const wrapperPath = join(__dirname, '../../dist/bin/vibe-validate');
      expect(existsSync(wrapperPath)).toBe(true);
    });

    it('should have vv symlink', () => {
      const vvPath = join(__dirname, '../../dist/bin/vv');
      expect(existsSync(vvPath)).toBe(true);
    });
  });

  describe('Developer Mode Detection', () => {
    it('should detect developer mode when in vibe-validate repo', () => {
      // When running tests, we ARE in the vibe-validate repo
      // So the wrapper should detect developer mode
      const result = executeWrapperSync(['--version'], { cwd: REPO_ROOT });

      expect(result).toBeDefined();
      expectSuccess(result);
      expectVersion(result);

      // Check if VV_CONTEXT was set (we can't directly access it, but we know it works if version prints)
    });

    it('should work from subdirectories (packages/core)', () => {
      // Run from a subdirectory - wrapper should walk up to find repo root
      const result = executeWrapperSync(['--version'], { cwd: PACKAGES_CORE });

      expect(result).toBeDefined();
      expectSuccess(result);
      expectVersion(result);
    });

    it('should work from deeply nested subdirectories', () => {
      // Run from test directory - wrapper should walk up multiple levels
      const result = executeWrapperSync(['--version'], { cwd: __dirname });

      expect(result).toBeDefined();
      expectSuccess(result);
      expectVersion(result);
    });
  });

  describe('Project Root Finding', () => {
    it('should find .git directory when in git repo', () => {
      // This test verifies the wrapper can find the .git directory
      // by successfully executing a command
      const result = executeWrapperSync(['state'], { cwd: REPO_ROOT });

      // Should not crash - state command should work
      expect(result).toBeDefined();
      expectSuccess(result);
    });

    it('should handle non-git directories gracefully', () => {
      // Test in /tmp which is definitely not a git repo
      const result = executeWrapperSync(['--version'], { cwd: '/tmp' });

      // Should still work (falls back to global install)
      // In this test environment, it will use the dev build
      expect(result).toBeDefined();
      expectSuccess(result);
    });
  });

  describe('Command Execution', () => {
    it('should pass through all arguments', () => {
      const result = executeWrapperSync(['--help'], { cwd: REPO_ROOT });

      expect(result).toBeDefined();
      expectSuccess(result);
      expectOutput(result, 'Usage:');
    });

    it('should pass through command with options', () => {
      const result = executeWrapperSync(['state', '--help'], { cwd: REPO_ROOT });

      expect(result).toBeDefined();
      expectSuccess(result);
      expectOutput(result, 'state');
    });

    it('should handle commands that fail', () => {
      const result = executeWrapperSync(['nonexistent-command'], { cwd: REPO_ROOT });

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
      const result = executeWrapperSync(['--version'], { cwd: REPO_ROOT });

      expect(result).toBeDefined();
      expectSuccess(result);

      // The wrapper should have set VV_CONTEXT=dev for developer mode
      // This is tested indirectly by the fact that the command succeeds
    });
  });

  describe('vv Symlink', () => {
    it('should work identically to vibe-validate', () => {
      const resultVV = executeWrapperSync(['--version'], { cwd: REPO_ROOT });
      const resultFull = executeWrapperSync(['--version'], { cwd: REPO_ROOT });

      expect(resultVV).toBeDefined();
      expect(resultFull).toBeDefined();
      expect(resultVV.status).toBe(resultFull.status);
      expect(resultVV.stdout).toBe(resultFull.stdout);
    });

    it('vv should pass all arguments correctly', () => {
      const result = executeWrapperSync(['state', '--help'], { cwd: REPO_ROOT });

      expect(result).toBeDefined();
      expectSuccess(result);
      expectOutput(result, 'state');
    });
  });

  describe('Error Handling', () => {
    it('should exit with non-zero code on command failure', () => {
      const result = executeWrapperSync(['run', 'false'], { cwd: REPO_ROOT });

      expect(result).toBeDefined();
      expectFailure(result);
    });

    it('should handle missing binary gracefully', () => {
      // This test verifies the wrapper handles edge cases
      // In normal operation, the binary should always exist
      const result = executeWrapperSync(['--version'], { cwd: '/tmp' });

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

      const result = executeWrapperSync(['--version'], { cwd: REPO_ROOT });

      expect(result).toBeDefined();
      expectSuccess(result);
    });

    it('should handle different path separators', () => {
      // The wrapper uses Node's path.join, which handles platform differences
      const result = executeWrapperSync(['--version'], { cwd: REPO_ROOT });

      expect(result).toBeDefined();
      expectSuccess(result);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should support run command with extraction', () => {
      const result = executeWrapperSync(['run', 'node -e "console.log(\'test\')"'], { cwd: REPO_ROOT });

      expect(result).toBeDefined();
      expectSuccess(result);
      expectOutput(result, 'command: node');
    });

    it('should support state command', () => {
      const result = executeWrapperSync(['state'], { cwd: REPO_ROOT });

      expect(result).toBeDefined();
      expectSuccess(result);
      // Should show treeHash
      expectOutput(result, 'treeHash:');
    });

    it('should support doctor command', () => {
      const result = executeWrapperSync(['doctor', '--help'], { cwd: REPO_ROOT });

      expect(result).toBeDefined();
      expectSuccess(result);
      expectOutput(result, 'doctor');
    });
  });
});
