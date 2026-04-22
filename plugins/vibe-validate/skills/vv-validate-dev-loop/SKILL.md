---
name: vv-validate-dev-loop
description: Use when running validation during day-to-day coding — vv validate, vv pre-commit, vv state, vv run. Covers the iterate-fix-revalidate loop, cached state queries, and command wrapping for LLM-optimized error extraction.
---

# vv-validate-dev-loop

## When to use

Use this skill for the day-to-day coding loop: editing code, running validation, reading extracted errors, fixing, and revalidating. It covers `vv validate`, `vv pre-commit`, `vv state`, `vv run`, and `vv sync-check`.

vibe-validate provides **confidence checkpoints**, not mandatory gates. Adopters choose where the checkpoint goes — as a pre-commit hook, a pre-push hook, an ad-hoc command an agent runs after each change, or in CI. This skill describes the mechanics; the placement is a project choice.

## The core loop

```
edit code
  ↓
run validation   (vv validate | vv pre-commit | vv run <cmd>)
  ↓
  ├─ pass  → reach a checkpoint (commit, push, hand back to user, continue)
  └─ fail
       ↓
       vv state           (read extracted errors — instant, no re-run)
       ↓
       fix the errors shown
       ↓
       re-run validation  (mostly cache hits; changed code re-executes)
       ↓
       repeat until pass
```

Two rules keep this loop efficient:

1. **Query `vv state` instead of re-running to read errors.** The last run's result and extracted errors are already cached.
2. **Re-run validation after every fix before declaring the change complete.** Caching makes this cheap; skipping it misses side effects.

## `vv validate` — full pipeline

Runs every validation step defined in `vibe-validate.config.yaml` (typecheck, lint, tests, custom steps), honoring parallelism and dependencies. Result is cached by git tree hash — same content, same cached answer.

```bash
vv validate                   # run full pipeline (cache-aware)
vv validate --force           # re-run everything, ignore all cache
vv validate --retry-failed    # re-run only failed steps; keep passed steps cached
vv validate --check           # exit 0 if already cached passing, 1 otherwise; no execution
```

When to reach for each:

- **Plain `vv validate`** — default. Fast on unchanged code; runs only what changed otherwise.
- **`--retry-failed`** — a transient failure (network blip, flaky test, resource contention). Keeps passed steps cached; re-runs only the failures. Warns when a step passes on retry with no code change (flaky indicator).
- **`--force`** — you suspect stale cache or want a clean-room run before pushing a release candidate.
- **`--check`** — scripting: "is this commit already known-good?" without executing anything.

