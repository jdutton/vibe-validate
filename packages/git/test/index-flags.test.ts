/**
 * Tests for {@link findTrustFlaggedEntries}, against index files written by a
 * real `git`.
 *
 * The parser reads git's on-disk index format, so the only fixtures worth
 * trusting are ones git itself produced: each version (2, 3, 4), each hash
 * (SHA-1, SHA-256), and the layouts the parser must refuse rather than misread
 * (split index, garbage, truncation).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeGitCommand } from '../src/git-executor.js';
import { findTrustFlaggedEntries, type TrustFlaggedEntry } from '../src/index-flags.js';
import { commitTestChanges, configTestUser, stageTestFiles } from '../src/test-helpers.js';

/**
 * Run git in a fixture repository.
 *
 * @param repo - Fixture directory
 * @param args - Arguments after the binary
 * @returns Trimmed stdout
 */
function git(repo: string, args: string[]): string {
  return executeGitCommand(args, { cwd: repo }).stdout;
}

/**
 * Create a repository holding `files`, all committed.
 *
 * @param repo - Directory to create it in
 * @param files - Root-relative path to contents
 * @param initArgs - Extra `git init` arguments (e.g. the object format)
 */
function createRepoWith(repo: string, files: Record<string, string>, initArgs: string[] = []): void {
  executeGitCommand(['init', '-q', ...initArgs, '.'], { cwd: repo });
  configTestUser(repo, 'test@example.com', 'Test');
  for (const [path, contents] of Object.entries(files)) {
    mkdirSyncReal(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), contents);
  }
  stageTestFiles(repo);
  commitTestChanges(repo, 'init');
}

/**
 * The repository's real index bytes.
 *
 * @param repo - Fixture directory
 * @returns The `.git/index` file contents
 */
function readIndex(repo: string): Buffer {
  return readFileSync(join(repo, '.git', 'index'));
}

/**
 * Flagged entries as plain values, for readable assertions.
 *
 * @param entries - Parser output
 * @returns One summary per entry, or null when the parser refused
 */
function summarize(entries: TrustFlaggedEntry[] | null) {
  return entries?.map(e => ({
    path: e.path.toString('utf8'),
    assumeUnchanged: e.assumeUnchanged,
    skipWorktree: e.skipWorktree,
  })) ?? null;
}

const FILES = { 'a.md': 'a\n', 'dir/b.md': 'b\n', 'dir/sub/c.md': 'c\n' };

describe('findTrustFlaggedEntries', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(normalizedTmpdir(), 'vv-index-flags-'));
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('reports nothing for an index with no trust flags', () => {
    createRepoWith(repo, FILES);
    expect(findTrustFlaggedEntries(readIndex(repo))).toEqual([]);
  });

  it('reports an assume-unchanged entry with its mode and object ID', () => {
    createRepoWith(repo, FILES);
    git(repo, ['update-index', '--assume-unchanged', 'dir/b.md']);

    const entries = findTrustFlaggedEntries(readIndex(repo));

    expect(summarize(entries)).toEqual([
      { path: 'dir/b.md', assumeUnchanged: true, skipWorktree: false },
    ]);
    expect(entries?.[0]?.mode).toBe(0o100644);
    expect(entries?.[0]?.oid).toBe(git(repo, ['rev-parse', ':dir/b.md']));
  });

  it('reports a skip-worktree entry (index version 3, extended flags)', () => {
    createRepoWith(repo, FILES);
    git(repo, ['update-index', '--skip-worktree', 'dir/sub/c.md']);
    expect(readIndex(repo).readUInt32BE(4)).toBe(3);

    expect(summarize(findTrustFlaggedEntries(readIndex(repo)))).toEqual([
      { path: 'dir/sub/c.md', assumeUnchanged: false, skipWorktree: true },
    ]);
  });

  it('decodes prefix-compressed paths in index version 4', () => {
    createRepoWith(repo, FILES);
    git(repo, ['update-index', '--index-version', '4']);
    git(repo, ['update-index', '--assume-unchanged', 'dir/sub/c.md']);
    git(repo, ['update-index', '--skip-worktree', 'dir/b.md']);
    expect(readIndex(repo).readUInt32BE(4)).toBe(4);

    expect(summarize(findTrustFlaggedEntries(readIndex(repo)))).toEqual([
      { path: 'dir/b.md', assumeUnchanged: false, skipWorktree: true },
      { path: 'dir/sub/c.md', assumeUnchanged: true, skipWorktree: false },
    ]);
  });

  it('reads SHA-256 indexes, whose object IDs are 32 bytes', () => {
    createRepoWith(repo, FILES, ['--object-format=sha256']);
    git(repo, ['update-index', '--assume-unchanged', 'a.md']);

    const entries = findTrustFlaggedEntries(readIndex(repo));

    expect(summarize(entries)).toEqual([{ path: 'a.md', assumeUnchanged: true, skipWorktree: false }]);
    expect(entries?.[0]?.oid).toMatch(/^[0-9a-f]{64}$/);
    expect(entries?.[0]?.oid).toBe(git(repo, ['rev-parse', ':a.md']));
  });

  it('never reports a sparse-index directory entry', () => {
    createRepoWith(repo, FILES);
    git(repo, ['sparse-checkout', 'set', '--cone', '--sparse-index', 'nothing-here']);

    // `dir/` is now ONE skip-worktree directory entry. It must stay that way:
    // re-adding it would expand nothing and drop the directory's files.
    expect(summarize(findTrustFlaggedEntries(readIndex(repo)))).toEqual([]);
  });

  it('refuses a split index, whose entries live in another file', () => {
    createRepoWith(repo, FILES);
    git(repo, ['update-index', '--split-index']);
    expect(findTrustFlaggedEntries(readIndex(repo))).toBeNull();
  });

  it('refuses bytes that are not an index, or an index cut short', () => {
    createRepoWith(repo, FILES);
    const index = readIndex(repo);

    expect(findTrustFlaggedEntries(Buffer.from('not an index at all'))).toBeNull();
    expect(findTrustFlaggedEntries(index.subarray(0, index.length - 30))).toBeNull();
  });
});
