/**
 * The nested `vv run` cache, end to end through the command's own lookup and
 * store (tryGetCachedResult / storeCacheResult), over an in-memory notes store
 *
 * - The key covers submodule hashes: a change inside a submodule leaves the
 *   parent tree hash unchanged, so a key on the parent alone hits an old green.
 * - A stored failure is refused by the lookup itself, not only by the note parser.
 * - A red run removes the green stored for its key, so a `--force` re-check that
 *   goes red is not answered by the green it re-checked.
 *
 * Exit codes are not observable in-process (the command's catch absorbs the
 * mocked process.exit), so these assert what the command printed: a cache hit
 * is marked `isCachedResult: true`, an execution is not. The command really
 * executes (a harmless `echo`); only git is faked.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as core from '@vibe-validate/core';
import * as git from '@vibe-validate/git';
import { normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import yaml from 'yaml';

import { runCommand } from '../../src/commands/run.js';
import { setupCommanderTest } from '../helpers/commander-test-setup.js';

vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual<typeof git>('@vibe-validate/git');
  return {
    ...actual,
    getGitTreeHash: vi.fn(),
    readNote: vi.fn(),
    addNote: vi.fn(),
    removeNote: vi.fn(),
  };
});

vi.mock('@vibe-validate/core', async () => {
  const actual = await vi.importActual<typeof core>('@vibe-validate/core');
  return {
    ...actual,
    getGitRoot: vi.fn(),
  };
});

const TREE = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' as git.TreeHash;
const SUB_V1 = { 'libs/shared': '1111111111111111111111111111111111111111' as git.TreeHash };
const SUB_V2 = { 'libs/shared': '2222222222222222222222222222222222222222' as git.TreeHash };
const COMMAND = 'echo hello';
const CACHE_HIT = 'isCachedResult: true';
const CACHE_MISS = 'No cached result found';

/** Notes by ref path, as git would hold them */
let notes: Map<string, string>;
/** The worktree's current submodule hashes (undefined: no submodules) */
let submodules: Record<string, git.TreeHash> | undefined;

function setTree(submoduleHashes?: Record<string, git.TreeHash>): void {
  submodules = submoduleHashes;
}

/**
 * Fake git: the tree hash, and notes read from / written to `notes`.
 * Installed per run: setupCommanderTest's cleanup restores every mock.
 */
function installFakeGit(): void {
  vi.mocked(git.getGitTreeHash).mockResolvedValue({
    hash: TREE,
    ...(submodules ? { submoduleHashes: submodules } : {}),
  });
  vi.mocked(git.addNote).mockImplementation((ref, _object, content) => {
    notes.set(ref, content);
    return true;
  });
  vi.mocked(git.readNote).mockImplementation((ref) => notes.get(ref) ?? null);
  vi.mocked(git.removeNote).mockImplementation((ref) => notes.delete(ref));
  // Invoked from the repo root: the cache key's workdir is ''
  vi.mocked(core.getGitRoot).mockReturnValue(process.cwd());
}

/** Run `vv run <args>` in a fresh program; returns what it wrote to stdout and stderr */
async function vvRun(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const env = setupCommanderTest();
  installFakeGit();
  try {
    runCommand(env.program);
    await env.program.parseAsync(['run', ...args], { from: 'user' });
  } catch {
    // The mocked process.exit throws; what the command printed is the evidence
  }
  const written = (stream: NodeJS.WriteStream) => vi.mocked(stream.write).mock.calls.map(call => String(call[0])).join('');
  const output = { stdout: written(process.stdout), stderr: written(process.stderr) };
  env.cleanup();
  return output;
}

/** `vv run` the (passing) command once; true when it really executed, false for a cache hit */
async function runOnce(): Promise<boolean> {
  const { stdout } = await vvRun([COMMAND]);
  expect(stdout).toContain('exitCode: 0');
  return !stdout.includes(CACHE_HIT);
}

describe('vv run cache key and lookup', () => {
  beforeEach(() => {
    notes = new Map();
    submodules = undefined;
    delete process.env.VV_PARENT_CONTEXT;
    delete process.env.VV_FORCE_EXECUTION;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the plain key for a repo without submodules', async () => {
    setTree();
    expect(await runOnce()).toBe(true);

    expect([...notes.keys()]).toEqual([`vibe-validate/run/${TREE}/${git.encodeRunCacheKey(COMMAND, '')}`]);
  });

  it('hits the stored green while the submodules are unchanged', async () => {
    setTree(SUB_V1);
    expect(await runOnce()).toBe(true);

    expect((await vvRun(['--check', COMMAND])).stdout).toContain(CACHE_HIT);
    expect(await runOnce()).toBe(false);
  });

  it('misses after a change inside a submodule, though the parent tree hash is the same', async () => {
    setTree(SUB_V1);
    expect(await runOnce()).toBe(true);

    setTree(SUB_V2);
    const check = await vvRun(['--check', COMMAND]);
    expect(check.stderr).toContain(CACHE_MISS);
    expect(check.stdout).not.toContain(CACHE_HIT);
    // ...and a plain run executes the command instead of replaying the old green
    expect(await runOnce()).toBe(true);
  });

  it('a green stored without submodules does not answer once the tree has them', async () => {
    setTree();
    expect(await runOnce()).toBe(true);

    setTree(SUB_V1);
    expect((await vvRun(['--check', COMMAND])).stderr).toContain(CACHE_MISS);
  });

  it('refuses a stored failure through the lookup itself, and runs the command', async () => {
    setTree(SUB_V1);
    // Find the ref this tree's lookup reads by storing a pass, then overwrite it with a failure
    expect(await runOnce()).toBe(true);
    expect(notes.size).toBe(1);
    const [ref] = [...notes.keys()];
    notes.set(ref, yaml.stringify({
      treeHash: TREE,
      command: COMMAND,
      workdir: '',
      timestamp: '2026-11-01T00:00:00.000Z',
      exitCode: 1,
      durationSecs: 1,
    }));

    const check = await vvRun(['--check', COMMAND]);
    expect(check.stderr).toContain(CACHE_MISS);
    expect(check.stdout).not.toContain(CACHE_HIT);
    expect(await runOnce()).toBe(true);
  });

  it('a forced red removes the green it re-checked, so the next run executes', async () => {
    const dir = mkdtempSync(join(normalizedTmpdir(), 'vv-run-red-'));
    try {
      const flag = join(dir, 'fail');
      const script = join(dir, 'check.cjs');
      writeFileSync(script, `process.exit(require('node:fs').existsSync(${JSON.stringify(flag)}) ? 1 : 0);`);
      const command = `node ${JSON.stringify(script)}`;
      setTree();

      expect((await vvRun([command])).stdout).toContain('exitCode: 0');
      expect((await vvRun([command])).stdout).toContain(CACHE_HIT);

      writeFileSync(flag, '');
      expect((await vvRun(['--force', command])).stdout).toContain('exitCode: 1');
      // --force propagates to nested runs through the environment; this is a fresh invocation
      delete process.env.VV_FORCE_EXECUTION;

      const next = await vvRun([command]);
      expect(next.stdout).not.toContain(CACHE_HIT);
      expect(next.stdout).toContain('exitCode: 1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
