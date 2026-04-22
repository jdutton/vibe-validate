---
name: vv-watch-pr
description: Use when monitoring PR/CI status after pushing, diagnosing CI failures, investigating flakes, or cleaning up merged branches. Triggers on watch-pr, CI checks, CI debug, PR status, merged-branch cleanup.
---

# vv-watch-pr

## When to use

- You just pushed a branch or PR and want to know what CI is doing without tabbing to GitHub.
- CI failed and you need the actual errors, not a "checks failed" summary.
- A check fails then passes without a code push and you want to distinguish a flake from a real regression.
- A PR merged and you want to tidy up local and remote branches.

Anything about running validation locally (cache, retries, state queries) belongs in `vibe-validate:vv-validate-dev-loop`. Cache-key divergence between local and CI is covered in `vibe-validate:caching-and-locking`.

## `vv watch-pr` — monitor PR checks

### Auto-detect the current branch's PR

```bash
vv watch-pr
```

Resolves the PR attached to the current branch via `gh` and begins polling. If multiple PRs match or none match, `vv` prints guidance instead of guessing.

### Specific PR

```bash
vv watch-pr 123
```

Works from any branch, including `main`. Useful when reviewing someone else's PR or when your local branch has moved on.

### What it does

- Polls GitHub checks at a reasonable cadence (no API hammering) and streams status transitions to your terminal.
- When a check has a vibe-validate state attached (via git notes on the CI-side tree hash), `watch-pr` fetches that state and prints the extracted YAML — you see the exact failing step, file, line, and message instead of raw log output.
- Surfaces check reruns without a new push as possible flakes.
- Exits non-zero if any required check fails, so it composes with shell pipelines and agent loops.

### Prerequisites

`watch-pr` uses the GitHub CLI (`gh`) under the hood. Before first use:

- `gh auth status` should report an authenticated account with scope for the repo in question.
- The remote named `origin` (or the configured remote) should point at the GitHub repository whose PRs you want to watch.
- The repository needs a PR open against the current branch for the auto-detect form to work; otherwise pass the number explicitly.

If `gh` is missing or unauthenticated, `watch-pr` stops early with a clear error rather than silently returning no data.

### `--fail-fast`

```bash
vv watch-pr --fail-fast
```

Exits as soon as the **first** failed check is extracted, rather than waiting for all checks to complete. Intended for agent loops where the first signal is enough to begin diagnosing. Without the flag, `watch-pr` waits for every check so you get the complete failure surface.

Recent fix worth knowing: `--fail-fast` previously waited for every extraction before exiting. It now correctly exits on the first extraction, which matches the documented behavior.

## Diagnosing CI failures

### Step 1 — pull the vibe-validate state from CI

If the CI workflow runs `vibe-validate validate` (either directly or via a project-specific wrapper), CI writes the resulting state to git notes against the tree hash that CI ran on. `vv watch-pr` fetches those notes and prints the extracted YAML locally. That YAML is the same shape `vv state` would produce — extracted errors only, ANSI stripped, file:line format.

This is the single highest-leverage move for CI debugging: never read raw CI logs when a vibe-validate state is available.

### Step 2 — compare CI's extraction against your local state

If local passes but CI fails, the suspects are:

- **Cache-key divergence**: CI and local computed different git tree hashes (uncommitted files, lockfile drift, line endings). See `vibe-validate:caching-and-locking`.
- **Environment mismatch**: Node version, OS, shell, locale, timezone, or env vars differ between CI and your machine.
- **Missing git history**: CI didn't fetch enough history for `git diff origin/main` or similar checks — usually fixed by `fetch-depth: 0` in the checkout step.
- **Missing secrets/env**: CI workflow didn't wire a required secret (DATABASE_URL, GitHub token for private packages, etc.).
- **Genuine flake**: A test has a race, resource contention, or network dependency that only fails under CI timing.

### Step 3 — reproduce locally

Once you know which step failed, reproduce it with `vv run` wrapping the exact CI invocation:

```bash
vv run <command CI ran>
```

`vv run` extracts errors the same way CI does, so the output should match. If it doesn't match, the divergence is environmental — jump back to Step 2.

Two subtleties when reproducing:

- **Set `CI=true`** in the local shell if the command branches on it (many test runners enable verbose reporters only in CI). Without this the local run can emit a different format than CI, and the extractor's output will appear to diverge when it actually matches.
- **Match Node and package-manager versions.** A `.nvmrc` / `.tool-versions` / `volta` pin in the repo is the source of truth; if you're on a different Node major, behavior can legitimately differ.

### `--debug` for deeper inspection

When the extracted errors aren't enough, re-run validation with `--debug`:

```bash
vv validate --debug --yaml
```

