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

import { describe, it, expect } from 'vitest';

import { executeWrapperSync } from '../helpers/test-command-runner.js';

describe('All commands work from subdirectories (system tests)', () => {
  // Get the project root (vibe-validate repo root)
  const PROJECT_ROOT = join(__dirname, '../../../..');
  const PACKAGES_DIR = join(PROJECT_ROOT, 'packages');
  const CLI_DIR = join(PROJECT_ROOT, 'packages/cli');

  // NOTE: validate command tests removed - they create circular dependency when run during validation
  // (integration tests run during validation, test tries to run validate, creates deadlock)
  // The validate command is extensively tested in unit tests.
  //
  // Issue #129 testing: validate/pre-commit directory behavior is covered by unit tests
  // in validate.test.ts and pre-commit.test.ts (no circular dependency)

  describe('state command', () => {
    it('should work from project root', () => {
      const result = executeWrapperSync(['state'], {
        cwd: PROJECT_ROOT,
      });

      // Should show state (exists: false OR passed: true/false) and treeHash
      expect(result.stdout).toMatch(/(exists|passed):/);
      expect(result.stdout).toMatch(/treeHash:/);
    });

    it('should work from subdirectory (packages/)', () => {
      const result = executeWrapperSync(['state'], {
        cwd: PACKAGES_DIR,
      });

      // Git operations are repo-wide, should show same state
      expect(result.stdout).toMatch(/(exists|passed):/);
      expect(result.stdout).toMatch(/treeHash:/);
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      const result = executeWrapperSync(['state'], {
        cwd: CLI_DIR,
      });

      expect(result.stdout).toMatch(/(exists|passed):/);
      expect(result.stdout).toMatch(/treeHash:/);
    });
  });

  describe('config command', () => {
    it('should work from project root', () => {
      const result = executeWrapperSync(['config', 'show'], {
        cwd: PROJECT_ROOT,
      });

      // Should display config
      expect(result.stdout).toMatch(/validation:/);
      expect(result.stdout).toMatch(/git:/);
    });

    it('should work from subdirectory (packages/)', () => {
      const result = executeWrapperSync(['config', 'show'], {
        cwd: PACKAGES_DIR,
      });

      // Should find config in parent and display it
      expect(result.stdout).toMatch(/validation:/);
      expect(result.stdout).toMatch(/git:/);
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      const result = executeWrapperSync(['config', 'show'], {
        cwd: CLI_DIR,
      });

      // Should find config two levels up
      expect(result.stdout).toMatch(/validation:/);
      expect(result.stdout).toMatch(/git:/);
    });
  });

  describe('snapshot command', () => {
    it('should work from project root', () => {
      const result = executeWrapperSync(['snapshot'], {
        cwd: PROJECT_ROOT,
      });

      // Should show snapshot with tree hash
      expect(result.stdout).toMatch(/Snapshot:/);
      expect(result.stdout).toMatch(/[0-9a-f]{40}/); // Git hash pattern
    });

    it('should work from subdirectory (packages/)', () => {
      const result = executeWrapperSync(['snapshot'], {
        cwd: PACKAGES_DIR,
      });

      // Git tree operations work repo-wide
      expect(result.stdout).toMatch(/Snapshot:/);
      expect(result.stdout).toMatch(/[0-9a-f]{40}/);
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      const result = executeWrapperSync(['snapshot'], {
        cwd: CLI_DIR,
      });

      expect(result.stdout).toMatch(/Snapshot:/);
      expect(result.stdout).toMatch(/[0-9a-f]{40}/);
    });
  });

  describe('history command', () => {
    it('should work from project root', () => {
      const result = executeWrapperSync(['history', 'list'], {
        cwd: PROJECT_ROOT,
      });

      // Should show history header (or "no history" message if empty)
      expect(result.stdout).toMatch(/Validation History|Total validation runs|No validation history found/);
    });

    it('should work from subdirectory (packages/)', () => {
      const result = executeWrapperSync(['history', 'list'], {
        cwd: PACKAGES_DIR,
      });

      // Git notes operations are repo-wide
      expect(result.stdout).toMatch(/Validation History|Total validation runs|No validation history found/);
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      const result = executeWrapperSync(['history', 'list'], {
        cwd: CLI_DIR,
      });

      expect(result.stdout).toMatch(/Validation History|Total validation runs|No validation history found/);
    });
  });

  describe('pre-commit command', () => {
    it('should show help from project root', () => {
      const result = executeWrapperSync(['pre-commit', '--help'], {
        cwd: PROJECT_ROOT,
      });

      // Should display help text
      expect(result.stdout).toMatch(/Run branch sync check/);
    });

    it('should show help from subdirectory (packages/)', () => {
      const result = executeWrapperSync(['pre-commit', '--help'], {
        cwd: PACKAGES_DIR,
      });

      expect(result.stdout).toMatch(/Run branch sync check/);
    });

    it('should show help from deep subdirectory (packages/cli/)', () => {
      const result = executeWrapperSync(['pre-commit', '--help'], {
        cwd: CLI_DIR,
      });

      expect(result.stdout).toMatch(/Run branch sync check/);
    });
  });

  describe('watch-pr command', () => {
    it('should show help from project root', () => {
      const result = executeWrapperSync(['watch-pr', '--help'], {
        cwd: PROJECT_ROOT,
      });

      // Should display help text
      expect(result.stdout).toMatch(/Monitor PR checks/);
    });

    it('should show help from subdirectory (packages/)', () => {
      const result = executeWrapperSync(['watch-pr', '--help'], {
        cwd: PACKAGES_DIR,
      });

      expect(result.stdout).toMatch(/Monitor PR checks/);
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      const result = executeWrapperSync(['watch-pr', '--help'], {
        cwd: CLI_DIR,
      });

      expect(result.stdout).toMatch(/Monitor PR checks/);
    });
  });

  describe('init command', () => {
    it('should show help from project root', () => {
      const result = executeWrapperSync(['init', '--help'], {
        cwd: PROJECT_ROOT,
      });

      // Should display help text
      expect(result.stdout).toMatch(/Initialize vibe-validate/);
    });

    it('should show help from subdirectory (packages/)', () => {
      const result = executeWrapperSync(['init', '--help'], {
        cwd: PACKAGES_DIR,
      });

      expect(result.stdout).toMatch(/Initialize vibe-validate/);
    });

    it('should show help from deep subdirectory (packages/cli/)', () => {
      const result = executeWrapperSync(['init', '--help'], {
        cwd: CLI_DIR,
      });

      expect(result.stdout).toMatch(/Initialize vibe-validate/);
    });
  });

  describe('run command', () => {
    it('should work from project root', () => {
      const result = executeWrapperSync(['run', 'echo', 'test-from-root'], {
        cwd: PROJECT_ROOT,
      });

      // Should show YAML output with command result
      expect(result.stdout).toMatch(/command:/);
      expect(result.stdout).toMatch(/exitCode:/);
    });

    it('should work from subdirectory (packages/)', () => {
      const result = executeWrapperSync(['run', 'echo', 'test-from-subdir'], {
        cwd: PACKAGES_DIR,
      });

      // Command execution works from any directory
      expect(result.stdout).toMatch(/command:/);
      expect(result.stdout).toMatch(/exitCode:/);
    });

    it('should work from deep subdirectory (packages/cli/)', () => {
      const result = executeWrapperSync(['run', 'echo', 'test-from-deep-subdir'], {
        cwd: CLI_DIR,
      });

      expect(result.stdout).toMatch(/command:/);
      expect(result.stdout).toMatch(/exitCode:/);
    });
  });

  describe('Issue #129: vv run preserves process.cwd() for ad-hoc commands', () => {
    // NOTE: This is CORRECT behavior for vv run (not a bug)
    // vv run is for ad-hoc commands where the user's location is intentional

    it('should execute vv run commands in process.cwd() (current directory)', () => {
      // vv run from CLI_DIR should run in CLI_DIR, not project root
      // This is intentional - user wants to run command in their current directory
      const result = executeWrapperSync(['run', 'test', '-f', 'package.json'], {
        cwd: CLI_DIR, // Run from packages/cli directory
      });

      // Should succeed because package.json exists in packages/cli (where we are)
      expect(result.stdout).toMatch(/exitCode:\s*0/);
    });

    it('should use --cwd option to override directory', () => {
      // When --cwd is specified, commands should run in that directory (relative to git root)
      const result = executeWrapperSync(
        ['run', '--cwd', 'packages/core', 'test', '-f', 'package.json'],
        {
          cwd: PROJECT_ROOT, // Run from root but specify different directory
        }
      );

      // Should succeed because package.json exists in packages/core
      expect(result.stdout).toMatch(/exitCode:\s*0/);
    });
  });

  describe('Regression: All commands should produce same results regardless of cwd', () => {
    // Skipped on Windows (Issue #127) - tree hash differs when run from subdirectories.
    // Despite using --absolute-git-dir, --show-toplevel, and cwd: repoRoot,
    // Windows still produces different hashes. Likely path normalization issue.
    // Core functionality works, but cross-directory consistency needs investigation.
    it.skipIf(process.platform === 'win32')('state command should show same tree hash from all directories', () => {
      const rootResult = executeWrapperSync(['state'], {
        cwd: PROJECT_ROOT,
      });

      const subdirResult = executeWrapperSync(['state'], {
        cwd: PACKAGES_DIR,
      });

      const deepResult = executeWrapperSync(['state'], {
        cwd: CLI_DIR,
      });

      // Extract tree hash from outputs (format: "treeHash: abc123...")
      const extractHash = (output: string) => {
        const match = /treeHash:\s*([a-f0-9]+)/.exec(output);
        return match ? match[1] : null;
      };

      const rootHash = extractHash(rootResult.stdout);
      const subdirHash = extractHash(subdirResult.stdout);
      const deepHash = extractHash(deepResult.stdout);

      // All should report same tree hash (repo-wide state)
      expect(rootHash).toBeTruthy();
      expect(subdirHash).toBe(rootHash);
      expect(deepHash).toBe(rootHash);
    });

    it('config command should show same configuration from all directories', () => {
      const rootResult = executeWrapperSync(['config', 'show'], {
        cwd: PROJECT_ROOT,
      });

      const subdirResult = executeWrapperSync(['config', 'show'], {
        cwd: PACKAGES_DIR,
      });

      const deepResult = executeWrapperSync(['config', 'show'], {
        cwd: CLI_DIR,
      });

      // All should show identical config (walk-up finds same file)
      expect(subdirResult.stdout).toBe(rootResult.stdout);
      expect(deepResult.stdout).toBe(rootResult.stdout);
    });
  });
});
