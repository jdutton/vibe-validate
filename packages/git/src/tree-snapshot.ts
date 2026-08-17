/**
 * A **dirty-corrected git tree snapshot** — every path git can see under a
 * caller-supplied directory, each with a blob OID naming the bytes that are
 * actually on disk, plus the deterministic tree hash of the whole set.
 *
 * This is {@link "./tree-hash".getGitTreeHash} with the per-path detail kept
 * rather than collapsed, and with a `cwd` instead of an ambient repository. Both
 * run through the same throwaway index (`./temp-index.js`), so the properties
 * that make the tree hash trustworthy — unstaged edits included, the real index
 * never written, no timestamp in the key — hold here too.
 *
 * ## Why this exists separately from `getGitTreeHash`
 *
 * Two differences, and both are the point:
 *
 * 1. **It takes a path.** `getGitTreeHash()` means "the repository I am in".
 *    A consumer scanning an arbitrary project root, or several of them in one
 *    process, has no way to say which repository it means.
 * 2. **It returns the entries.** A caller that wants to key per-file work off
 *    git — "has this document changed since I last parsed it?" — needs
 *    `(path, oid, mode)`, not a single hash for the whole tree.
 *
 * ## ⚠️ A symlink's OID is NOT its target's content
 *
 * Git stores a symlink as a blob whose bytes are the link's **target string**,
 * under mode `120000`. Two symlinks with the same relative target but different
 * resolutions therefore share an OID, while a consumer that follows links reads
 * two different documents. {@link GitTreeEntry.mode} is returned precisely so
 * such a consumer can exclude {@link GIT_MODE_SYMLINK} rather than discover this
 * as a wrong answer downstream.
 *
 * ## ⚠️ A submodule is one entry, not its contents
 *
 * A submodule appears as a single {@link GIT_MODE_GITLINK} entry whose OID is a
 * **commit**, not a blob — `cat-file` on it will not give you file bytes, and
 * none of the submodule's own files appear. Callers that must descend take a
 * snapshot per submodule, the way `getGitTreeHash` does for its own recursion.
 *
 * @packageDocumentation
 */

import { withStagedTempIndex } from './temp-index.js';
import type { TreeHash } from './types.js';

/** Git's mode for a symbolic link. Its blob holds the target string, not file bytes. */
export const GIT_MODE_SYMLINK = '120000';

/** Git's mode for a gitlink — a submodule's commit, which has no blob at all. */
export const GIT_MODE_GITLINK = '160000';

/** One path in a {@link GitTreeSnapshot}. */
export interface GitTreeEntry {
  /**
   * Root-relative path, forward-slashed, spelled exactly as git spelled it.
   *
   * Relative to the repository root — NOT to the `cwd` the snapshot was taken
   * from, which git resolves upward to that root.
   */
  path: string;
  /**
   * The blob OID for this path's **on-disk** bytes, as git would store them.
   *
   * "As git would store them" is the qualification that matters, and it is not
   * a technicality:
   *
   * - Under `core.autocrlf` / `.gitattributes` line-ending normalization, CRLF
   *   on disk and LF on disk produce the SAME OID — a line-ending change is
   *   invisible here. The converse also holds: identical bytes hash differently
   *   for two developers configured differently, so this is not portable
   *   between machines.
   *   *(Measured, git 2.50.1: CRLF with `core.autocrlf=input` and LF with no
   *   config both yield tree `196228cf…`.)*
   * - Under a clean filter (git-lfs and friends) the OID names the POINTER
   *   blob, so `cat-file` returns pointer text rather than file content.
   * - In a sparse checkout, entries are returned for paths that are not
   *   materialized on disk at all — a well-formed entry whose file is ENOENT.
   *
   * A consumer asking "have these bytes changed since I last read them?" is
   * well served. A consumer treating this as a content hash of the file it will
   * subsequently open is not.
   *
   * For {@link GIT_MODE_SYMLINK} this names the target string, and for
   * {@link GIT_MODE_GITLINK} it is a commit rather than a blob — see the module
   * docstring.
   */
  oid: string;
  /** Git's six-digit file mode: `100644`, `100755`, `120000`, `160000`. */
  mode: string;
}

