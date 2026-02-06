// packages/git/test/tree-hash-submodules.test.ts
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getSubmodules, type SubmoduleInfo } from '../src/tree-hash.js';

import {
  createGitRepo,
  createSubmoduleRepo,
  registerSubmodule,
  createGitmodulesFile,
  initSubmodules,
  setupSingleSubmodule,
} from './helpers/submodule-test-helpers.js';

describe('getSubmodules', () => {
  const testDir = join(process.cwd(), 'test-fixtures', 'submodules-test');

  beforeEach(() => {
    // Clean up if exists
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors - directory might not exist yet
    }

    // Create test repo
    createGitRepo(testDir);
    process.chdir(testDir);
  });

  afterEach(() => {
    // Return to original directory
    process.chdir(join(process.cwd(), '../../../..'));

    // Clean up
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors - directory might be in use
    }
  });

  it('should return empty array when no submodules exist', () => {
    const submodules = getSubmodules();
    expect(submodules).toEqual([]);
  });

  it('should detect single submodule', () => {
    setupSingleSubmodule(testDir, 'libs/auth', 'https://github.com/example/auth.git');

    const submodules = getSubmodules();
    expect(submodules).toHaveLength(1);
    expect(submodules[0].path).toBe('libs/auth');
  });

  it('should detect multiple submodules', () => {
    // Create .gitmodules file with two submodules
    createGitmodulesFile(testDir, [
      { path: 'libs/auth', url: 'https://github.com/example/auth.git' },
      { path: 'vendor/foo', url: 'https://github.com/example/foo.git' },
    ]);

    // Create first submodule directory with git repo
    const submodulePath1 = join(testDir, 'libs/auth');
    const commitHash1 = createSubmoduleRepo(submodulePath1);

    // Create second submodule directory with git repo
    const submodulePath2 = join(testDir, 'vendor/foo');
    const commitHash2 = createSubmoduleRepo(submodulePath2);

    // Register submodules in git index
    registerSubmodule(commitHash1, 'libs/auth');
    registerSubmodule(commitHash2, 'vendor/foo');

    // Initialize submodules
    initSubmodules();

    const submodules = getSubmodules();
    expect(submodules).toHaveLength(2);

    const paths = submodules.map((s: SubmoduleInfo) => s.path).sort((a, b) => a.localeCompare(b));
    expect(paths).toEqual(['libs/auth', 'vendor/foo']);
  });
});
