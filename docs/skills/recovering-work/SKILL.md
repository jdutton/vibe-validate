---
name: recovering-work
description: Use when recovering lost work — accidentally deleted file, git restore wiped changes, failed rebase, editor crash, or branch switch lost untracked files. Covers vv history, vv snapshot, tree-hash recovery with git cat-file and git checkout.
---

# recovering-work

## When to use

Reach for this skill the moment you think work may be lost:

- Deleted a file and it was never committed
- Ran `git restore .` or `git reset --hard` and wiped unstaged edits
- Switched branches and the untracked scratch file is gone
- A merge or rebase mangled a module
- Editor crashed before you saved
- Need to see what a file looked like yesterday afternoon
- A teammate asks "what did the code look like when that bug appeared?"

Before you panic: if you ran `vv validate`, `vv pre-commit`, or `vv run` recently, the file almost certainly still exists inside git. This skill explains how to find it and get it back.

## The mental model

Every run of `vv validate`, `vv pre-commit`, or `vv run` computes a deterministic git tree hash over the working directory. Computing that hash has a deliberate side effect: git writes permanent blob and tree objects into `.git/objects/` for every file in the tree — staged, unstaged, and untracked (respecting `.gitignore`). The tree hash itself is recorded in git notes so you can find it later.

Consequences:

- **The snapshot is a real git tree.** Anything git can do with a tree (cat-file, checkout, diff, ls-tree) works against a validation snapshot.
- **Content-addressable storage means zero overhead for unchanged files.** Running validation a hundred times costs almost no disk space if nothing changed.
- **Snapshots do not expire by age.** They persist until you explicitly prune with `vv history prune` or the git notes refs are removed. Normal `git gc` will not collect them — git notes keep the objects reachable.
- **What is NOT captured:** files matched by `.gitignore` (secrets, build artifacts, `node_modules`, `.env`). This is intentional security behavior, not a bug.

Rule of thumb: *if you validated recently, nothing in your working tree is lost.*

For the caching side of this mechanism — why tree hashes exist in the first place, how locking coordinates concurrent runs — see vibe-validate:caching-and-locking. This skill assumes the snapshot exists and focuses on getting files back out.

## Find the snapshot

### `vv history` — list recent validation snapshots

```
vv history list
vv history list --limit 20
vv history list --yaml       # machine-readable
```

Each row shows a timestamp, tree hash, branch, and pass/fail status. Scan for the most recent validation from *before* the loss event. For a deletion that happened five minutes ago, `--limit 5` is usually enough. For something from yesterday, filter by date:

```
vv history list | grep 2026-04-19
```

To inspect a specific snapshot in detail:

```
vv history show <tree-hash>
vv history show <tree-hash> --yaml
```

### `vv snapshot` — current worktree snapshot with recovery hints

When you just ran validation and want the most recent tree hash without scrolling, `vv snapshot` prints the current snapshot identifier along with ready-to-paste recovery commands. This is the fastest path after "I validated, then I did something bad."

## Recover files

Once you have a tree hash, everything is plain git. `<tree-hash>` below is the value from `vv history` or `vv snapshot`.

### Inspect a file without writing it

```
git cat-file -p <tree-hash>:path/to/file.ts | less
git cat-file -p <tree-hash>:path/to/file.ts > /tmp/preview.ts
```

This is safe — nothing in your worktree changes. Use it to confirm you picked the right snapshot before overwriting anything.

### Recover one file

```
git cat-file -p <tree-hash>:path/to/file.ts > path/to/file.ts
```

If you are not sure which version is better, back up first:

```
mv path/to/file.ts path/to/file.ts.current
git cat-file -p <tree-hash>:path/to/file.ts > path/to/file.ts
```

### Recover a directory (or the whole tree)

```
git checkout <tree-hash> -- src/
git checkout <tree-hash> -- src/ test/
git checkout <tree-hash> -- .
```

Unlike `git cat-file`, `git checkout` writes directly into your worktree — review with `git status` afterwards.

### List what is inside a snapshot

```
git ls-tree -r <tree-hash>
git ls-tree -r <tree-hash> src/
git ls-tree -r <tree-hash> | grep important-test
```

### Compare two snapshots (or snapshot vs. current)

```
git diff <old-tree-hash> <new-tree-hash>
git diff --name-status <old-tree-hash> <new-tree-hash>
git diff <tree-hash> HEAD
git diff <tree-hash>:path/to/file.ts path/to/file.ts
```

