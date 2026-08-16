/**
 * Integration tests for {@link getGitTreeSnapshot}, against a real `git`.
 *
 * Deliberately NOT unit tests with a mocked git. Every property worth pinning
 * here is a property of git itself — that a dirty file's OID names what is on
 * disk rather than what was committed, that `write-tree` is timestamp-free, that
 * a symlink's blob is its target string, that an exported hook environment
 * retargets a child — and a mock would simply restate this file's own
 * assumptions back to it.
 */

import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeGitCommand } from '../src/git-executor.js';
import { withStagedTempIndex } from '../src/temp-index.js';
import {
  commitTestChanges,
  stageTestFiles,
} from '../src/test-helpers.js';
import { GIT_MODE_SYMLINK, getGitTreeSnapshot, type GitTreeSnapshot } from '../src/tree-snapshot.js';

import { createGitRepo } from './helpers/submodule-test-helpers.js';

/**
 * Run git in a fixture and return its stdout.
 *
 * @param args - Arguments after the binary
 * @param cwd - Fixture directory to run in
 * @returns Trimmed stdout, or empty string on failure
 */
function gitOut(args: string[], cwd: string): string {
  return executeGitCommand(args, { cwd, ignoreErrors: true, suppressStderr: true }).stdout;
}

/**
 * Stage and commit everything currently in the working tree.
 *
 * @param cwd - Fixture directory
 * @param message - Commit message
 */
function commitAll(cwd: string, message: string): void {
  stageTestFiles(cwd);
  commitTestChanges(cwd, message);
}

/** The fixture's one ordinary tracked document, root-relative. */
const DOC = 'doc.md';

/** The fixture's untracked-but-not-ignored document. */
const UNTRACKED = 'untracked.md';

/** `git status` in machine-readable form. */
const STATUS_PORCELAIN = ['status', '--porcelain'];

/** The git vars a hook exports, which this function must ignore. */
const HOOK_ENV_KEYS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX'] as const;

/** A document only the decoy repository holds. */
const DECOY_DOC = 'elsewhere.md';

/**
 * Run `probe` under the git environment a pre-commit hook exports, pointed at a
 * SECOND repository the subject is never told about.
 *
 * The decoy is what makes the two repositories distinguishable, which is the
 * whole point: it holds a file `root` does not, so an implementation that
 * followed the inherited `GIT_DIR` returns `elsewhere.md` and no `doc.md`.
 * Asserting that the subject's own corpus looks right would pass in both worlds.
 *
 * The environment is cleared before `verify` runs, because those assertions call
 * git too and one confused by the same variables would prove nothing.
 *
 * @param root - The repository the subject is handed
 * @param probe - Runs while the hook environment is exported
 * @param verify - Assertions, run with the environment already restored
 */
function withDecoyHookEnv<T>(
  root: string,
  probe: () => T,
  verify: (result: T, decoy: string) => void,
): void {
  const decoy = mkdtempSync(join(normalizedTmpdir(), 'vv-outer-repo-'));
  try {
    createGitRepo(decoy);
    writeFileSync(join(decoy, DECOY_DOC), 'not ours\n');
    commitAll(decoy, 'outer');

    writeFileSync(join(root, DOC), 'ours\n');
    commitAll(root, 'ours');

    // Exactly what git sets when it runs a hook, including the empty
    // GIT_PREFIX that means "invoked at the top level".
    process.env.GIT_DIR = join(decoy, '.git');
    process.env.GIT_WORK_TREE = decoy;
    process.env.GIT_INDEX_FILE = join(decoy, '.git', 'index');
    process.env.GIT_PREFIX = '';

    const result = probe();

    for (const key of HOOK_ENV_KEYS) delete process.env[key];
    verify(result, decoy);
  } finally {
    for (const key of HOOK_ENV_KEYS) delete process.env[key];
    rmSync(decoy, { recursive: true, force: true });
  }
}

/**
 * Whether this machine can create symlinks at all.
 *
 * Windows needs Developer Mode or admin rights, and a hard failure there would
 * report as a bug in the snapshot rather than as a missing OS capability.
 *
 * @returns true if a symlink could be created and removed in a temp directory
 */
