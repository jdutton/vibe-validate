# Git Hook Safety: GIT_* Env Var Scrubbing

When `vv` runs as a git pre-commit hook (e.g., invoked from `.git/hooks/pre-commit`), git sets a number of `GIT_*` environment variables on the hook process. Among them: `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`.

These vars **override `cwd`** when any child process invokes `git`. A validation step (typically a test) that creates a temp git repository via `mkdtempSync` and runs `git init` / `git commit` / `git config` against it — passing `cwd: <tmpdir>` to `execSync` — would have `git` silently operate on the **parent repository's `.git/index` and branch refs** instead. The corruption is silent: no error is raised. Real commits survive only via the reflog.

## What vv does

Before spawning any validation step, vv strips a focused **blacklist** of dangerous `GIT_*` environment variables from the inherited `process.env`. The blacklist is exactly the set of vars that can:

1. Redirect git operations to a different repository,
2. Override repository discovery,
3. Load alternate git configuration, or
4. Alter the history view git sees.

Everything else `GIT_*` (identity, editor, SSH/credentials, tracing, pager) is inherited normally — none of those can redirect operations to a different repo.

### Stripped (dangerous)

- **Repository / index / worktree redirect:** `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`
- **Ref namespace:** `GIT_NAMESPACE`
- **Discovery behavior:** `GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM`
- **Alternate config:** `GIT_CONFIG`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_COUNT`, plus all numbered `GIT_CONFIG_KEY_*` / `GIT_CONFIG_VALUE_*`
- **Notes redirect:** `GIT_NOTES_REF` (would steer vv's own cache to a different ref)
- **History alteration:** `GIT_SHALLOW_FILE`, `GIT_GRAFT_FILE`

### Preserved (everything else)

- **Identity:** `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_AUTHOR_DATE`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`, `GIT_COMMITTER_DATE`
- **Editor / UI:** `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_PAGER`
- **SSH / network / credentials:** `GIT_SSH`, `GIT_SSH_COMMAND`, `GIT_SSH_VARIANT`, `GIT_ASKPASS`, `GIT_TERMINAL_PROMPT`, `GIT_HTTP_USER_AGENT`, `GIT_HTTP_LOW_SPEED_LIMIT`, `GIT_HTTP_LOW_SPEED_TIME`, `GIT_PROXY_COMMAND`
- **Tracing / debug:** `GIT_TRACE`, all `GIT_TRACE_*`, `GIT_TRACE2*`, `GIT_CURL_VERBOSE`, `GIT_PROGRESS`
- **Cosmetic:** `GIT_REFLOG_ACTION`, `GIT_MERGE_AUTOEDIT`, `GIT_FLUSH`
- Any other `GIT_*` not in the dangerous list — including future vars added by upstream git.

The strip applies to spawned steps under:

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

In the rare case a step legitimately needs a stripped `GIT_*` var (e.g., a release-orchestrator test that deliberately exercises `GIT_DIR` redirection against a tmp repo and *does* want the parent context for some reason), declare it explicitly in the step's `env:` field in `vibe-validate.config.yaml`:

```yaml
phases:
  - name: Special
    steps:
      - name: needs-alternate-config
        command: pnpm test:that-needs-it
        env:
          GIT_CONFIG_GLOBAL: "/path/to/test-only-config"
```

Per-step `env:` always wins over the scrub.

## Why not just `cwd`?

`GIT_DIR` and `GIT_INDEX_FILE` are documented in git as overriding repository discovery. `cwd` only affects where git *starts looking* for a `.git` directory; `GIT_DIR` short-circuits the search entirely. `git -C <path>` has the same limitation — it changes git's working directory but does not unset `GIT_*` vars.

## Related

- Issue: https://github.com/jdutton/vibe-validate/issues/157
