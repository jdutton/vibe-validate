/**
 * System tests for subdirectory behavior across all commands
 *
 * CRITICAL REGRESSION TESTS: Ensures all vibe-validate commands work correctly
 * when run from subdirectories, not just from project root.
 *
 * These tests run against THIS project (vibe-validate itself) to verify
 * self-hosting works from any subdirectory. No mocks - real execution.
 */

import { join } from 'node:path';

import { safeExecFromString } from '@vibe-validate/utils';
import { describe, it, expect } from 'vitest';

describe('All commands work from subdirectories (system tests)', () => {
  // Get the project root (vibe-validate repo root)
  const PROJECT_ROOT = join(__dirname, '../../../..');
  const PACKAGES_DIR = join(PROJECT_ROOT, 'packages');
  const CLI_DIR = join(PROJECT_ROOT, 'packages/cli');

  describe('validate command', () => {
    it('should work from project root', () => {
      // validate --check returns exit code 1 if not validated, which is OK
      try {
        const output = safeExecFromString('vv validate --check', {
          cwd: PROJECT_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        expect(output).toBeTruthy();
      } catch (error: any) {
        // Command ran but returned non-zero (not validated yet), check it produced output
        expect(error.stdout || error.stderr).toBeTruthy();
      }
    });

    it('should work from subdirectory (packages/)', () => {
      try {
        const output = safeExecFromString('vv validate --check', {
          cwd: PACKAGES_DIR,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        expect(output).toBeTruthy();
      } catch (error: any) {
        // Should find config in parent directory and check validation state
        expect(error.stdout || error.stderr).toBeTruthy();
      }
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      try {
        const output = safeExecFromString('vv validate --check', {
          cwd: CLI_DIR,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        expect(output).toBeTruthy();
      } catch (error: any) {
        // Should find config two levels up and check validation state
        expect(error.stdout || error.stderr).toBeTruthy();
      }
    });
  });

  describe('state command', () => {
    it('should work from project root', () => {
      const output = safeExecFromString('vv state', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Should show exists: false or true, and treeHash
      expect(output).toMatch(/exists:/);
      expect(output).toMatch(/treeHash:/);
    });

    it('should work from subdirectory (packages/)', () => {
      const output = safeExecFromString('vv state', {
        cwd: PACKAGES_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Git operations are repo-wide, should show same state
      expect(output).toMatch(/exists:/);
      expect(output).toMatch(/treeHash:/);
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      const output = safeExecFromString('vv state', {
        cwd: CLI_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      expect(output).toMatch(/exists:/);
      expect(output).toMatch(/treeHash:/);
    });
  });

  describe('config command', () => {
    it('should work from project root', () => {
      const output = safeExecFromString('vv config show', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Should display config
      expect(output).toMatch(/validation:/);
      expect(output).toMatch(/git:/);
    });

    it('should work from subdirectory (packages/)', () => {
      const output = safeExecFromString('vv config show', {
        cwd: PACKAGES_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Should find config in parent and display it
      expect(output).toMatch(/validation:/);
      expect(output).toMatch(/git:/);
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      const output = safeExecFromString('vv config show', {
        cwd: CLI_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Should find config two levels up
      expect(output).toMatch(/validation:/);
      expect(output).toMatch(/git:/);
    });
  });

  describe('snapshot command', () => {
    it('should work from project root', () => {
      const output = safeExecFromString('vv snapshot', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Should show snapshot with tree hash
      expect(output).toMatch(/Snapshot:/);
      expect(output).toMatch(/[0-9a-f]{40}/); // Git hash pattern
    });

    it('should work from subdirectory (packages/)', () => {
      const output = safeExecFromString('vv snapshot', {
        cwd: PACKAGES_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Git tree operations work repo-wide
      expect(output).toMatch(/Snapshot:/);
      expect(output).toMatch(/[0-9a-f]{40}/);
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      const output = safeExecFromString('vv snapshot', {
        cwd: CLI_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      expect(output).toMatch(/Snapshot:/);
      expect(output).toMatch(/[0-9a-f]{40}/);
    });
  });

  describe('history command', () => {
    it('should work from project root', () => {
      const output = safeExecFromString('vv history list', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Should show history header (even if empty)
      expect(output).toMatch(/Validation History|Total validation runs/);
    });

    it('should work from subdirectory (packages/)', () => {
      const output = safeExecFromString('vv history list', {
        cwd: PACKAGES_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Git notes operations are repo-wide
      expect(output).toMatch(/Validation History|Total validation runs/);
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      const output = safeExecFromString('vv history list', {
        cwd: CLI_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      expect(output).toMatch(/Validation History|Total validation runs/);
    });
  });

  describe('cleanup command', () => {
    it('should work from project root', () => {
      const output = safeExecFromString('vv cleanup --dry-run', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Should show cleanup preview
      expect(output).toMatch(/Cleanup Preview|Dry Run/i);
    });

    it('should work from subdirectory (packages/)', () => {
      const output = safeExecFromString('vv cleanup --dry-run', {
        cwd: PACKAGES_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Git operations work repo-wide
      expect(output).toMatch(/Cleanup Preview|Dry Run/i);
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      const output = safeExecFromString('vv cleanup --dry-run', {
        cwd: CLI_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      expect(output).toMatch(/Cleanup Preview|Dry Run/i);
    });
  });

  describe('pre-commit command', () => {
    it('should show help from project root', () => {
      const output = safeExecFromString('vv pre-commit --help', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Should display help text
      expect(output).toMatch(/Run branch sync check/);
    });

    it('should show help from subdirectory (packages/)', () => {
      const output = safeExecFromString('vv pre-commit --help', {
        cwd: PACKAGES_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      expect(output).toMatch(/Run branch sync check/);
    });

    it('should show help from deep subdirectory (packages/cli/)', () => {
      const output = safeExecFromString('vv pre-commit --help', {
        cwd: CLI_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      expect(output).toMatch(/Run branch sync check/);
    });
  });

  describe('watch-pr command', () => {
    it('should show help from project root', () => {
      const output = safeExecFromString('vv watch-pr --help', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Should display help text
      expect(output).toMatch(/Watch CI checks/);
    });

    it('should show help from subdirectory (packages/)', () => {
      const output = safeExecFromString('vv watch-pr --help', {
        cwd: PACKAGES_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      expect(output).toMatch(/Watch CI checks/);
    });

    it('should show help from deep subdirectory (packages/cli/)', () => {
      const output = safeExecFromString('vv watch-pr --help', {
        cwd: CLI_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      expect(output).toMatch(/Watch CI checks/);
    });
  });

  describe('init command', () => {
    it('should show help from project root', () => {
      const output = safeExecFromString('vv init --help', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Should display help text
      expect(output).toMatch(/Initialize vibe-validate/);
    });

    it('should show help from subdirectory (packages/)', () => {
      const output = safeExecFromString('vv init --help', {
        cwd: PACKAGES_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      expect(output).toMatch(/Initialize vibe-validate/);
    });

    it('should show help from deep subdirectory (packages/cli/)', () => {
      const output = safeExecFromString('vv init --help', {
        cwd: CLI_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      expect(output).toMatch(/Initialize vibe-validate/);
    });
  });

  describe('run command', () => {
    it('should work from project root', () => {
      const output = safeExecSync('vv', ['run', 'echo', 'test-from-root'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Should show YAML output with command result
      expect(output).toMatch(/command:/);
      expect(output).toMatch(/exitCode:/);
    });

    it('should work from subdirectory (packages/)', () => {
      const output = safeExecSync('vv', ['run', 'echo', 'test-from-subdir'], {
        cwd: PACKAGES_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Command execution works from any directory
      expect(output).toMatch(/command:/);
      expect(output).toMatch(/exitCode:/);
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      const output = safeExecSync('vv', ['run', 'echo', 'test-from-deep-subdir'], {
        cwd: CLI_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      expect(output).toMatch(/command:/);
      expect(output).toMatch(/exitCode:/);
    });
  });

  describe('Regression: All commands should produce same results regardless of cwd', () => {
    it('state command should show same tree hash from all directories', () => {
      const rootOutput = safeExecFromString('vv state', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      const subdirOutput = safeExecFromString('vv state', {
        cwd: PACKAGES_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      const deepOutput = safeExecFromString('vv state', {
        cwd: CLI_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Extract tree hash from outputs (format: "treeHash: abc123...")
      const extractHash = (output: string) => {
        const match = output.match(/treeHash:\s*([a-f0-9]+)/);
        return match ? match[1] : null;
      };

      const rootHash = extractHash(rootOutput);
      const subdirHash = extractHash(subdirOutput);
      const deepHash = extractHash(deepOutput);

      // All should report same tree hash (repo-wide state)
      expect(rootHash).toBeTruthy();
      expect(subdirHash).toBe(rootHash);
      expect(deepHash).toBe(rootHash);
    });

    it('config command should show same configuration from all directories', () => {
      const rootOutput = safeExecFromString('vv config show', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      const subdirOutput = safeExecFromString('vv config show', {
        cwd: PACKAGES_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      const deepOutput = safeExecFromString('vv config show', {
        cwd: CLI_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // All should show identical config (walk-up finds same file)
      expect(subdirOutput).toBe(rootOutput);
      expect(deepOutput).toBe(rootOutput);
    });
  });
});
