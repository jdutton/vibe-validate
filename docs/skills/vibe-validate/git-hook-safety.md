# Git Hook Safety: GIT_* Env Var Scrubbing

When `vv` runs as a git pre-commit hook (e.g., invoked from `.git/hooks/pre-commit`), git sets a number of `GIT_*` environment variables on the hook process. Among them: `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`.

These vars **override `cwd`** when any child process invokes `git`. A validation step (typically a test) that creates a temp git repository via `mkdtempSync` and runs `git init` / `git commit` / `git config` against it — passing `cwd: <tmpdir>` to `execSync` — would have `git` silently operate on the **parent repository's `.git/index` and branch refs** instead. The corruption is silent: no error is raised. Real commits survive only via the reflog.

## What vv does

Before spawning any validation step, vv strips every environment variable whose name starts with `GIT_` from the inherited `process.env`. This applies to:

- `vv validate`
- `vv pre-commit`
- `vv run <command>`

vv's own `process.env` is **not** modified — only the env passed to the subprocess. vv's hook-aware behavior (reading the staged index, partial-staging checks) is preserved.

## Who is affected

The intersection of:

1. Repositories that run `vv` as a git pre-commit hook, **AND**
2. Repositories whose validation steps shell out to `git` against temp directories.

The second condition is rare in practice: it applies to tests for tooling that itself wraps git (release orchestrators, plugin scaffolders, monorepo build tools, anything that automates commits/tags). The vast majority of validation steps — lint, typecheck, build, unit tests that don't touch git — are unaffected either way.

## Opting back in for a specific step

If a step legitimately needs a `GIT_*` var (rare), declare it explicitly in the step's `env:` field in `vibe-validate.config.yaml`:

```yaml
phases:
  - name: Special
    steps:
      - name: needs-git-author
        command: pnpm test:that-needs-it
        env:
          GIT_AUTHOR_NAME: "CI"
          GIT_AUTHOR_EMAIL: "ci@example.com"
```

Per-step `env:` always wins over the scrub.

## Why not just `cwd`?

`GIT_DIR` and `GIT_INDEX_FILE` are documented in git as overriding repository discovery. `cwd` only affects where git *starts looking* for a `.git` directory; `GIT_DIR` short-circuits the search entirely. `git -C <path>` has the same limitation — it changes git's working directory but does not unset `GIT_*` vars.

## Related

- Issue: https://github.com/jdutton/vibe-validate/issues/157