function detectSymlinkSupport(): boolean {
  const probe = mkdtempSync(join(normalizedTmpdir(), 'vv-symlink-probe-'));
  try {
    const link = join(probe, 'link');
    symlinkSync('target', link);
    unlinkSync(link);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

const SYMLINKS_AVAILABLE = detectSymlinkSupport();

/**
 * The entry for one root-relative path, or undefined.
 *
 * @param snapshot - Snapshot to look in
 * @param path - Root-relative path to find
 * @returns The matching entry, or undefined
 */
function entryFor(snapshot: GitTreeSnapshot | null, path: string) {
  return snapshot?.entries.find(e => e.path === path);
}

/**
 * Every path in a snapshot, or an empty list if there was no snapshot.
 *
 * @param snapshot - Snapshot to read
 * @returns Root-relative paths
 */
function pathsOf(snapshot: GitTreeSnapshot | null): string[] {
  return snapshot?.entries.map(e => e.path) ?? [];
}

describe('getGitTreeSnapshot - integration tests', () => {
  let root: string;

  beforeEach(() => {
    // Any inherited git environment would make these fixtures describe the
    // repository vv itself lives in. One of the tests below deliberately sets
    // these; the rest must start clean.
    for (const key of HOOK_ENV_KEYS) delete process.env[key];

    root = mkdtempSync(join(normalizedTmpdir(), 'vv-tree-snapshot-'));
    createGitRepo(root);
  });

  afterEach(() => {
    for (const key of HOOK_ENV_KEYS) delete process.env[key];
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null outside a git repository rather than an empty snapshot', () => {
    const bare = mkdtempSync(join(normalizedTmpdir(), 'vv-not-a-repo-'));
    try {
      // The distinction this pins: "could not ask" must not be spelled the same
      // way as "asked, and the answer is nothing". A caller that inferred
      // emptiness from null would report a whole corpus as absent.
      expect(getGitTreeSnapshot({ cwd: bare })).toBeNull();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('names the ON-DISK bytes of a tracked-but-dirty file, not the committed ones', () => {
    const file = join(root, DOC);
    writeFileSync(file, 'committed\n');
    commitAll(root, 'add doc');

    const committedOid = entryFor(getGitTreeSnapshot({ cwd: root }), DOC)?.oid;
    expect(committedOid).toBeDefined();

    // Dirty it WITHOUT staging. `git ls-files -s` against the real index would
    // still report `committedOid` here — that is the whole defect this function
    // exists to avoid, so the assertion is inequality, not merely "defined".
    writeFileSync(file, 'edited on disk\n');

    const dirtyOid = entryFor(getGitTreeSnapshot({ cwd: root }), DOC)?.oid;
    expect(dirtyOid).toBeDefined();
    expect(dirtyOid).not.toBe(committedOid);

    // And it is the OID git itself computes for those exact bytes.
    expect(dirtyOid).toBe(gitOut(['hash-object', file], root));
  });

  it('leaves the real index and the working tree untouched', () => {
    writeFileSync(join(root, DOC), 'committed\n');
    commitAll(root, 'add doc');
    writeFileSync(join(root, DOC), 'edited on disk\n');
    writeFileSync(join(root, UNTRACKED), 'new\n');

    const before = gitOut(STATUS_PORCELAIN, root);

    getGitTreeSnapshot({ cwd: root });

    // If GIT_INDEX_FILE were not honoured, `git add --all` would have staged
    // both files and this string would change from ` M`/`??` to `M `/`A `.
    expect(gitOut(STATUS_PORCELAIN, root)).toBe(before);
  });

  it('is deterministic across calls on identical content', () => {
    writeFileSync(join(root, DOC), 'stable\n');
    commitAll(root, 'add doc');
    writeFileSync(join(root, DOC), 'dirty but stable\n');

    const first = getGitTreeSnapshot({ cwd: root });
    const second = getGitTreeSnapshot({ cwd: root });

    // A `git stash create` implementation passes this only when both calls land
    // in the same wall-clock second, which is why the mechanism is `write-tree`.
    expect(first?.hash).toBe(second?.hash);
    expect(first?.hash).toMatch(/^[0-9a-f]{40,64}$/);
  });

  it('includes untracked-not-ignored files and excludes gitignored ones', () => {
    writeFileSync(join(root, '.gitignore'), 'dist/\n');
    writeFileSync(join(root, 'tracked.md'), 'tracked\n');
    commitAll(root, 'add tracked');

    writeFileSync(join(root, UNTRACKED), 'untracked\n');
    mkdirSyncReal(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'out.js'), 'built\n');

    const paths = pathsOf(getGitTreeSnapshot({ cwd: root }));

    expect(paths).toContain('tracked.md');
    expect(paths).toContain(UNTRACKED);
    // The membership contract: `--all` without `--force`. A snapshot carrying
    // `dist/out.js` would mean secrets and build output were being checksummed,
    // and two developers on the same commit would disagree.
    expect(paths).not.toContain('dist/out.js');
  });

  it('returns paths relative to the repository ROOT even when called from a subdirectory', () => {
    mkdirSyncReal(join(root, 'nested', 'deeper'), { recursive: true });
    writeFileSync(join(root, 'nested', 'deeper', 'doc.md'), 'x\n');
    writeFileSync(join(root, 'top.md'), 'y\n');
    commitAll(root, 'add nested');

    const paths = pathsOf(getGitTreeSnapshot({ cwd: join(root, 'nested', 'deeper') }));

    // `git ls-files` both SPELLS paths relative to the cwd and SCOPES its
    // listing to the cwd; `--full-name` only fixes the spelling. With the flag
    // alone this returns `nested/deeper/doc.md` correctly and omits `top.md`
    // entirely — a snapshot that looks well-formed and silently is not the whole
    // tree. The `top.md` assertion is the load-bearing half.
    expect(paths).toContain('nested/deeper/doc.md');
    expect(paths).toContain('top.md');
  });

  it('ignores the git environment a pre-commit hook exports into it', () => {
    // vv runs as a pre-commit hook, and git exports GIT_DIR / GIT_INDEX_FILE /
    // GIT_PREFIX into hooks. A child that inherits them snapshots the OUTER
    // commit's repository instead of the path it was handed -- silently, with a
    // well-formed answer.
    withDecoyHookEnv(
      root,
      () => pathsOf(getGitTreeSnapshot({ cwd: root })),
      (paths, decoy) => {
        expect(paths).toContain(DOC);
        expect(paths).not.toContain(DECOY_DOC);

        // And the decoy's real index is still untouched, which is the failure
        // that would actually corrupt someone's commit.
        expect(gitOut(STATUS_PORCELAIN, decoy)).toBe('');
      },
    );
  });

  it('protects a caller who supplies cwd and forgets to ask for the scrub', () => {
    // `getGitTreeSnapshot` passes both, so it would pass this test no matter
    // what — the subject here is deliberately the layer BELOW it, called the way
    // a future third caller would most plausibly get it wrong. The rule "an
    // explicit cwd scrubs" lived only in a JSDoc sentence, and a rule that a
    // caller can decline by omission is a convention, not a guarantee.
    withDecoyHookEnv(
      root,
      // No `scrubGitEnv` — the point of the test.
      () =>
        withStagedTempIndex({ cwd: root }, ({ runGit }) =>
          runGit(['ls-files', '--full-name']).stdout,
        ),
      (listing) => {
        expect(listing).toContain(DOC);
        expect(listing).not.toContain(DECOY_DOC);
      },
    );
  });

  it('never reports a maxBuffer-truncated listing as a successful one', () => {
    writeFileSync(join(root, DOC), 'committed\n');
    commitAll(root, 'add doc');

    // This is why the listing call asks for a large cap, and it is not the
    // failure you would guess. Node reports a maxBuffer overrun as ENOBUFS, and
    // when the output is small enough to arrive before the child finishes it
    // leaves `status: 0` next to a TRUNCATED stdout — so keying on the exit code
    // alone hands back a partial listing marked successful. For an enumerating
    // command that is files silently missing, which reads downstream as "not
    // there" rather than "not asked". A tiny cap reproduces it without needing a
    // repository large enough to hit the real one.
    const truncated = executeGitCommand(
      ['ls-files', '-s', '-z'],
      { cwd: root, maxBuffer: 8, ignoreErrors: true },
    );
    expect(truncated.success).toBe(false);

    // …and the reason travels WITH the result, not only with a thrown error.
    // `ignoreErrors` exists for callers that inspect instead of catching, and
    // those are the ones that most need to tell a truncated listing from an
    // ordinary non-zero exit — the two mean opposite things and only one is an
    // answer. Until 0.19.8 this path returned `success: false` with an empty
    // stderr and no cause at all, so `withStagedTempIndex` reported its own
    // `git add` failures as the empty sentence `git add failed: `.
    expect(truncated.error).toBeDefined();
    expect(truncated.stderr).toMatch(/ENOBUFS/);

    // Same command, same repository, a cap that fits — so the assertion above is
    // about the cap and nothing else.
    const generous = executeGitCommand(['ls-files', '-s', '-z'], { cwd: root, maxBuffer: 1024 * 1024 });
    expect(generous.success).toBe(true);
    expect(generous.stdout.length).toBeGreaterThan(8);

    // And without `ignoreErrors` the reason is named, not swallowed into a bare
    // "Git command failed".
    expect(() => executeGitCommand(['ls-files', '-s', '-z'], { cwd: root, maxBuffer: 8 }))
      .toThrow(/ENOBUFS/);
  });

  it('does not trim a NUL-delimited listing, whose first path may begin with a space', () => {
    // git sorts by byte value and 0x20 sorts below every printable character, so
    // a name starting with a space is listed FIRST — exactly where a trim can
    // reach it. The result is not an error but a path that does not exist, so
    // every lookup against it reads as "the file is not there".
    //
    // `getGitTreeSnapshot` is immune because `ls-files -s` puts the mode at
    // position 0; this is about the plain `-z` listing a consumer writes itself,
    // which is how it was found.
    const leadingSpace = ' leading-space.md';
    writeFileSync(join(root, leadingSpace), 'x\n');
    writeFileSync(join(root, 'zulu.md'), 'y\n');
    commitAll(root, 'add a path that sorts first');

    const raw = executeGitCommand(['ls-files', '-z'], { cwd: root, trimOutput: false });
    expect(raw.stdout.split('\0').filter(Boolean)).toContain(leadingSpace);

    // The control: the default is still to trim, because every existing caller
    // reads one line as a value and compares it against an untrimmed string.
    const trimmed = executeGitCommand(['ls-files', '-z'], { cwd: root });
    expect(trimmed.stdout.split('\0').filter(Boolean)).not.toContain(leadingSpace);
    expect(executeGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root }).stdout).not.toMatch(
      /\s$/,
    );
  });

  it.skipIf(!SYMLINKS_AVAILABLE)(
    'reports a symlink under mode 120000, whose blob is the TARGET STRING',
    () => {
      writeFileSync(join(root, 'real.md'), 'the real contents\n');
      symlinkSync('real.md', join(root, 'link.md'));
      commitAll(root, 'add link');

      const snapshot = getGitTreeSnapshot({ cwd: root });
      const link = entryFor(snapshot, 'link.md');
      const real = entryFor(snapshot, 'real.md');

      expect(link?.mode).toBe(GIT_MODE_SYMLINK);
      // The trap, pinned as a fact rather than left as prose: the link's OID is
      // NOT its target's OID, because the blob holds the string "real.md". A
      // consumer keying content from these OIDs must exclude mode 120000, or two
      // links with the same target string collapse onto one key.
      expect(link?.oid).not.toBe(real?.oid);
      expect(gitOut(['cat-file', '-p', link?.oid ?? ''], root)).toBe('real.md');
    },
  );
});
