---
name: caching-and-locking
description: Use when debugging cache misses, unexpected cache hits, or concurrency lock conflicts. Covers the git tree hash caching model, lock scopes, --no-lock, --no-wait, and the vv cleanup-temp maintenance utility.
---

# caching-and-locking

## When to use

Reach for this skill when the mechanics of caching or locking matter — not the day-to-day workflow:

- Validation re-ran when you expected a cache hit, or hit the cache when you expected a re-run.
- Two runs are colliding: `vv validate` reports "already running" or blocks waiting.
- You need to choose a `locking.concurrencyScope` for a project with shared ports or databases.
- You want to reclaim temp space via `vv cleanup-temp`.
- You are configuring a background hook (pre-push, editor save, agent prompt) and need `--no-wait` semantics.

For the day-to-day validate/fix/re-validate loop, see `vibe-validate:vv-validate-dev-loop`. For where `locking` lives in config, see `vibe-validate:setting-up-projects`.

## Git tree hash caching — the mental model

The cache key is a **git tree hash**: a deterministic SHA-1 of the working tree contents.

- Content-based. Same files → same hash. No timestamps.
- Includes tracked changes **and** untracked-but-non-ignored files.
- Excludes `.gitignore`'d files (so secrets and build artifacts don't leak into the key).
- Computed against a *temporary* git index so it never touches the real index or staging area.

Validation results are stored as **git notes** keyed by that tree hash (`refs/notes/vibe-validate/validation/<tree-hash>`). Git notes are built into git, survive branch switches, and are content-addressable — perfect for a validation cache.

### Invariants

- Same code → same hash → instant cache hit (sub-second return of the prior result).
- Changed code → new hash → fresh validation run, stored under the new hash.
- Switching branches to a tree you've validated before → cache hit, even if that was days ago.
- Reverting to a prior state → cache hit, again, because tree hashes are content-addressed.

### What the cache persists across

- Branch switches (if the resulting tree is identical to one already validated).
- Git commits and merges that don't actually change file content.
- Time passing — the cache is not TTL'd.
- Worktree creation (the notes ref is shared across worktrees of the same repo).

## Why did validation re-run?

A cache miss means the tree hash changed. Common culprits:

