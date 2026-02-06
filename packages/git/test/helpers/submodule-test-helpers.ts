// packages/git/test/helpers/submodule-test-helpers.ts
/* eslint-disable local/no-child-process-execSync, local/no-fs-mkdirSync, local/no-git-commands-direct -- Test setup requires direct git commands and fs operations */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Creates a git repository with initial commit
 */
export function createGitRepo(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true });
  execSync('git init', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config protocol.file.allow always', { cwd: repoPath, stdio: 'ignore' });
  writeFileSync(join(repoPath, 'README.md'), '# Test');
  execSync('git add .', { cwd: repoPath, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: repoPath, stdio: 'ignore' });
}

/**
 * Creates a submodule git repository
 */
export function createSubmoduleRepo(submodulePath: string, content = 'content'): string {
  mkdirSync(submodulePath, { recursive: true });
  execSync('git init', { cwd: submodulePath, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: submodulePath, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: submodulePath, stdio: 'ignore' });
  writeFileSync(join(submodulePath, 'file.txt'), content);
  execSync('git add .', { cwd: submodulePath, stdio: 'ignore' });
  execSync('git commit -m "init"', { cwd: submodulePath, stdio: 'ignore' });

  // Return commit hash
  return execSync('git rev-parse HEAD', { cwd: submodulePath, encoding: 'utf-8' }).trim();
}

/**
 * Registers a submodule in git index
 */
export function registerSubmodule(commitHash: string, path: string): void {
  execSync(`git update-index --add --cacheinfo 160000,${commitHash},${path}`, { stdio: 'ignore' });
}

/**
 * Creates .gitmodules file with submodule configuration
 */
export function createGitmodulesFile(repoPath: string, submodules: Array<{ path: string; url: string }>): void {
  const content = submodules
    .map(sub => `[submodule "${sub.path}"]\n\tpath = ${sub.path}\n\turl = ${sub.url}\n`)
    .join('');
  writeFileSync(join(repoPath, '.gitmodules'), content);
}

/**
 * Initializes git submodules (registers in .git/config)
 */
export function initSubmodules(): void {
  execSync('git submodule init', { stdio: 'ignore' });
}

/**
 * Sets up a single submodule with full initialization
 * @param testDir - The test directory (main repo root)
 * @param submodulePath - Relative path for the submodule (e.g., 'libs/auth')
 * @param url - URL for .gitmodules (e.g., 'https://github.com/example/auth.git')
 * @param content - Content for the file in the submodule
 */
export function setupSingleSubmodule(
  testDir: string,
  submodulePath: string,
  url: string,
  content = 'content'
): void {
  // Create .gitmodules file
  createGitmodulesFile(testDir, [{ path: submodulePath, url }]);

  // Create submodule directory with git repo
  const fullSubmodulePath = `${testDir}/${submodulePath}`;
  const commitHash = createSubmoduleRepo(fullSubmodulePath, content);

  // Register submodule in git index
  registerSubmodule(commitHash, submodulePath);

  // Initialize submodule
  initSubmodules();
}
