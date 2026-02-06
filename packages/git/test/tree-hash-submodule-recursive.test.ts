// packages/git/test/tree-hash-submodule-recursive.test.ts
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getSubmoduleTreeHash } from '../src/tree-hash.js';

import {
  createGitRepo,
  setupSingleSubmodule,
} from './helpers/submodule-test-helpers.js';

describe('getSubmoduleTreeHash', () => {
  const testDir = join(process.cwd(), 'test-fixtures', 'submodule-recursive-test');
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();

    // Clean up
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors - directory might not exist yet
    }

    // Create main repo
    createGitRepo(testDir);
    process.chdir(testDir);
    writeFileSync('main.txt', 'main content');
  });

  afterEach(() => {
    process.chdir(originalCwd);

    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors - directory might be in use
    }
  });

  it('should calculate tree hash for submodule', async () => {
    setupSingleSubmodule(testDir, 'libs/auth', 'https://github.com/example/auth.git', 'sub content');

    const result = await getSubmoduleTreeHash('libs/auth');

    expect(result).toBeDefined();
    expect(result.hash).toBeDefined();
    expect(typeof result.hash).toBe('string');
    expect(result.hash.length).toBeGreaterThan(0);
  });

  it('should return to original cwd after calculating hash', async () => {
    setupSingleSubmodule(testDir, 'libs/auth', 'https://github.com/example/auth.git');

    const cwdBefore = process.cwd();
    await getSubmoduleTreeHash('libs/auth');
    const cwdAfter = process.cwd();

    expect(cwdAfter).toBe(cwdBefore);
  });
});