For why validation re-ran (or didn't), see `vibe-validate:caching-and-locking`.

## `vv pre-commit` — branch-synced validation

A superset of `vv validate` that adds a branch-sync check (is the branch behind `origin/main`?) and, if configured, a staged-secret scan. It's **one natural place to put the checkpoint** — wired as a git pre-commit hook — but the same result is available from `vv validate` + `vv sync-check` invoked anywhere in the workflow.

```bash
vv pre-commit                 # branch sync + full validation + secret scan
```

If it fails with "branch behind origin":

```bash
git fetch origin
git merge origin/main         # or: git rebase origin/main
vv pre-commit                 # re-run (cached where possible)
```

Equally valid alternatives to `vv pre-commit`:

- Run `vv validate` manually after each logical change — agent-driven loop.
- Run `vv validate` on a pre-push hook instead of pre-commit — faster local commits, gate before sharing.
- Run `vv validate --check` in CI as a belt-and-suspenders layer.

## `vv state` — query cached state

Reads the cached result of the last validation run on the current tree. Instant; never executes validation steps. Output is YAML with extracted errors.

```bash
vv state                      # compact YAML: pass/fail, failed step, extracted errors
vv state --verbose            # include full failedStepOutput
```

Typical failing output:

```yaml
passed: false
failedStep: TypeScript
rerunCommand: tsc --noEmit
extraction:
  totalErrors: 2
  errors:
    - file: src/feature.ts
      line: 42
      message: "Type 'string' is not assignable to type 'number'"
```

The loop: `vv validate` fails → `vv state` shows which step failed and the extracted errors → fix those files → `vv validate` again.

## `vv run <command>` — wrap any command

Wraps any shell command (tests, lint, typecheck, build) to add two things the raw command doesn't provide:

1. **Tree-hash caching.** Re-running on the same tree is instant; new output only when code actually changes.
2. **Error extraction.** Verbose tool output collapses into a concise YAML block with `file`, `line`, `message` — typically 90–95% smaller than raw output, massively reducing context usage.

```bash
vv run npx vitest path/to/foo.test.ts
vv run pnpm --filter @pkg test
vv run tsc --noEmit
vv run eslint src/
vv run --check  npx vitest foo.test.ts      # cache lookup only; no execution
vv run --force  npx vitest foo.test.ts      # ignore cache; re-execute
```

Example output on failure:

```yaml
exitCode: 1
extraction:
  totalErrors: 1
  errors:
    - file: foo.test.ts
      line: 42
      message: "Expected 5 to equal 6"
  summary: "1 test failure"
  metadata:
    detection:
      extractor: vitest
```

Use `vv run` for:

- Ad-hoc test/lint/typecheck invocations during development.
- Any command you'll likely repeat and whose output is bulky.
- Commands in any language ecosystem — built-in extractors cover TypeScript, ESLint, Vitest/Jest, Prettier, Maven, OpenAPI, with a generic fallback.

Don't use `vv run` for:

- Watch modes (`vitest --watch`, `next dev`, `tsc --watch`).
- Already-orchestrated commands (`vv validate` — it already extracts).
- Interactive commands (`git log`, `npm init`).
- One-shot commands whose output you want verbatim.

If `vv run` returns `totalErrors: 0` but `exitCode: 1`, the extractor fell back to generic — see `vibe-validate:authoring-extractors`.

## `vv sync-check` — branch divergence

Reports whether the current branch is behind, ahead of, or in sync with its upstream (usually `origin/main`). `vv pre-commit` calls this internally; run it directly when you want the answer without triggering validation.

```bash
vv sync-check                 # YAML status: ahead/behind/in-sync/no-remote
```

Typical recovery when behind:

```bash
git fetch origin
git merge origin/main         # or rebase
```

## Secret-scanning prevention

When configured, `vv pre-commit` runs a staged-only secret scan (Gitleaks by default) before validation, blocking secrets from entering git. Once a secret is committed and pushed, it's compromised regardless of how fast it's detected — prevention at the pre-commit checkpoint is the only real fix.

This skill describes the runtime behavior. For enabling, choosing a scanner, managing false positives (`.gitleaksignore`, `gitleaks:allow` inline comments, baselines for legacy repos), see `vibe-validate:setting-up-projects`.

## Operational reminders for AI agents

**After fixing errors, always re-run validation before considering the change complete.** Caching makes the re-run instant when correct; it catches side effects when wrong. Don't skip it on the theory that "the fix was obvious" — that's how regressions sneak into commits.

**Read state, don't re-run, to see errors.** When validation just failed, `vv state` gives you the extracted errors for free. Running validation a second time to "see what failed" wastes time and context.

**Wrap ad-hoc commands with `vv run`.** Raw `npm test` output can be thousands of lines; the extracted form is dozens. The token savings compound across the iterate-fix-revalidate loop.

Invocations — use whichever matches the adopter's environment:

- `vv validate`, `vv pre-commit`, `vv state`, `vv run …`, `vv sync-check` — installed CLI (short alias).
- `vibe-validate validate` etc. — installed CLI (long name).
- `npx vibe-validate validate`, `pnpm dlx vibe-validate validate`, `bunx vibe-validate validate` — one-off without a local install.

Many adopter repos wire project wrapper scripts (e.g., `pnpm validate`, `npm run validate`, `just validate`). If the repo's `CLAUDE.md` or README documents one, prefer it for consistency with the team's workflow — but the canonical `vv` invocations above always work.

## Common failure patterns

- **"Branch behind origin/main" from `vv pre-commit`.** Merge or rebase from `origin/main`, then re-run. Cached validation results for the pre-merge tree still apply to unchanged files.

- **Validation appears to re-run every time on unchanged code.** Usually uncommitted build artifacts (`dist/`, `coverage/`, `.tsbuildinfo`) are changing the tree hash. Add them to `.gitignore`. For deeper diagnostics (tree-hash mismatch, ignored-file leakage, locking conflicts), see `vibe-validate:caching-and-locking`.

- **Validation locked by a concurrent run.** By default each worktree locks independently. For one-off bypass: `vv validate --no-lock` or `vv validate --no-wait`. For persistent config, see `vibe-validate:caching-and-locking`.

- **A test passes on `--retry-failed` with no code change.** That's a flaky test — `vv validate` emits a warning. Investigate the root cause rather than papering over it with retries.

- **Validation fails but `vv state` shows `totalErrors: 0`.** The extractor didn't recognize the tool's output and fell back to generic. Add or tune a custom extractor — see `vibe-validate:authoring-extractors`.

- **"Which commit was this tree last validated at?"** `vv history list --limit 5` shows recent snapshots and their tree hashes. For recovery from those snapshots, see `vibe-validate:recovering-work`.

## See also

- `vibe-validate:setting-up-projects` for `vibe-validate.config.yaml` structure, templates, dep-lock and secret-scan configuration.
- `vibe-validate:caching-and-locking` for why validation re-ran (or didn't) and how locking interacts with concurrent runs.
- `vibe-validate:authoring-extractors` when validation fails but produces no extracted errors.
- `vibe-validate:vv-watch-pr` for post-push CI monitoring and pulling validation state out of failed CI runs.
- `vibe-validate:recovering-work` to recover files or entire trees from previous validation snapshots.