## Recovery scenarios

**Scenario: `git restore .` wiped three hours of unstaged edits.**
Run `vv history list --limit 1`, grab the tree hash, then `git cat-file -p <tree-hash>:path/to/file.ts > path/to/file.ts` for each file — or `git checkout <tree-hash> -- .` if every unstaged change was good.

**Scenario: Deleted an untracked file that was never committed.**
Standard git can't help (no commit references it), but if you validated while it existed it's in a tree hash. `git ls-tree -r <tree-hash> | grep <filename>` confirms it's there, then `git cat-file -p <tree-hash>:<path> > <path>` restores it.

**Scenario: `git reset --hard HEAD` blew away uncommitted work.**
Same pattern as the first scenario. `git reflog` won't help — it tracks commits, not working-tree state. Validation snapshots do.

**Scenario: Bad find-and-replace, noticed 30 minutes later.**
`vv history list --limit 10` to find a validation from before the botched replace. `git diff <old> <new>` to confirm. Then selectively restore files with `git checkout <old-tree-hash> -- src/affected.ts` or the whole directory.

**Scenario: Merge/rebase went sideways, want to see the pre-operation state.**
If you validated before the merge, you have a full pre-merge tree. `git checkout <pre-merge-tree-hash> -- .` restores the worktree; or create an exploration branch with `git checkout -b investigate <tree-hash>` to poke around without committing.

**Scenario: "What did `src/module.ts` look like yesterday afternoon?"**
`vv history list | grep 2026-04-19` to find candidates, then `git cat-file -p <tree-hash>:src/module.ts > /tmp/module-yesterday.ts` to read it without touching the current file.

**Scenario: Teammate asks about exact code state.**
Share the tree hash — it's deterministic. Same content produces the same hash on their machine, and they can reproduce the state locally (provided the objects are pushed or the repos share history).

## What is NOT recoverable this way

Be honest about the limits so you don't burn time looking for something that was never captured:

- **Files matched by `.gitignore`.** `.env`, `node_modules/`, `dist/`, secrets — all intentionally excluded. If you lost a `.env`, recovery has to come from a password manager, a teammate, or OS-level tooling.
- **Changes made after the most recent validation.** If you edited for ten minutes *after* your last `vv validate` and then deleted the edits, those ten minutes were never snapshotted. Try editor local history (VS Code Timeline, IntelliJ Local History) or OS file-recovery tools.
- **Work from a repository where you never ran validation.** No validation, no snapshots. `git reflog` and commit history are your only fallbacks.
- **Snapshots explicitly pruned.** `vv history prune --older-than 90d` or `vv history prune --all` removes the git notes that track tree hashes. The underlying git objects may survive until the next `git gc`, but without the notes you have no timestamped index to find them. Do not prune casually.
- **Interrupted validation runs.** The tree hash is written early, but if the process is killed before git notes are updated, the snapshot may not appear in `vv history`. The objects are usually still in `.git/objects/` — `git fsck --unreachable` and `git reflog` can sometimes locate them, but it's manual.

A note on temp files: `vv cleanup-temp` removes per-run scratch output under the system temp directory. It does **not** touch git notes or git objects, so it has no effect on snapshot recoverability.

## Troubleshooting

**`fatal: Not a valid object name <tree-hash>`** — the hash was mistyped or you are in a different repository. Re-copy it from `vv history list` and verify you are in the right worktree.

**`vv history list` shows nothing** — either no validation has ever run in this repo, or the git notes ref has been pruned/not fetched. Run `vv validate` once to confirm new entries appear, then check `git notes --ref=<notes-ref> list` to see if prior notes exist. For the notes-ref configuration, see vibe-validate:setting-up-projects.

**The snapshot exists but your file isn't in it** — the file may have been in `.gitignore` at the time, or it may have been deleted before the validation that you selected. Try an earlier snapshot and use `git ls-tree -r <tree-hash> | grep <filename>` to confirm.

## See also

- vibe-validate:vv-validate-dev-loop — the day-to-day loop where snapshots get produced as a side effect
- vibe-validate:caching-and-locking — the mechanism that creates tree hashes and why they are deterministic
- vibe-validate:setting-up-projects — configuring git-notes namespaces and retention for validation snapshots
