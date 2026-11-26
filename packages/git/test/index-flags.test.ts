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

/** Where a version-2/3 SHA-1 index's first entry starts, and its field offsets. */
const FIRST_ENTRY = 12;
const FIRST_MODE = FIRST_ENTRY + 24;
const FIRST_FLAGS = FIRST_ENTRY + 40 + 20;
const FIRST_PATH = FIRST_FLAGS + 2;

/**
 * A copy of `index` with `edit` applied, so a test changes one field of a real
 * git index rather than hand-building one.
 *
 * @param index - Bytes git wrote
 * @param edit - Mutates the copy in place
 * @returns The edited copy
 */
function edited(index: Buffer, edit: (copy: Buffer) => void): Buffer {
  const copy = Buffer.from(index);
  edit(copy);
  return copy;
}

/**
 * Cut `index` at every length and require each cut to be declined, or (when it
 * leaves every entry intact plus a hash-sized tail that passes for the
 * checksum, which is not verified) read exactly as the full index.
 *
 * @param index - Bytes git wrote
 */
function expectEveryTruncationSafe(index: Buffer): void {
  const full = summarize(findTrustFlaggedEntries(index));
  expect(full).not.toBeNull();
  let declined = 0;
  for (let length = 0; length < index.length; length++) {
    const result = findTrustFlaggedEntries(index.subarray(0, length));
    if (result === null) declined++;
    else expect(summarize(result), `length ${length}`).toEqual(full);
  }
  expect(declined).toBeGreaterThanOrEqual(index.length - 2);
}

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

  it('decodes a version-4 strip count too large for one varint byte', () => {
    // Stripping 128+ bytes of the previous path takes a two-byte varint.
    const longPath = `a/${'x'.repeat(200)}.md`;
    createRepoWith(repo, { [longPath]: 'long\n', 'b.md': 'b\n' });
    git(repo, ['update-index', '--index-version', '4']);
    git(repo, ['update-index', '--assume-unchanged', 'b.md', longPath]);

    expect(summarize(findTrustFlaggedEntries(readIndex(repo)))).toEqual([
      { path: longPath, assumeUnchanged: true, skipWorktree: false },
      { path: 'b.md', assumeUnchanged: true, skipWorktree: false },
    ]);
    // Including a cut between the two bytes of that varint.
    expectEveryTruncationSafe(readIndex(repo));
  });

  it.each([2, 3, 4])('never misreads or throws on a truncated version-%i index', (version) => {
    createRepoWith(repo, FILES);
    git(repo, ['update-index', '--index-version', String(version)]);
    git(repo, ['update-index', '--assume-unchanged', 'dir/b.md']);
    // Version 3 only stays 3 while an entry needs the extended flags word.
    if (version === 3) git(repo, ['update-index', '--skip-worktree', 'a.md']);
    const index = readIndex(repo);
    expect(index.readUInt32BE(4)).toBe(version);

    // Cut anywhere -- inside a path, the padding, an extension header or the
    // checksum -- the walk must decline rather than misread or throw.
    expectEveryTruncationSafe(index);
  });

  it('refuses an index version it does not know', () => {
    createRepoWith(repo, FILES);
    const index = readIndex(repo);

    expect(findTrustFlaggedEntries(edited(index, copy => copy.writeUInt32BE(1, 4)))).toBeNull();
    expect(findTrustFlaggedEntries(edited(index, copy => copy.writeUInt32BE(5, 4)))).toBeNull();
  });

  it('refuses a version-2 entry whose padding is not all NUL', () => {
    createRepoWith(repo, { 'a.md': 'a\n' });
    const index = readIndex(repo);
    expect(index.readUInt32BE(4)).toBe(2);
    // 62 fixed bytes + 4 path bytes pad to 72: six NULs, the last at 83.
    const lastPad = FIRST_PATH + 'a.md'.length + 5;
    expect(index[lastPad]).toBe(0);

    expect(findTrustFlaggedEntries(edited(index, copy => copy.writeUInt8(1, lastPad)))).toBeNull();
  });

  it('refuses an extended-flags entry in a version-2 index', () => {
    createRepoWith(repo, FILES);
    const index = readIndex(repo);
    expect(index.readUInt32BE(4)).toBe(2);

    // Version 2 has no extended flags word; the bit means the layout is unknown.
    const withExtendedBit = edited(index, copy => copy.writeUInt16BE(copy.readUInt16BE(FIRST_FLAGS) | 0x4000, FIRST_FLAGS));
    expect(findTrustFlaggedEntries(withExtendedBit)).toBeNull();
  });

  it('refuses an entry whose recorded name length disagrees with its path', () => {
    createRepoWith(repo, FILES);
    const index = readIndex(repo);

    expect(findTrustFlaggedEntries(edited(index, copy => copy.writeUInt16BE(copy.readUInt16BE(FIRST_FLAGS) + 1, FIRST_FLAGS)))).toBeNull();
  });

  it('refuses an entry whose mode is not a file, link, gitlink or directory', () => {
    createRepoWith(repo, FILES);
    const index = readIndex(repo);

    expect(findTrustFlaggedEntries(edited(index, copy => copy.writeUInt32BE(0o060_644, FIRST_MODE)))).toBeNull();
  });

  it('refuses a version-4 first entry that strips bytes from a path that does not exist', () => {
    createRepoWith(repo, FILES);
    git(repo, ['update-index', '--index-version', '4']);
    const index = readIndex(repo);
    // Version 4 has no padding; the strip varint follows the flags directly.
    expect(index[FIRST_PATH]).toBe(0);

    expect(findTrustFlaggedEntries(edited(index, copy => copy.writeUInt8(1, FIRST_PATH)))).toBeNull();
  });

  it('refuses an index whose extensions overrun the trailing checksum', () => {
    createRepoWith(repo, FILES);
    const index = readIndex(repo);
    // The TREE extension follows the last entry; claim it is longer than it is.
    const tree = index.indexOf('TREE', FIRST_ENTRY, 'latin1');
    expect(tree).toBeGreaterThan(FIRST_ENTRY);

    expect(findTrustFlaggedEntries(edited(index, copy => copy.writeUInt32BE(copy.readUInt32BE(tree + 4) + 8, tree + 4)))).toBeNull();
  });

  it('refuses bytes that are not an index, or an index cut short', () => {
    createRepoWith(repo, FILES);
    const index = readIndex(repo);

    expect(findTrustFlaggedEntries(Buffer.from('not an index at all'))).toBeNull();
    expect(findTrustFlaggedEntries(index.subarray(0, index.length - 30))).toBeNull();
  });
});
