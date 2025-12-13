/**
 * Integration tests for git tree hash calculation
 *
 * These tests use REAL git repositories (in temp directories)
 * to verify behavior that can't be tested with mocks.
 *
 * CRITICAL: Uses isolated temp repos - does NOT touch main .git directory
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { safeExecSync } from '../src/safe-exec.js';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGitTreeHash } from '../src/tree-hash.js';

describe('getGitTreeHash - integration tests', () => {
  let testRepoPath: string;
  let originalCwd: string;

  beforeEach(() => {
    // Save original directory
    originalCwd = process.cwd();

    // Create isolated test repo in temp directory
    testRepoPath = join(tmpdir(), `vibe-validate-git-test-${Date.now()}`);
    mkdirSync(testRepoPath, { recursive: true });
    process.chdir(testRepoPath);

    // Initialize git repo
    safeExecSync('git', ['init'], { stdio: 'pipe' });
    safeExecSync('git', ['config', 'user.email', 'test@example.com'], { stdio: 'pipe' });
    safeExecSync('git', ['config', 'user.name', 'Test User'], { stdio: 'pipe' });
  });

  afterEach(() => {
    // Restore original directory
    process.chdir(originalCwd);

    // Clean up test repo
    if (existsSync(testRepoPath)) {
      rmSync(testRepoPath, { recursive: true, force: true });
    }
  });

  it('should detect unstaged modifications to tracked files', async () => {
    // Setup: Create and commit initial file
    writeFileSync(join(testRepoPath, 'test.txt'), 'version 1');
    safeExecSync('git', ['add', 'test.txt'], { stdio: 'pipe' });
    safeExecSync('git', ['commit', '-m', 'initial commit'], { stdio: 'pipe' });

    // Get hash for committed state
    const hashCommitted = await getGitTreeHash();

    // Modify file WITHOUT staging
    writeFileSync(join(testRepoPath, 'test.txt'), 'version 2 - modified');

    // Get hash for modified state
    const hashModified = await getGitTreeHash();

    // BUG REPRODUCTION: This test will FAIL because tree hash
    // doesn't include unstaged content (only uses --intent-to-add)
    expect(hashModified).not.toBe(hashCommitted);
  });

  it('should detect new untracked files', async () => {
    // Setup: Create and commit initial file
    writeFileSync(join(testRepoPath, 'committed.txt'), 'committed content');
    safeExecSync('git', ['add', 'committed.txt'], { stdio: 'pipe' });
    safeExecSync('git', ['commit', '-m', 'initial commit'], { stdio: 'pipe' });

    // Get hash for committed state
    const hashBefore = await getGitTreeHash();

    // Add new untracked file
    writeFileSync(join(testRepoPath, 'untracked.txt'), 'new file');

    // Get hash with untracked file
    const hashAfter = await getGitTreeHash();

    // Hash should change because working tree has new file
    expect(hashAfter).not.toBe(hashBefore);
  });

  it('should produce same hash for same content regardless of staging', async () => {
    // Setup: Create file
    writeFileSync(join(testRepoPath, 'test.txt'), 'content');
    safeExecSync('git', ['add', 'test.txt'], { stdio: 'pipe' });
    safeExecSync('git', ['commit', '-m', 'initial'], { stdio: 'pipe' });

    // Modify and stage
    writeFileSync(join(testRepoPath, 'test.txt'), 'modified content');
    safeExecSync('git', ['add', 'test.txt'], { stdio: 'pipe' });
    const hashStaged = await getGitTreeHash();

    // Unstage (but keep working directory change)
    safeExecSync('git', ['reset', 'HEAD', 'test.txt'], { stdio: 'pipe' });
    const hashUnstaged = await getGitTreeHash();

    // Hash should be SAME because working directory content is identical
    expect(hashUnstaged).toBe(hashStaged);
  });

  it('should produce deterministic hash for same content', async () => {
    // Create initial commit so index exists
    writeFileSync(join(testRepoPath, 'initial.txt'), 'initial');
    safeExecSync('git', ['add', 'initial.txt'], { stdio: 'pipe' });
    safeExecSync('git', ['commit', '-m', 'initial'], { stdio: 'pipe' });

    // Create file
    writeFileSync(join(testRepoPath, 'test.txt'), 'deterministic content');

    // Get hash twice
    const hash1 = await getGitTreeHash();
    const hash2 = await getGitTreeHash();

    // Should be identical (deterministic)
    expect(hash1).toBe(hash2);
  });

  it('should handle empty repository', async () => {
    // Create initial commit so index exists
    writeFileSync(join(testRepoPath, 'initial.txt'), 'initial');
    safeExecSync('git', ['add', 'initial.txt'], { stdio: 'pipe' });
    safeExecSync('git', ['commit', '-m', 'initial'], { stdio: 'pipe' });

    // Delete all files to make working tree "empty"
    rmSync(join(testRepoPath, 'initial.txt'));

    const hash = await getGitTreeHash();

    // Should return valid hash
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('should handle deleted files', async () => {
    // Setup: Create and commit file
    writeFileSync(join(testRepoPath, 'delete-me.txt'), 'content');
    safeExecSync('git', ['add', 'delete-me.txt'], { stdio: 'pipe' });
    safeExecSync('git', ['commit', '-m', 'add file'], { stdio: 'pipe' });

    const hashBefore = await getGitTreeHash();

    // Delete file (unstaged)
    rmSync(join(testRepoPath, 'delete-me.txt'));

    const hashAfter = await getGitTreeHash();

    // Hash should change because file is deleted
    expect(hashAfter).not.toBe(hashBefore);
  });

  it('should NOT include .gitignore files (security)', async () => {
    // Setup: Create and commit initial file
    writeFileSync(join(testRepoPath, 'committed.txt'), 'committed');
    safeExecSync('git', ['add', 'committed.txt'], { stdio: 'pipe' });
    safeExecSync('git', ['commit', '-m', 'initial'], { stdio: 'pipe' });

    // Create .gitignore
    writeFileSync(join(testRepoPath, '.gitignore'), 'secrets.txt\n.env\n');
    safeExecSync('git', ['add', '.gitignore'], { stdio: 'pipe' });
    safeExecSync('git', ['commit', '-m', 'add gitignore'], { stdio: 'pipe' });

    // Get hash WITHOUT secrets
    const hashWithoutSecrets = await getGitTreeHash();

    // Add ignored files (secrets, env, etc.)
    writeFileSync(join(testRepoPath, 'secrets.txt'), 'API_KEY=secret123');
    // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Test fixture, not real password
    writeFileSync(join(testRepoPath, '.env'), 'PASSWORD=admin');

    // Get hash WITH secrets (but they should be ignored)
    const hashWithSecrets = await getGitTreeHash();

    // CRITICAL: Hash should be SAME because ignored files are NOT included
    // This ensures:
    // 1. No security risk (secrets not checksummed)
    // 2. Deterministic hashing (different devs have different secrets)
    // 3. Cache sharing works (same code = same hash)
    expect(hashWithSecrets).toBe(hashWithoutSecrets);
  });

  it('should produce same hash across developers with same .gitignore', async () => {
    // Simulate Developer 1's repository
    writeFileSync(join(testRepoPath, '.gitignore'), '*.log\nbuild/\n');
    safeExecSync('git', ['add', '.gitignore'], { stdio: 'pipe' });
    writeFileSync(join(testRepoPath, 'app.js'), 'const x = 1;');
    safeExecSync('git', ['add', 'app.js'], { stdio: 'pipe' });
    safeExecSync('git', ['commit', '-m', 'initial'], { stdio: 'pipe' });

    // Developer 1 has personal log file (ignored)
    writeFileSync(join(testRepoPath, 'debug.log'), 'dev1 debug logs');

    const hashDev1 = await getGitTreeHash();

    // Simulate Developer 2's repository (same tracked files, different ignored files)
    // Remove dev1's log file, add dev2's log file
    rmSync(join(testRepoPath, 'debug.log'));
    writeFileSync(join(testRepoPath, 'error.log'), 'dev2 error logs');

    const hashDev2 = await getGitTreeHash();

    // CRITICAL: Hash should be SAME because:
    // 1. Same tracked files (app.js, .gitignore)
    // 2. Different ignored files (debug.log vs error.log) should NOT affect hash
    // 3. This enables cache sharing across developers
    expect(hashDev2).toBe(hashDev1);
  });

  it('should produce same hash before and after staging (user bug report)', async () => {
    // Reproduce the exact scenario the user reported
    writeFileSync(join(testRepoPath, 'file1.ts'), 'initial content');
    writeFileSync(join(testRepoPath, 'file2.ts'), 'initial content');
    safeExecSync('git', ['add', '.'], { stdio: 'pipe' });
    safeExecSync('git', ['commit', '-m', 'initial'], { stdio: 'pipe' });

    // Modify files (unstaged)
    writeFileSync(join(testRepoPath, 'file1.ts'), 'modified content');
    writeFileSync(join(testRepoPath, 'file2.ts'), 'modified content');
    // Add new untracked file
    writeFileSync(join(testRepoPath, 'file3.ts'), 'new file');

    // Get hash BEFORE staging
    const hashBeforeStaging = await getGitTreeHash();

    // Stage all changes (like user did)
    safeExecSync('git', ['add', '--all'], { stdio: 'pipe' });

    // Get hash AFTER staging
    const hashAfterStaging = await getGitTreeHash();

    // CRITICAL: Hash should be SAME because working directory didn't change
    // This is the bug the user reported - hash changes when it shouldn't
    expect(hashAfterStaging).toBe(hashBeforeStaging);
  });
});