/** The result of one snapshot. */
export interface GitTreeSnapshot {
  /**
   * `git write-tree`'s output — a deterministic key for the whole snapshot.
   *
   * Usable as a cache-invalidation key: byte-identical content always produces
   * it, because a tree object has no timestamp field. (A `git stash create`
   * implementation would not: a stash is a commit, and two calls over identical
   * content agree only when both land in the same wall-clock second —
   * intermittent nondeterminism, which reads as a flake rather than as a
   * mechanism.)
   *
   * ## ⚠️ It does NOT cover submodule content
   *
   * This is the same value {@link "./tree-hash".getGitTreeHash} computes for the
   * repository itself, but that function additionally returns `submoduleHashes`
   * and this one does not. A submodule is one {@link GIT_MODE_GITLINK} entry
   * naming a commit, so **editing a file inside a submodule's working tree
   * leaves this hash byte-identical** *(measured: `cfa5dc8c…` before and
   * after)*. Keying a cache on it alone reproduces exactly the "cached pass
   * nobody earned" defect `getGitTreeHash` grew `submoduleHashes` to fix. A
   * consumer with submodules takes a snapshot per submodule and combines.
   */
  hash: TreeHash;
  /** Every path in the snapshot, in git's own order. */
  entries: GitTreeEntry[];
}

/** Options for {@link getGitTreeSnapshot}. */
export interface GitTreeSnapshotOptions {
  /**
   * Any directory inside the repository of interest.
   *
   * Git resolves upward to the worktree root, and every returned path is
   * relative to that root — not to this directory.
   */
  cwd: string;
}

/** `ls-files -s` emits `<mode> <oid> <stage>\t<path>`. */
const LS_FILES_STAGED = /^(\d{6}) ([0-9a-f]{40,64}) (\d)\t(.*)$/s;

/**
 * Parse `git ls-files -s -z` output into entries.
 *
 * @param stdout - NUL-separated staged-format records
 * @returns One entry per well-formed record; malformed records are skipped
 *
 * @internal Exported for testing
 */
export function parseStagedEntries(stdout: string): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  for (const record of stdout.split('\0')) {
    if (record.length === 0) continue;
    const match = LS_FILES_STAGED.exec(record);
    // A record that does not match is not silently coerced into an entry with a
    // guessed path: a wrong path here becomes a wrong cache key downstream.
    if (match === null) continue;
    // Every group in the pattern is mandatory, so a match guarantees all four.
    const [, mode, oid, , path] = match;
    entries.push({ path, oid, mode });
  }
  return entries;
}

/**
 * Take a dirty-corrected snapshot of everything git can see under `cwd`.
 *
 * Every way of failing returns `null` rather than throwing: no `git` on `PATH`,
 * a non-repository or bare-repository `cwd`, an unreadable or corrupt `.git`, a
 * read-only object store. An empty `entries` array is a *real* answer — an
 * initialized repository with no files — and must stay distinguishable from
 * "could not ask", or a caller infers that a whole corpus is absent.
 *
 * The inherited git environment is stripped before every subprocess. This is not
 * defensive dressing: `vv` runs as a `pre-commit` hook, git exports `GIT_DIR` /
 * `GIT_INDEX_FILE` / `GIT_PREFIX` into hooks, and a child that inherits them
 * snapshots the outer commit's repository instead of the path it was handed —
 * silently, with a well-formed answer. Under `git worktree` the two disagree by
 * construction. See {@link "./git-env".stripGitEnv}.
 *
 * ## ⚠️ This is a WRITE against the repository you point it at
 *
 * The name says snapshot and the shape says read, but taking one runs
 * `git add --all` against a throwaway index in the target repository. Three
 * consequences, none of which a caller can opt out of:
 *
 * 1. **It writes loose objects** into that repository's `.git/objects` for any
 *    content git has not already stored *(measured: `git count-objects`
 *    0 → 2 for a single untracked file)*. They are unreferenced and `git gc`
 *    reclaims them, but the directory grows until it runs.
 * 2. **It runs that repository's configured code.** `git add` executes the
 *    repo's `filter.*.clean` filters and its `post-index-change` hook — the
 *    latter twice per snapshot — and honours `core.hooksPath`, so the
 *    executable need not be in `.git/hooks`. All of it runs as the calling
 *    user. Point this only at repositories you would `git add` in by hand;
 *    a tree that arrived by any route other than `git clone` (an unpacked
 *    archive, an image layer, a copied directory, a vendored nested `.git`)
 *    carries its own config and hooks with it.
 * 3. **Under `core.splitIndex` it writes a `.git/sharedindex.<sha>`** into the
 *    real git directory — not an object, and not reclaimed by `gc` on the
 *    object path. With the non-default `splitIndex.sharedIndexExpire=now` it
 *    can additionally expire the shared index the REAL index still references,
 *    leaving that repository's `git status` failing until the user rebuilds it.
 *
 * The real index, HEAD, refs and the working tree are never written by this
 * code — verified mid-merge and mid-rebase — but points 2 and 3 are why that
 * sentence is about this code rather than about the whole operation.
 *
 * ⚠️ **Ceiling:** the listing is captured through a 256 MiB buffer — roughly a
 * million paths, and about 1 GB of resident memory to reach it, since a decoded
 * listing costs several times its byte size. On a constrained CI container the
 * process is OOM-killed before the cap is reached, and an OOM kill is not
 * catchable — so at that extreme the "every way of failing returns `null`"
 * contract above does not hold. Below it, the child is killed and this returns
 * `null`, which a caller cannot distinguish from "not a git repository".
 *
 * @param options - Where to look; see {@link GitTreeSnapshotOptions.cwd}
 * @returns The snapshot, or null if git could not answer
 *
 * @example
 * ```typescript
 * const snapshot = getGitTreeSnapshot({ cwd: projectRoot });
 * if (snapshot !== null) {
 *   // Exclude symlinks: their OID is the target string, not the file's bytes.
 *   const readable = snapshot.entries.filter(e => e.mode !== GIT_MODE_SYMLINK);
 * }
 * ```
 */
