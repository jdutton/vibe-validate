// packages/git/test/helpers/submodule-test-helpers.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mkdirSyncReal } from '@vibe-validate/utils';

import {
  commitTestChanges,
  configTestSubmoduleProtocol,
  configTestUser,
  getTestCommitHash,
  initTestRepo,
  initTestSubmodules,
  registerTestSubmodule,
  stageTestFiles,
} from '../../src/test-helpers.js';

/**
 * Creates a git repository with initial commit
 */
export function createGitRepo(repoPath: string): void {
  mkdirSyncReal(repoPath, { recursive: true });
  initTestRepo(repoPath);
  configTestUser(repoPath, 'test@example.com', 'Test');
  configTestSubmoduleProtocol(repoPath);
  writeFileSync(join(repoPath, 'README.md'), '# Test');
  stageTestFiles(repoPath);
  commitTestChanges(repoPath, 'initial commit');
}

/**
 * Creates a submodule git repository
 */
export function createSubmoduleRepo(submodulePath: string, content = 'content'): string {
  mkdirSyncReal(submodulePath, { recursive: true });
  initTestRepo(submodulePath);
  configTestUser(submodulePath, 'test@example.com', 'Test');
  writeFileSync(join(submodulePath, 'file.txt'), content);
  stageTestFiles(submodulePath);
  commitTestChanges(submodulePath, 'init');

  // Return commit hash
  return getTestCommitHash(submodulePath);
}

/**
 * Registers a submodule in git index
 */
export function registerSubmodule(commitHash: string, path: string): void {
  registerTestSubmodule(process.cwd(), commitHash, path);
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
  initTestSubmodules(process.cwd());
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