`--debug` creates output files for every step (not just failures) and adds an `outputFiles` field to the result pointing at `combined.jsonl` (timestamped stdout+stderr) and, where applicable, `stdout.log`/`stderr.log`. Use it when you suspect the extractor is dropping context, or when investigating why the same command behaves differently in CI. Not appropriate for normal runs — it generates extra files and slows things down.

## Flaky test detection

When `watch-pr` sees a check fail then pass (or vice versa) without a new push, it flags the check as possibly flaky. Two responses:

1. **Genuine flake in test code** — race condition, timing assumption, resource contention, order-dependent state. Fix the test.
2. **Extraction miss** — the check flipped because a transient infrastructure error was classified as a test failure. If this recurs, the extractor for that tool may need tightening. See `vibe-validate:authoring-extractors`.

On main, if a flaky run lands and subsequent runs pass, `vv validate --retry-failed` re-runs only the failed steps while preserving cached passes, and warns when a step passes on retry without code changes (that warning is the flake signal).

A pragmatic triage when `watch-pr` flags a flake:

1. Re-run the CI job (or push an empty commit) once, to confirm the failure isn't reproducible.
2. If the second run passes, capture the failing run's extracted state and open a tracking issue. Do not just move on — flakes compound.
3. If the second run also fails, it isn't a flake — it's a real regression masquerading as one. Reproduce locally per the three-step flow above.

## `vv cleanup` — post-PR branch cleanup

```bash
vv cleanup
```

After a PR merges, `vv cleanup` identifies local branches whose upstream PR has been merged or closed (queried via `gh`) and offers to delete them. It also prunes local references to remote branches that no longer exist on the origin.

Behavior worth knowing:

- **Confirmation prompt**: `vv cleanup` never deletes without asking — it prints the proposed list and waits. Agents running non-interactively should pass the explicit confirm flag if the command supports it, or filter the list themselves.
- **Current branch is never deleted**: if you're sitting on a merged branch, `vv cleanup` will tell you to switch first.
- **Unpushed commits protect a branch**: branches with local commits not present on the remote are skipped, regardless of PR state, so you don't lose in-flight work.
- **PR state is the signal, not merge commit presence**: `vv cleanup` trusts GitHub's PR state. Squash-and-merge workflows don't leave a merge commit on main, so heuristic-based cleanup tools often get this wrong. `vv cleanup` does not.

Run it whenever the branch list gets long, or as part of a post-merge ritual.

### When `vv cleanup` is the wrong tool

- **Shared branches**: `vv cleanup` is for your local clone's branch list, not for deleting shared integration branches on the remote. It will not delete the remote tracking ref without confirmation, and it will not delete a branch another collaborator is still working on (as inferred from PR state).
- **PRs with the "do not delete branch" convention**: some teams keep long-lived branches (release trains, hotfix lines) even after a PR merges. Add those to your local skip list rather than running cleanup and re-creating them.
- **Forks**: if you routinely push from feature branches in a fork, the PR state on the upstream repo may be misleading. Point `vv cleanup` at the fork's PR state, not upstream's.

## Common CI failure patterns

**"Works locally, fails in CI"** — start by fetching the CI-side vibe-validate state with `vv watch-pr`. If the extracted errors are genuinely a test failure, reproduce with `vv run` using the exact CI invocation. If reproduction succeeds locally, it's test code. If it doesn't, it's environment — check Node version, `fetch-depth`, line endings, and env vars.

**"Checks pending forever"** — usually GH API rate limiting or the workflow never started (bad trigger filter, required status check not configured). `vv watch-pr` will surface the pending state; confirm the workflow actually queued via `gh run list` on the branch.

**"Flake on main"** — run `vv validate --retry-failed` to re-run only the failing step. If it passes on retry without code changes, `vv` warns you it looks flaky. Fix the underlying race before it bites again.

**"CI passes but no state was recorded"** — the validate step crashed before writing state (OOM, timeout, segfault, config syntax error). Check the raw CI logs for the exit signal, not the extraction. Consider adding `--debug` to the CI invocation to capture full output as an artifact.

**"Extracted errors are empty despite a failure"** — the extractor didn't recognize the tool's output format. See `vibe-validate:authoring-extractors` for how to build a custom extractor and validate it against the CI output.

## See also

- `vibe-validate:vv-validate-dev-loop` — the local validation loop, state queries, and `vv run`.
- `vibe-validate:caching-and-locking` — why local and CI sometimes compute different tree hashes, and how to bring them back into agreement.
- `vibe-validate:authoring-extractors` — when CI output isn't yielding extracted errors, fix the extractor.
- `vibe-validate:setting-up-projects` — `vv generate-workflow` for bootstrapping GitHub Actions CI that integrates cleanly with `watch-pr`.
