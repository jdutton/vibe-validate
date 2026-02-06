/**
 * Git Test Helpers
 *
 * Centralized git operations for test setup and verification.
 * Single source of truth for git commands in tests.
 *
 * Security: All git command execution happens here, not scattered across tests.
 * Auditability: One place to review for security vulnerabilities.
 * Consistency: All tests use same patterns for git operations.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { safeExecSync, safeExecResult } from '@vibe-validate/utils';

/**
 * Initialize a git repository for testing
 *
 * @param repoPath - Path to initialize as git repo
 *
 * @example
 * const testDir = mkdtempSync(join(tmpdir(), 'test-'));
 * initTestRepo(testDir);
 */
export function initTestRepo(repoPath: string): void {
  safeExecSync('git', ['init'], { cwd: repoPath, stdio: 'pipe' });
}

/**
 * Configure git user for test repository
 *
 * @param repoPath - Path to git repository
 * @param email - User email (default: test@example.com)
 * @param name - User name (default: Test User)
 *
 * @example
 * configTestUser(testDir);
 * configTestUser(testDir, 'custom@example.com', 'Custom User');
 */
export function configTestUser(
  repoPath: string,
  email = 'test@example.com',
  name = 'Test User'
): void {
  safeExecSync('git', ['config', 'user.email', email], { cwd: repoPath, stdio: 'pipe' });
  safeExecSync('git', ['config', 'user.name', name], { cwd: repoPath, stdio: 'pipe' });
}

/**
 * Stage files in test repository
 *
 * @param repoPath - Path to git repository
 * @param files - Files to stage (default: all files)
 *
 * @example
 * stageTestFiles(testDir);
 * stageTestFiles(testDir, ['file1.txt', 'file2.txt']);
 */
export function stageTestFiles(repoPath: string, files: string[] = ['.']): void {
  safeExecSync('git', ['add', ...files], { cwd: repoPath, stdio: 'pipe' });
}

/**
 * Create a commit in test repository
 *
 * @param repoPath - Path to git repository
 * @param message - Commit message
 *
 * @example
 * commitTestChanges(testDir, 'Initial commit');
 */
export function commitTestChanges(repoPath: string, message: string): void {
  safeExecSync('git', ['commit', '-m', message], { cwd: repoPath, stdio: 'pipe' });
}

/**
 * Get tree hash for current HEAD
 *
 * @param repoPath - Path to git repository
 * @returns Tree hash
 *
 * @example
 * const treeHash = getTestTreeHash(testDir);
 */
export function getTestTreeHash(repoPath: string): string {
  const result = safeExecSync('git', ['rev-parse', 'HEAD:'], {
    cwd: repoPath,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  return (result as string).trim();
}

/**
 * Read git note for object
 *
 * @param repoPath - Path to git repository
 * @param notesRef - Notes ref (e.g., 'refs/notes/vibe-validate/validate')
 * @param object - Object hash to read note for
 * @returns Note content or null if not found
 *
 * @example
 * const note = readTestNote(testDir, 'refs/notes/vibe-validate/validate', treeHash);
 */
export function readTestNote(repoPath: string, notesRef: string, object: string): string | null {
  const result = safeExecResult('git', ['notes', '--ref', notesRef, 'show', object], {
    cwd: repoPath,
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    return null;
  }

  return (result.stdout as string).trim();
}

/**
 * Setup a complete test repository with initial commit
 *
 * Combines: init, config user, create file, stage, commit
 *
 * @param repoPath - Path to initialize as git repo
 * @param initialFile - Initial file to create (default: README.md)
 * @param initialContent - Content for initial file (default: "# Test")
 *
 * @example
 * const testDir = mkdtempSync(join(tmpdir(), 'test-'));
 * setupTestRepoWithCommit(testDir);
 */
export function setupTestRepoWithCommit(
  repoPath: string,
  initialFile = 'README.md',
  initialContent = '# Test\n'
): void {
  initTestRepo(repoPath);
  configTestUser(repoPath);

  // Create initial file
  writeFileSync(join(repoPath, initialFile), initialContent);

  stageTestFiles(repoPath);
  commitTestChanges(repoPath, 'Initial commit');
}

/**
 * Configure git submodule protocol settings for local file URLs
 *
 * Required for testing submodules with file:// URLs
 *
 * @param repoPath - Path to git repository
 *
 * @example
 * configTestSubmoduleProtocol(testDir);
 */
export function configTestSubmoduleProtocol(repoPath: string): void {
  safeExecSync('git', ['config', 'protocol.file.allow', 'always'], { cwd: repoPath, stdio: 'pipe' });
}

/**
 * Get current HEAD commit hash
 *
 * @param repoPath - Path to git repository
 * @returns Commit SHA
 *
 * @example
 * const commitHash = getTestCommitHash(testDir);
 */
export function getTestCommitHash(repoPath: string): string {
  const result = safeExecSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoPath,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  return (result as string).trim();
}

/**
 * Register a submodule in git index
 *
 * Low-level operation to add submodule entry without cloning
 *
 * @param repoPath - Path to git repository
 * @param commitHash - Submodule commit hash
 * @param submodulePath - Relative path for submodule
 *
 * @example
 * registerTestSubmodule(testDir, 'abc123...', 'libs/auth');
 */
export function registerTestSubmodule(
  repoPath: string,
  commitHash: string,
  submodulePath: string
): void {
  safeExecSync(
    'git',
    ['update-index', '--add', '--cacheinfo', `160000,${commitHash},${submodulePath}`],
    { cwd: repoPath, stdio: 'pipe' }
  );
}

/**
 * Initialize git submodules (register in .git/config)
 *
 * @param repoPath - Path to git repository
 *
 * @example
 * initTestSubmodules(testDir);
 */
export function initTestSubmodules(repoPath: string): void {
  safeExecSync('git', ['submodule', 'init'], { cwd: repoPath, stdio: 'pipe' });
}

/**
 * Add a submodule to the repository
 *
 * @param repoPath - Path to git repository
 * @param submoduleUrl - URL of submodule repository
 * @param submodulePath - Relative path where submodule should be placed
 *
 * @example
 * addTestSubmodule(testDir, '/tmp/sub-repo', 'libs/auth');
 */
export function addTestSubmodule(
  repoPath: string,
  submoduleUrl: string,
  submodulePath: string
): void {
  safeExecSync(
    'git',
    ['-c', 'protocol.file.allow=always', 'submodule', 'add', submoduleUrl, submodulePath],
    { cwd: repoPath, stdio: 'pipe' }
  );
}
