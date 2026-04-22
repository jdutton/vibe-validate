---
name: setting-up-projects
description: Use when bootstrapping vibe-validate in a new repo, adjusting the config, or diagnosing setup. Covers vv init, vv doctor, vv config, templates, heterogeneous-language setup, generate-workflow, and dependency-lock-check.
---

# setting-up-projects

## When to use

- Adding vibe-validate to a repo for the first time (install + `vv init`)
- Picking a template (`typescript-library`, `typescript-nodejs`, `typescript-react`, `minimal`)
- Running `vv doctor` after install/upgrade or when something looks off
- Inspecting or validating the current config (`vv config`)
- Generating or refreshing the GitHub Actions workflow (`vv generate-workflow`)
- Setting up a non-TypeScript or multi-language project (Python, Go, Rust, Java, mixed)
- Configuring `ci.dependencyLockCheck` to prevent cache poisoning from stale lockfiles

Day-to-day validate/fix work lives in `vibe-validate:vv-validate-dev-loop`, not here.

## First-time setup

### Install

`vibe-validate` is published to npm and works with any Node.js package manager. Pick one:

```bash
npm install -D vibe-validate
pnpm add -D vibe-validate
yarn add -D vibe-validate
bun add -d vibe-validate
```

Prerequisites: **Node.js 20+**, a git repository (`git init` if the repo isn't initialized yet).

After install, the short `vv` binary is available. Pre-install one-offs can use `npx vibe-validate <cmd>`, `pnpm dlx vibe-validate <cmd>`, or `bunx vibe-validate <cmd>`.

### `vv init` — interactive setup with templates

```bash
vv init                                    # interactive, defaults to minimal
vv init --template typescript-library
vv init --template typescript-nodejs
vv init --template typescript-react
vv init --template minimal
```

What gets created:

- `vibe-validate.config.yaml` at the project root — the single source of truth for phases, steps, caching, locking, CI, and agent output.
- Optionally, a Husky pre-commit hook (`.husky/pre-commit`) if you opt in.
- Optionally, `.github/workflows/validate.yml` if you opt in to workflow generation.

Template picker:

- `minimal` — one phase, one step (`npm test`). Good starting point for heterogeneous / non-Node projects; you will edit it heavily.
- `typescript-library` — npm packages and shared libraries. Lint + typecheck + build + test.
- `typescript-nodejs` — Node.js apps, APIs, backend services.
- `typescript-react` — React SPAs and Next.js apps (includes build + test-with-coverage patterns).

After init, always run `vv doctor` to confirm the environment is healthy.

### `vv doctor` — post-install diagnostics

```bash
vv doctor
```

Checks (non-exhaustive):

- **Node.js version** — must be `>= 20`.
- **Package manager** — detects npm / pnpm / yarn / bun from lock file or the `packageManager` field in `package.json`.
- **Git repository** — repo initialized, `git.mainBranch` exists locally, `remoteOrigin` reachable if configured.
- **Configuration valid** — YAML parses and matches the Zod schema (same check as `vv config`).
- **Deprecated state files** — warns about `.vibe-validate-state.yaml` leftover from pre-0.12 (validation now uses git notes).
- **Validation history** — git notes refs are healthy and not corrupt.
- **Pre-commit hook** — if Husky or a git hook is present, confirms it invokes vibe-validate.
- **GitHub Actions workflow** — if `.github/workflows/validate.yml` exists, checks it is in sync with the current config (see `ci.disableWorkflowCheck` below for multi-language projects).
- **Secret scanning** — detects available tools (`gitleaks`, `trufflehog`, etc.) used by `vv pre-commit`.
- **`vibe-validate` version** — reports current vs latest published version.
- **Dependency lock check configuration** — warns if `ci.dependencyLockCheck` is unset (see below).

Every failing check prints a fix suggestion. Run it after install, after upgrading vibe-validate, and any time validation behaves unexpectedly.

## Configuration overview

All configuration lives in `vibe-validate.config.yaml` at the project root. For IDE autocomplete:

```yaml
$schema: https://unpkg.com/@vibe-validate/config/config.schema.json
```

Top-level sections, in rough order of importance:

- `validation.phases` — the heart of the config. Ordered list of phases; each phase has `steps`. Phases run **sequentially**; steps within a phase run sequentially by default or in parallel with `parallel: true`.
- `git` — `mainBranch`, `remoteOrigin`, `autoSync`.
- `ci` — `nodeVersions`, `packageManager`, `dependencyLockCheck`, `disableWorkflowCheck`.
- `locking` — concurrency scope and wait behavior (see `vibe-validate:caching-and-locking`).
- `agent` — output tuning for LLM consumers (`maxTokens`, `context`).

For the **full schema** — every field, every default, every enum value — see `configuration-reference.md` in this directory. Machine-readable schema is in `config.schema.json` (same directory), with field-level notes in `schemas.md`.

Minimal example (what `vv init --template minimal` produces):

```yaml
$schema: https://unpkg.com/@vibe-validate/config/config.schema.json

git:
  mainBranch: main
  remoteOrigin: origin
  autoSync: false

ci:
  dependencyLockCheck:
    runOn: pre-commit

validation:
  phases:
    - name: Validation
      parallel: false
      steps:
        - name: Tests
          command: npm test
  failFast: true
```

### `vv config` — show/validate current config

```bash
vv config            # print resolved config as YAML
vv config --check    # validate schema only; exits non-zero on error
```

Use `vv config` when:

- You want to see the merged/defaulted view (schema defaults filled in).
- You edited the file and want to confirm it parses before running validation.
- You are debugging why a field appears not to take effect.

### `vv generate-workflow` — GitHub Actions integration

```bash
vv generate-workflow                                        # print to stdout
vv generate-workflow --output .github/workflows/validate.yml
```

Generates a GitHub Actions workflow from `validation.phases` + `ci.nodeVersions` + `ci.packageManager`. Parallel phases become parallel jobs; `cwd` fields become `working-directory:` on each step.

Keep the workflow in sync: `vv doctor` compares the file against what `generate-workflow` would produce and warns on drift. Regenerate after any meaningful `validation` or `ci` change and commit the result.

When the generator is not a fit (multi-language toolchains, `setup-java`, `setup-python`, Docker-based CI), set:

```yaml
ci:
  disableWorkflowCheck: true
```

This suppresses the drift warning. Maintain the workflow file by hand from that point on.

## Heterogeneous (non-TypeScript) setup

vibe-validate is language-agnostic. The only requirement is a git repo and a Node.js install (for the CLI). Everything else — test runners, linters, compilers — is whatever your project already uses.

**Key rule: use `cwd`, never embed `cd` in the command string.** `cwd` paths are resolved relative to the git root, work cross-platform, and keep the cache key stable regardless of where the user invokes `vv`.

```yaml
validation:
  phases:
    - name: lint
      parallel: true
      steps:
        - name: lint-python
          cwd: services/ml-engine
          command: ruff check src/
        - name: lint-rust
          cwd: services/payments
          command: cargo clippy -- -D warnings
        - name: lint-go
          cwd: services/auth
          command: golangci-lint run ./...

    - name: test
      parallel: true
      steps:
        - { name: test-python, cwd: services/ml-engine, command: pytest }
        - { name: test-rust,   cwd: services/payments,  command: cargo test }
        - { name: test-go,     cwd: services/auth,      command: go test ./... }
```

Guidelines:

- **Group by purpose, not language.** One `lint` phase that parallelizes across all languages beats one `python-lint` phase followed by `rust-lint` followed by `go-lint`.
- **Sequential phases for dependencies.** If a shared package must build before downstream tests, put it in an earlier phase.
- **Absolute paths and `..` escapes are rejected.** `cwd` must resolve inside the git root.
- **Forward slashes only** in `cwd`, even on Windows.
- **Per-step environment variables** via `env:` — use instead of shell prefixes like `NODE_ENV=test npm test`.
- **Error extraction** falls back to a generic pattern matcher when no language-specific extractor applies. For better LLM-facing output on uncommon tools, see `vibe-validate:authoring-extractors`.
- **Workflow generation** preserves `cwd` as `working-directory:`, but multi-language projects typically need `setup-*` actions the generator doesn't produce — set `ci.disableWorkflowCheck: true` and maintain the workflow by hand.

For many more patterns (Maven + npm + pytest monorepos, incremental migration, Docker-based validation), the full Heterogeneous Projects guide lives in the repo docs — but all the shape-of-config guidance above is sufficient for most setups.

## Dependency lock check — prevent cache poisoning

The problem: a developer edits `package.json` but forgets to run `npm install`. Tests pass locally against the **old** `node_modules`, the passing result gets cached by tree hash, CI then does a fresh install and fails. Classic "works on my machine."

`ci.dependencyLockCheck` runs the package manager's frozen-lockfile install (or equivalent) **before validation executes on a cache miss**, blocking the run until the lockfile and `package.json` agree. On a cache hit, nothing runs — a previously-cached pass implies the lockfile was correct for that tree.

Basic config:

```yaml
ci:
  dependencyLockCheck:
    runOn: pre-commit    # recommended default
```

`runOn` values:

- `pre-commit` — run only during `vv pre-commit`. Recommended for most projects. Ad-hoc `vv validate` stays fast.
- `validate` — run on every `vv validate` and `vv pre-commit`. Strictest; use for critical projects.
- `disabled` — never run. Use when your dependency workflow is non-standard and the check produces only noise.

If `dependencyLockCheck` is omitted entirely, behavior matches `pre-commit` but `vv doctor` warns — opt in explicitly.

**Package manager auto-detection** priority:

1. `ci.dependencyLockCheck.packageManager` (override for this check only)
2. `ci.packageManager` (repo-wide override)
3. `packageManager` field in `package.json`
4. Lock file on disk (`bun.lockb` > `yarn.lock` > `pnpm-lock.yaml` > `package-lock.json`)

Default commands per manager: `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`, `bun install --frozen-lockfile`. Override with `command:` when you need `--legacy-peer-deps`, a custom registry, or similar.

**npm link auto-skip.** If `node_modules` contains symlinks (typical for local package development), the check detects them via `fs.lstatSync` and skips with a warning — frozen-lockfile installs would otherwise delete those symlinks. To force-bypass for any reason: `VV_SKIP_DEPENDENCY_CHECK=1 vv validate`.

## Common setup issues

**"No configuration file found."** You haven't run `vv init` yet, or the config is in the wrong directory. It must be named exactly `vibe-validate.config.yaml` and sit at the project root (same directory as `package.json`).

**"Node.js version too old."** vibe-validate requires Node 20+. `vv doctor` prints the exact installed version. Upgrade Node, then re-run.

**"Not in a git repository."** Run `git init` first. vibe-validate uses git tree hashes as cache keys and git notes for validation history — it cannot run outside a repo.

**"Configuration invalid."** Run `vv config --check` for the Zod error message. Most often: a step missing `name` or `command`, a typo in `runOn:` (only `pre-commit`, `validate`, `disabled` are accepted), or a `cwd` with an absolute path or `..` escape.

**"GitHub Actions workflow out of sync."** Two cases. (a) The generator fits your project — regenerate and commit: `vv generate-workflow --output .github/workflows/validate.yml`. (b) The generator doesn't fit (multi-language, custom setup actions) — set `ci.disableWorkflowCheck: true` and hand-maintain the workflow.

**"Deprecated state file found."** A pre-0.12 `.vibe-validate-state.yaml` exists. Delete it; current state lives in git notes under `refs/notes/vibe-validate/*`.

## See also

- `vibe-validate:vv-validate-dev-loop` for running validation and iterating on failures after setup is done
- `vibe-validate:caching-and-locking` for cache-key semantics, `locking.concurrencyScope`, and `--no-lock` / `--no-wait`
- `vibe-validate:recovering-work` for history snapshots and recovering deleted files from past validation runs
- `vibe-validate:vv-watch-pr` for CI / PR monitoring after `vv generate-workflow` is in place
- `vibe-validate:authoring-extractors` for custom error extractors when the generic extractor falls short on heterogeneous projects
- `vibe-validate:integrating-agents` for pointing Cursor, Aider, Continue, or other non-Claude agents at vibe-validate
- `configuration-reference.md` in this directory for the complete config schema (every field, every default)
- `config.schema.json` and `schemas.md` in this directory for the machine-readable schema and field-level notes
