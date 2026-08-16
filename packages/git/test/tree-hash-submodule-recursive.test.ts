// packages/git/test/tree-hash-submodule-recursive.test.ts
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getGitTreeHash, getSubmoduleTreeHash } from '../src/tree-hash.js';

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

  it('hashes the submodule, not the repository an inherited GIT_DIR names', async () => {
    // The severe one. `getSubmoduleTreeHash` moves the process with `chdir` and
    // then calls the *ambient* hasher — but chdir changes where you stand, not
    // what the environment says, and inside a worktree's pre-commit hook git
    // exports an absolute GIT_DIR that outranks the cwd. The submodule hash then
    // silently becomes the PARENT repository's.
    //
    // That is not a cosmetic wrong number. Submodule hashes go into the
    // composite cache key, so every submodule state would key identically and a
    // later run would replay a pass for a tree it never validated.
    setupSingleSubmodule(testDir, 'libs/auth', 'https://github.com/example/auth.git', 'sub content');

    // Taken first, ambiently, while the environment is still clean — this is the
    // value the broken path collapses onto, so the fixture can tell the two
    // apart only because the submodule's content differs from the parent's.
    const parent = await getGitTreeHash();

    const hookEnv = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX'];
    process.env.GIT_DIR = join(testDir, '.git');
    process.env.GIT_WORK_TREE = testDir;
    process.env.GIT_INDEX_FILE = join(testDir, '.git', 'index');
    process.env.GIT_PREFIX = '';

    try {
      const sub = await getSubmoduleTreeHash('libs/auth');
      expect(sub.hash).not.toBe(parent.hash);
    } finally {
      for (const key of hookEnv) delete process.env[key];
    }
    // Two full recursive hashes of a real submodule fixture, and its siblings
    // here already run 11-21s on an unloaded machine. The default 30s is a
    // machine-speed assertion, not a correctness one.
  }, 120_000);

  it('should return to original cwd after calculating hash', async () => {
    setupSingleSubmodule(testDir, 'libs/auth', 'https://github.com/example/auth.git');

    const cwdBefore = process.cwd();
    await getSubmoduleTreeHash('libs/auth');
    const cwdAfter = process.cwd();

    expect(cwdAfter).toBe(cwdBefore);
  });
});