export function getGitTreeSnapshot(options: GitTreeSnapshotOptions): GitTreeSnapshot | null {
  try {
    return withStagedTempIndex({ cwd: options.cwd, scrubGitEnv: true }, ({ runGit }) => {
      // -z for unquoted, NUL-separated paths, so a non-ASCII filename survives
      // as its real bytes rather than as git's octal-escaped display form.
      // --full-name spells them from the repository root; withStagedTempIndex
      // already runs us there, which is what makes the listing complete as well
      // as correctly spelled.
      // The output scales with the tree — measured at ~104 bytes per path on an
      // ordinary monorepo, and ~270 with deep paths — so spawnSync's 1 MiB
      // default is exhausted at a few thousand files. Overrunning it never
      // yields a short but honest answer: it either kills the child or leaves a
      // truncated stdout behind an exit code of 0, and this call then reports
      // `null`, indistinguishable from "not a git repository". The cap has to
      // sit far above any plausible repository rather than above a typical one;
      // this is roughly a million paths.
      const staged = runGit(['ls-files', '-s', '-z', '--full-name'], {
        maxBuffer: 256 * 1024 * 1024,
      }).stdout;
      const hash = runGit(['write-tree']).stdout.trim() as TreeHash;
      if (hash.length === 0) return null;
      return { hash, entries: parseStagedEntries(staged) };
    });
  } catch (error) {
    // `null` is a documented, ordinary outcome — "this is not a repository I can
    // answer about" — so an unconditional catch would give a future defect in
    // our own code (a TypeError in the parser, say) the same shape as the
    // expected case, at every call site, with no trace anywhere. The contract
    // is unchanged; what changes is that only the anticipated failures stay
    // silent.
    if (!isNotARepository(error)) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  getGitTreeSnapshot failed unexpectedly at ${options.cwd}: ${detail}`);
    }
    return null;
  }
}

/**
 * Whether a thrown error is git declining to answer rather than a fault here.
 *
 * Matched on the message because that is all `executeGitCommand` carries out —
 * git's own `fatal:` text for a non-repository, plus the spawn-level ENOENT a
 * missing directory produces before git is even reached.
 *
 * @param error - The value caught
 * @returns true when the cause is "there is no repository here"
 */
function isNotARepository(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // `not a git repository` is deliberately NOT matched bare. Git uses that same
  // phrasing for a genuine fault in a perfectly valid repository: when
  // `.git/modules/<name>` is missing, `git add --all` fails with
  // `fatal: not a git repository: sub/../.git/modules/sub` — a broken submodule,
  // not an absent repository. Matched bare, that returned `null` with no
  // warning, in a repo whose `write-tree` would have succeeded. The parenthetical
  // is what git appends only when discovery itself came up empty, so keying on it
  // separates "you are not in a repository" from "something inside this one is
  // broken".
  return /not a git repository \(or any of the parent directories\)|must be run in a work tree|not a git work tree|ENOENT|no such file or directory/i.test(
    error.message,
  );
}
