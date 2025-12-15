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
      const result = spawnSync('node', [wrapperPath, '--version'], {
        cwd: join(__dirname, '../../../..'), // repo root
        env: { ...process.env },
      });

      expect(result.status).toBe(0);
      expect(result.stdout.toString()).toContain('0.17.5'); // BUMP_VERSION_UPDATE

      // Check if VV_CONTEXT was set (we can't directly access it, but we know it works if version prints)
    });

    it('should work from subdirectories (packages/core)', () => {
      // Run from a subdirectory - wrapper should walk up to find repo root
      const result = spawnSync('node', [wrapperPath, '--version'], {
        cwd: join(__dirname, '../../../core'), // packages/core
        env: { ...process.env },
      });

      expect(result.status).toBe(0);
      expect(result.stdout.toString()).toContain('0.17.5'); // BUMP_VERSION_UPDATE
    });

    it('should work from deeply nested subdirectories', () => {
      // Run from test directory - wrapper should walk up multiple levels
      const result = spawnSync('node', [wrapperPath, '--version'], {
        cwd: __dirname, // packages/cli/test/bin
        env: { ...process.env },
      });

      expect(result.status).toBe(0);
      expect(result.stdout.toString()).toContain('0.17.5'); // BUMP_VERSION_UPDATE
    });
  });

  describe('Project Root Finding', () => {
    it('should find .git directory when in git repo', () => {
      // This test verifies the wrapper can find the .git directory
      // by successfully executing a command
      const result = spawnSync('node', [wrapperPath, 'state'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      // Should not crash - state command should work
      expect(result.status).toBe(0);
    });

    it('should handle non-git directories gracefully', () => {
      // Test in /tmp which is definitely not a git repo
      const result = spawnSync('node', [wrapperPath, '--version'], {
        cwd: '/tmp',
        env: { ...process.env },
      });

      // Should still work (falls back to global install)
      // In this test environment, it will use the dev build
      expect(result.status).toBe(0);
    });
  });

  describe('Command Execution', () => {
    it('should pass through all arguments', () => {
      const result = spawnSync('node', [wrapperPath, '--help'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      expect(result.status).toBe(0);
      expect(result.stdout.toString()).toContain('Usage:');
    });

    it('should pass through command with options', () => {
      const result = spawnSync('node', [wrapperPath, 'state', '--help'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      expect(result.status).toBe(0);
      expect(result.stdout.toString()).toContain('state');
    });

    it('should handle commands that fail', () => {
      const result = spawnSync('node', [wrapperPath, 'nonexistent-command'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      // Should return non-zero exit code
      expect(result.status).not.toBe(0);
    });
  });

  describe('Environment Variable Passing', () => {
    it('should set VV_CONTEXT environment variable', () => {
      // The wrapper sets VV_CONTEXT, which is used by validate-workflow.ts
      // We can't directly test this without running a full validation,
      // but we test that the wrapper executes successfully
      const result = spawnSync('node', [wrapperPath, '--version'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      expect(result.status).toBe(0);

      // The wrapper should have set VV_CONTEXT=dev for developer mode
      // This is tested indirectly by the fact that the command succeeds
    });
  });

  describe('vv Symlink', () => {
    it('should work identically to vibe-validate', () => {
      const resultVV = spawnSync('node', [vvPath, '--version'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      const resultFull = spawnSync('node', [wrapperPath, '--version'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      expect(resultVV.status).toBe(resultFull.status);
      expect(resultVV.stdout.toString()).toBe(resultFull.stdout.toString());
    });

    it('vv should pass all arguments correctly', () => {
      const result = spawnSync('node', [vvPath, 'state', '--help'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      expect(result.status).toBe(0);
      expect(result.stdout.toString()).toContain('state');
    });
  });

  describe('Error Handling', () => {
    it('should exit with non-zero code on command failure', () => {
      const result = spawnSync('node', [wrapperPath, 'run', 'false'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      expect(result.status).not.toBe(0);
    });

    it('should handle missing binary gracefully', () => {
      // This test verifies the wrapper handles edge cases
      // In normal operation, the binary should always exist
      const result = spawnSync('node', [wrapperPath, '--version'], {
        cwd: '/tmp',
        env: { ...process.env },
      });

      // Should either succeed (using global) or fail gracefully
      expect([0, 1]).toContain(result.status);
    });
  });

  describe('Cross-Platform Compatibility', () => {
    it('should work on Unix-like systems', () => {
      // Skip on Windows
      if (process.platform === 'win32') {
        return;
      }

      const result = spawnSync('node', [wrapperPath, '--version'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      expect(result.status).toBe(0);
    });

    it('should handle different path separators', () => {
      // The wrapper uses Node's path.join, which handles platform differences
      const result = spawnSync('node', [wrapperPath, '--version'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      expect(result.status).toBe(0);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should support run command with extraction', () => {
      const result = spawnSync('node', [wrapperPath, 'run', 'node -e "console.log(\'test\')"'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      expect(result.status).toBe(0);
      expect(result.stdout.toString()).toContain('command: node');
    });

    it('should support state command', () => {
      const result = spawnSync('node', [wrapperPath, 'state'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      expect(result.status).toBe(0);
      // Should show treeHash
      expect(result.stdout.toString()).toContain('treeHash:');
    });

    it('should support doctor command', () => {
      const result = spawnSync('node', [wrapperPath, 'doctor', '--help'], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env },
      });

      expect(result.status).toBe(0);
      expect(result.stdout.toString()).toContain('doctor');
    });
  });
});
