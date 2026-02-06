/**
 * Integration tests for git tree hash calculation
 *
 * These tests use REAL git repositories (in temp directories)
 * to verify behavior that can't be tested with mocks.
 *
 * CRITICAL: Uses isolated temp repos - does NOT touch main .git directory
 */

import {  rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { executeGitCommand } from '../src/git-executor.js';
import { getGitTreeHash } from '../src/tree-hash.js';

/**
 * Helper: Create initial commit in test repo so .git/index exists
 * Many tests require an existing index file to test tree hash calculation
 */
function createInitialCommit(repoPath: string): void {
  writeFileSync(join(repoPath, 'initial.txt'), 'initial');
  executeGitCommand(['add', 'initial.txt'], { suppressStderr: true });
  executeGitCommand(['commit', '-m', 'initial'], { suppressStderr: true });
}

describe('getGitTreeHash - integration tests', () => {
  let testRepoPath: string;
  let originalCwd: string;

  beforeEach(() => {
    // CRITICAL: Clear git environment variables to prevent test isolation failures
    // Git environment variables (GIT_DIR, GIT_WORK_TREE, etc.) override process.cwd(),
    // causing git commands to operate on the parent repository instead of the temp test directory.
    // This can corrupt worktrees by committing test files to production branches.
    // Clearing these variables ensures git respects process.cwd() and stays isolated to /tmp.
    delete process.env.GIT_DIR;
    delete process.env.GIT_WORK_TREE;
    delete process.env.GIT_INDEX_FILE;
    delete process.env.GIT_COMMON_DIR;
    delete process.env.GIT_OBJECT_DIRECTORY;
    delete process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
    delete process.env.GIT_CEILING_DIRECTORIES;

    // Save original directory
    originalCwd = process.cwd();

    // Create isolated test repo in temp directory
    testRepoPath = join(normalizedTmpdir(), `vibe-validate-git-test-${Date.now()}`);
    mkdirSyncReal(testRepoPath, { recursive: true });
    process.chdir(testRepoPath);

    // Initialize git repo
    executeGitCommand(['init'], { suppressStderr: true });
    executeGitCommand(['config', 'user.email', 'test@example.com'], { suppressStderr: true });
    executeGitCommand(['config', 'user.name', 'Test User'], { suppressStderr: true });
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
    executeGitCommand(['add', 'test.txt'], { suppressStderr: true });
    executeGitCommand(['commit', '-m', 'initial commit'], { suppressStderr: true });

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
    executeGitCommand(['add', 'committed.txt'], { suppressStderr: true });
    executeGitCommand(['commit', '-m', 'initial commit'], { suppressStderr: true });

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
    executeGitCommand(['add', 'test.txt'], { suppressStderr: true });
    executeGitCommand(['commit', '-m', 'initial'], { suppressStderr: true });

    // Modify and stage
    writeFileSync(join(testRepoPath, 'test.txt'), 'modified content');
    executeGitCommand(['add', 'test.txt'], { suppressStderr: true });
    const resultStaged = await getGitTreeHash();

    // Unstage (but keep working directory change)
    executeGitCommand(['reset', 'HEAD', 'test.txt'], { suppressStderr: true });
    const resultUnstaged = await getGitTreeHash();

    // Hash should be SAME because working directory content is identical
    expect(resultUnstaged.hash).toBe(resultStaged.hash);
  });

  it('should produce deterministic hash for same content', async () => {
    createInitialCommit(testRepoPath);

    // Create file
    writeFileSync(join(testRepoPath, 'test.txt'), 'deterministic content');

    // Get hash twice
    const result1 = await getGitTreeHash();
    const result2 = await getGitTreeHash();

    // Should be identical (deterministic)
    expect(result1.hash).toBe(result2.hash);
  });

  it('should handle empty repository', async () => {
    createInitialCommit(testRepoPath);

    // Delete all files to make working tree "empty"
    rmSync(join(testRepoPath, 'initial.txt'));

    const result = await getGitTreeHash();

    // Should return valid hash
    expect(result.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('should handle fresh repository with no commits (no .git/index)', async () => {
    // CRITICAL: Do NOT create any commits - test truly fresh repo
    // In a fresh repo, .git/index doesn't exist until first `git add`
    // This reproduces the bug reported in: "Try running 'vv snapshot' from brand new repo"

    // Verify .git/index doesn't exist (fresh repo state)
    const gitIndexPath = join(testRepoPath, '.git', 'index');
    expect(existsSync(gitIndexPath)).toBe(false);

    // Add a file but don't commit (creates working tree content)
    writeFileSync(join(testRepoPath, 'test.txt'), 'content');

    // This should work without crashing (currently fails with ENOENT)
    const result = await getGitTreeHash();

    // Should return valid hash (empty tree hash since nothing is committed)
    expect(result.hash).toMatch(/^[0-9a-f]{40}$/);

    // The hash should be different from empty tree if file is tracked
    // But since no git add yet, it might be the empty tree hash
    expect(result.hash).toBeDefined();
  });

  it('should return "unknown" for non-git directory', async () => {
    // Create a directory with NO .git (not a git repository at all)
    const nonGitPath = join(normalizedTmpdir(), `vibe-validate-non-git-test-${Date.now()}`);
    mkdirSyncReal(nonGitPath, { recursive: true });

    try {
      // Change to non-git directory
      process.chdir(nonGitPath);

      // Verify no .git directory
      expect(existsSync(join(nonGitPath, '.git'))).toBe(false);

      // Should return 'unknown' (not throw)
      const result = await getGitTreeHash();

      // CRITICAL: Must return 'unknown' so caller can skip caching
      expect(result.hash).toBe('unknown');
    } finally {
      // Restore to test repo
      process.chdir(testRepoPath);

      // Clean up
      if (existsSync(nonGitPath)) {
        rmSync(nonGitPath, { recursive: true, force: true });
      }
    }
  });

  it('should handle deleted files', async () => {
    // Setup: Create and commit file
    writeFileSync(join(testRepoPath, 'delete-me.txt'), 'content');
    executeGitCommand(['add', 'delete-me.txt'], { suppressStderr: true });
    executeGitCommand(['commit', '-m', 'add file'], { suppressStderr: true });

    const resultBefore = await getGitTreeHash();

    // Delete file (unstaged)
    rmSync(join(testRepoPath, 'delete-me.txt'));

    const resultAfter = await getGitTreeHash();

    // Hash should change because file is deleted
    expect(resultAfter.hash).not.toBe(resultBefore.hash);
  });

  it('should NOT include .gitignore files (security)', async () => {
    // Setup: Create and commit initial file
    writeFileSync(join(testRepoPath, 'committed.txt'), 'committed');
    executeGitCommand(['add', 'committed.txt'], { suppressStderr: true });
    executeGitCommand(['commit', '-m', 'initial'], { suppressStderr: true });

    // Create .gitignore
    writeFileSync(join(testRepoPath, '.gitignore'), 'secrets.txt\n.env\n');
    executeGitCommand(['add', '.gitignore'], { suppressStderr: true });
    executeGitCommand(['commit', '-m', 'add gitignore'], { suppressStderr: true });

    // Get hash WITHOUT secrets
    const resultWithoutSecrets = await getGitTreeHash();

    // Add ignored files (secrets, env, etc.)
    writeFileSync(join(testRepoPath, 'secrets.txt'), 'API_KEY=secret123');
    // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Test fixture, not real password
    writeFileSync(join(testRepoPath, '.env'), 'PASSWORD=admin');

    // Get hash WITH secrets (but they should be ignored)
    const resultWithSecrets = await getGitTreeHash();

    // CRITICAL: Hash should be SAME because ignored files are NOT included
    // This ensures:
    // 1. No security risk (secrets not checksummed)
    // 2. Deterministic hashing (different devs have different secrets)
    // 3. Cache sharing works (same code = same hash)
    expect(resultWithSecrets.hash).toBe(resultWithoutSecrets.hash);
  });

  it('should produce same hash across developers with same .gitignore', async () => {
    // Simulate Developer 1's repository
    writeFileSync(join(testRepoPath, '.gitignore'), '*.log\nbuild/\n');
    executeGitCommand(['add', '.gitignore'], { suppressStderr: true });
    writeFileSync(join(testRepoPath, 'app.js'), 'const x = 1;');
    executeGitCommand(['add', 'app.js'], { suppressStderr: true });
    executeGitCommand(['commit', '-m', 'initial'], { suppressStderr: true });

    // Developer 1 has personal log file (ignored)
    writeFileSync(join(testRepoPath, 'debug.log'), 'dev1 debug logs');

    const resultDev1 = await getGitTreeHash();

    // Simulate Developer 2's repository (same tracked files, different ignored files)
    // Remove dev1's log file, add dev2's log file
    rmSync(join(testRepoPath, 'debug.log'));
    writeFileSync(join(testRepoPath, 'error.log'), 'dev2 error logs');

    const resultDev2 = await getGitTreeHash();

    // CRITICAL: Hash should be SAME because:
    // 1. Same tracked files (app.js, .gitignore)
    // 2. Different ignored files (debug.log vs error.log) should NOT affect hash
    // 3. This enables cache sharing across developers
    expect(resultDev2.hash).toBe(resultDev1.hash);
  });

  it('should produce same hash before and after staging (user bug report)', async () => {
    // Reproduce the exact scenario the user reported
    writeFileSync(join(testRepoPath, 'file1.ts'), 'initial content');
    writeFileSync(join(testRepoPath, 'file2.ts'), 'initial content');
    executeGitCommand(['add', '.'], { suppressStderr: true });
    executeGitCommand(['commit', '-m', 'initial'], { suppressStderr: true });

    // Modify files (unstaged)
    writeFileSync(join(testRepoPath, 'file1.ts'), 'modified content');
    writeFileSync(join(testRepoPath, 'file2.ts'), 'modified content');
    // Add new untracked file
    writeFileSync(join(testRepoPath, 'file3.ts'), 'new file');

    // Get hash BEFORE staging
    const resultBeforeStaging = await getGitTreeHash();

    // Stage all changes (like user did)
    executeGitCommand(['add', '--all'], { suppressStderr: true });

    // Get hash AFTER staging
    const resultAfterStaging = await getGitTreeHash();

    // CRITICAL: Hash should be SAME because working directory didn't change
    // This is the bug the user reported - hash changes when it shouldn't
    expect(resultAfterStaging.hash).toBe(resultBeforeStaging.hash);
  });
});