- **An edit you made.** Any tracked file modification, new file, deletion, or rename changes the hash. Expected.
- **A generated file that isn't gitignored.** `.tsbuildinfo`, `coverage/`, editor temp files, OS detritus (`.DS_Store`), or build outputs can slip into the tree hash. Add them to `.gitignore`.
- **Lockfile updates.** `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` changing is deliberate invalidation — dependencies changed, validation should re-run.
- **Line-ending normalization.** CRLF ↔ LF conversions rewrite content and change the hash. Configure `.gitattributes` consistently across the team.
- **`--force` flag.** `vv validate --force` bypasses the cache unconditionally.
- **Config change.** Editing `vibe-validate.config.yaml` changes the tree hash (it's a tracked file), so validation re-runs.

Diagnose with:

```bash
git status --short    # What's modified/untracked?
git diff              # What exactly changed?
```

## Why didn't my change take effect?

A cache hit when you expected a miss is rarer but more confusing. Possible causes:

- **The change is in a `.gitignore`'d path.** Ignored files are excluded from the tree hash by design. If validation depends on one, either un-ignore it or trigger with `--force`.
- **Environment variable or machine-level state.** Tree hashes capture files, not `process.env` or installed tool versions. A step that behaves differently based on external state will return a stale cached verdict.
- **Non-deterministic step.** If a validation step is flaky or depends on network/clock, the cached "pass" may not reflect current reality. Investigate the step itself; don't paper over it with `--force` long-term.
- **Submodule working-tree edits.** A modification inside a submodule doesn't automatically invalidate the parent repo's tree hash — vibe-validate handles this specifically, but older installations or unusual setups can drift. If in doubt, `vv validate --force`.

Use `vv validate --force` as a one-shot diagnostic to confirm the cache is the issue, then fix the root cause (usually `.gitignore` or a non-deterministic step).

## Inspecting the cache

```bash
vv state              # Current tree hash + cached result (YAML)
vv history list       # Recent validation runs
vv validate --check   # Exit 0 if cached pass, 1 otherwise; does not execute
```

Low-level (rarely needed):

```bash
git write-tree                                          # Current tree hash
git notes --ref=refs/notes/vibe-validate/validation list  # All cached entries
```

## Concurrency locking

### What it prevents

Two `vv validate` runs racing in the same project can corrupt cache state, fight over ports, or stomp on shared test databases. vibe-validate acquires a lock at start and releases it on completion (or crash cleanup).

Defaults:

- **Enabled**: one validation at a time per lock scope.
- **Wait mode**: a second run waits up to 5 minutes for the first to finish, then proceeds.
- **Directory scope**: each working directory has its own lock, so independent worktrees run in parallel.

### Lock scopes

| Scope | Lock granularity | Use when |
|-------|------------------|----------|
| `directory` (default) | Per working directory | Unit tests only, no shared ports/databases, parallel worktrees desired |
| `project` | Per project (auto-detected from git remote or `package.json` name) | Tests bind fixed ports, share a test database, or hold global state |

Set in `vibe-validate.config.yaml`:

```yaml
locking:
  enabled: true              # default
  concurrencyScope: project  # or: directory
  projectId: my-app          # optional; auto-detected otherwise
```

Project ID detection order: git remote URL (stripped of path/`.git`) → `package.json` `name` field (scope stripped) → error if using `project` scope without either.

For the full config shape, see `vibe-validate:setting-up-projects`.

### CLI overrides

- `vv validate --no-lock` — skip lock acquisition entirely for this run. One-off use: CI containers, manual debugging, isolated environments.
- `vv validate --no-wait` — if a validation is already running, exit immediately with code 0 instead of waiting. Designed for background hooks (pre-push, agent prompt hooks, editor-save triggers) that must never block the user.
- `vv validate --wait-timeout <seconds>` — override the default 300-second wait. Shorter for CI, longer for slow suites.

### Lock vs. wait — they're independent

- **Lock** = whether this run acquires the mutex at all.
- **Wait** = whether this run blocks if someone else holds the mutex.

So `--no-lock` allows concurrent runs (risky if scopes conflict); `--no-wait` plays nice with the lock but fails fast instead of queueing. Pick based on the scenario, not interchangeably.

### Stale locks

Locks are files under the system temp directory:

- Directory scope: `/tmp/vibe-validate-<encoded-path>.lock`
- Project scope: `/tmp/vibe-validate-project-<project-id>.lock`

Crashed processes leave stale locks. vibe-validate detects dead PIDs and cleans them up on the next run, so persistent "already running" errors with no actual process are rare. If you hit one:

```bash
ps aux | grep vibe-validate       # Confirm nothing is actually running
ls /tmp/vibe-validate*.lock       # See the stale lock
rm /tmp/vibe-validate*.lock       # Remove it
vv validate                       # Retry
```

## `vv cleanup-temp` — reclaiming temp space

Every validation run writes LLM-optimized YAML output to a temp file so `vv state` can surface it after the fact. Over time these accumulate.

```bash
vv cleanup-temp                    # Delete files older than 7 days (default)
vv cleanup-temp --older-than 30    # Keep last 30 days
vv cleanup-temp --all              # Delete everything
vv cleanup-temp --dry-run          # Preview what would be deleted
vv cleanup-temp --yaml             # LLM-friendly output
```

`cleanup-temp` does not touch git notes — the validation cache itself is unaffected. To prune cached validation results, use `vv history prune` (see `vibe-validate:vv-validate-dev-loop` for history commands).

`cleanup-temp` respects the same locking rules as `vv validate`: don't run it concurrently with an active validation in the same scope.

## Diagnostic recipes

### "Validation always re-runs"

1. `git status --short` — is something generated but not ignored?
2. `git write-tree` twice in a row with no edits — hash stable?
3. If stable but cache always misses: `vv doctor` to confirm the notes ref exists and git is configured.
4. Check for `.tsbuildinfo`, `coverage/`, editor dirs in the working tree — add to `.gitignore`.

### "Validation never re-runs even after my edits"

1. `git status --short` — is your change in an ignored path?
2. `vv state` — does the reported `treeHash` match `git write-tree` output?
3. Run `vv validate --force` once. If that produces a different result, the cache was stale for a reason worth understanding (non-deterministic step, env-dependent behavior) — investigate; don't adopt `--force` as a workaround.

### "Locked every time"

1. `ps aux | grep vibe-validate` — real process, or stale?
2. If stale: `rm /tmp/vibe-validate*.lock`.
3. If real but wrong scope (e.g., parallel worktrees blocking each other for unit-test-only code): switch `concurrencyScope` to `directory`.
4. If the lock is doing its job but you need this specific run to skip it (CI in isolated containers): `--no-lock`.

### "Background hook hangs on commit/push"

The hook is waiting for the lock. Switch to `--no-wait` in the hook script — it exits immediately (code 0) when validation is already running, never blocking the user's commit or push.

### "Want to reset the cache clean-room"

```bash
vv history prune --all     # Drop all cached validation results
vv cleanup-temp --all      # Drop all temp output files
vv validate --force        # Fresh validation from scratch
```

## See also

- `vibe-validate:vv-validate-dev-loop` — the day-to-day validate/fix/re-validate loop that benefits from this cache.
- `vibe-validate:setting-up-projects` — where `locking.concurrencyScope` and other config keys live.
- `vibe-validate:recovering-work` — using tree hashes and git notes as a recovery channel for lost files.
- For the full git-notes-based tracking architecture: `docs/git-validation-tracking.md` at the repo root is the canonical reference.
