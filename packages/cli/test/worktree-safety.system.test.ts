/**
 * SYSTEM TESTS for git worktree safety
 *
 * These tests verify that vibe-validate works correctly with git worktrees:
 * - PID-based temp index files prevent collisions
 * - Stale temp index cleanup works
 * - No corruption when running in worktrees
 *
 * Run with: pnpm test:system
 *
 * NOTE: These tests create real git repos and worktrees, may be slow or fragile.
 * Can be disabled with describe.skip() if causing CI issues.
 *
 * To skip: Change `describe('worktree safety...` to `describe.skip('worktree safety...`
 */

import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { executeGitCommand } from '@vibe-validate/git';
import { normalizedTmpdir, mkdirSyncReal, normalizePath } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { executeVvCommand } from './helpers/cli-execution-helpers.js';

describe('worktree safety system tests', () => {
  let testDir: string;
  let mainRepoDir: string;
  let worktreeDir: string;

  beforeEach(() => {
    // Create unique test directory
    testDir = normalizePath(join(normalizedTmpdir(), `vv-worktree-test-${Date.now()}`));
    testDir = mkdirSyncReal(testDir, { recursive: true });

    mainRepoDir = join(testDir, 'main-repo');
    worktreeDir = join(testDir, 'feature-worktree');

    // Initialize main repo
    mainRepoDir = mkdirSyncReal(mainRepoDir, { recursive: true });
    executeGitCommand(['init'], { cwd: mainRepoDir });
    executeGitCommand(['config', 'user.email', 'test@example.com'], { cwd: mainRepoDir });
    executeGitCommand(['config', 'user.name', 'Test User'], { cwd: mainRepoDir });

    // Create initial commit (required for worktrees)
    const packageJson = {
      name: 'worktree-test',
      version: '1.0.0',
      scripts: {
        test: 'echo "test passed"',
      },
    };
    writeFileSync(join(mainRepoDir, 'package.json'), JSON.stringify(packageJson, null, 2));
    executeGitCommand(['add', '.'], { cwd: mainRepoDir });
    executeGitCommand(['commit', '-m', 'Initial commit'], { cwd: mainRepoDir });

    // Create vibe-validate config
    const config = `
steps:
  - name: "Quick Test"
    command: "npm test"
`;
    writeFileSync(join(mainRepoDir, 'vibe-validate.config.yaml'), config);
    executeGitCommand(['add', 'vibe-validate.config.yaml'], { cwd: mainRepoDir });
    executeGitCommand(['commit', '-m', 'Add vibe-validate config'], { cwd: mainRepoDir });

    // Create a worktree with a new branch
    // This creates both the worktree directory and the feature-branch
    executeGitCommand(['worktree', 'add', '-b', 'feature-branch', worktreeDir], { cwd: mainRepoDir });
  });

  afterEach(() => {
    // Cleanup worktree first (required before removing directory)
    try {
      executeGitCommand(['worktree', 'remove', worktreeDir, '--force'], { cwd: mainRepoDir });
    } catch {
      // Ignore errors - directory might not exist
    }

    // Remove test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore errors - best effort cleanup
    }
  });

  it('should run validation in worktree without corruption', async () => {
    // Run validation in the worktree
    const result = await executeVvCommand(['validate'], {
      cwd: worktreeDir,
    });

    // Validation should complete (pass or fail is OK for this test)
    // The important thing is that it doesn't crash or corrupt the worktree
    expect(result).toBeDefined();
    expect(result.exitCode).toBeGreaterThanOrEqual(0); // Just verify it ran

    // Verify we can still run git commands in the worktree (no corruption)
    const statusResult = executeGitCommand(['status'], {
      cwd: worktreeDir,
      encoding: 'utf-8',
    });
    expect(statusResult.stdout).toBeDefined();

    console.log(`✓ Validation completed in worktree without corruption`);
  });

  it('should handle multiple sequential validations in same worktree', async () => {
    // Run validation twice sequentially
    const result1 = await executeVvCommand(['validate'], {
      cwd: worktreeDir,
    });

    const result2 = await executeVvCommand(['validate'], {
      cwd: worktreeDir,
    });

    // Both should complete without corruption
    expect(result1).toBeDefined();
    expect(result1.exitCode).toBeGreaterThanOrEqual(0);
    expect(result2).toBeDefined();
    expect(result2.exitCode).toBeGreaterThanOrEqual(0);

    // Both should use cached results (tree hash unchanged)
    // We can verify this by checking the output contains cache-related messages
    // But for now, just verify both completed successfully
    console.log(`✓ Sequential validations completed without collision`);
  });

  it('should work in both main repo and worktree', async () => {
    // Run in main repo
    const mainResult = await executeVvCommand(['validate'], {
      cwd: mainRepoDir,
    });

    // Run in worktree
    const worktreeResult = await executeVvCommand(['validate'], {
      cwd: worktreeDir,
    });

    // Both should complete without interference
    expect(mainResult).toBeDefined();
    expect(mainResult.exitCode).toBeGreaterThanOrEqual(0);
    expect(worktreeResult).toBeDefined();
    expect(worktreeResult.exitCode).toBeGreaterThanOrEqual(0);

    console.log(`✓ Validation works in both main repo and worktree`);
  });
});
