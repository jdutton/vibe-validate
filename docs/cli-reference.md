# CLI Reference

> **Complete command-line reference for vibe-validate**
>
> **This document is auto-synced with `vibe-validate --help --verbose` output**
>
> The content below is the exact output from running `vibe-validate --help --verbose`. This ensures perfect accuracy between CLI and documentation.

---
# vibe-validate CLI Reference

> Agent-friendly validation framework with git tree hash caching

## Usage

```bash
vibe-validate <command> [options]
```

## Commands

### `validate`

Run validation with git tree hash caching

**What it does:**

1. Calculates git tree hash of working directory
2. Checks if hash matches cached state
3. If match: exits immediately (sub-second)
4. If no match: runs validation pipeline (~60-90s)
5. Caches result for next run

**Exit codes:**

- `0` - Validation passed (or cached pass)
- `1` - Validation failed
- `2` - Configuration error

**Creates/modifies:**

- Git notes under refs/notes/vibe-validate/validate

**Options:**

- `-f, --force` - Force validation even if already passed
- `-v, --verbose` - Show detailed progress and output
- `-y, --yaml` - Output validation result as YAML to stdout
- `-c, --check` - Check if validation has already passed (do not run)
- `--no-lock` - Allow concurrent validation runs (disables single-instance mode)
- `--no-wait` - Exit immediately if validation is already running (for background hooks)
- `--wait-timeout <seconds>` - Maximum time to wait for running validation (default: 300)

**Examples:**

```bash
vibe-validate validate              # Use cache if available
vibe-validate validate --force      # Always run validation
vibe-validate validate --check      # Just check if already passed
```

---

### `init`

Initialize vibe-validate configuration

**What it does:**

Creates vibe-validate.config.yaml in project root
Optionally sets up pre-commit hooks
Optionally creates GitHub Actions workflow
Optionally updates .gitignore

**Exit codes:**

- `0` - Configuration created successfully
- `1` - Failed (config exists without --force, or invalid template)

**Creates/modifies:**

- vibe-validate.config.yaml (always)
- .husky/pre-commit (with --setup-hooks)
- .github/workflows/validate.yml (with --setup-workflow)
- Updates .gitignore (with --fix-gitignore)

**Options:**

- `-t, --template <name>` - Template to use (minimal|typescript-library|typescript-nodejs|typescript-react)
- `-f, --force` - Overwrite existing configuration
- `--dry-run` - Preview changes without writing files
- `--setup-hooks` - Install pre-commit hook
- `--setup-workflow` - Create GitHub Actions workflow
- `--fix-gitignore` - Add state file to .gitignore

**Examples:**

```bash
vibe-validate init  # Uses minimal template
vibe-validate init --template typescript-nodejs
vibe-validate init --template typescript-nodejs --setup-workflow --setup-hooks
vibe-validate init --force --template typescript-react  # Overwrite existing
```

---

### `pre-commit`

Run branch sync check + validation (recommended before commit)

**What it does:**

1. Runs sync-check (fails if branch behind origin/main)
2. Runs validate (with caching)
3. Reports git status (warns about unstaged files)

**Exit codes:**

- `0` - Sync OK and validation passed
- `1` - Sync failed OR validation failed

**When to use:** Run before every commit to ensure code is synced and validated

**Options:**

- `--skip-sync` - Skip branch sync check
- `-v, --verbose` - Show detailed progress and output

**Error recovery:**

If **sync failed**:
```bash
git fetch origin
git merge origin/main
Resolve conflicts if any
vibe-validate pre-commit  # Retry
```

If **validation failed**:
```bash
Fix errors shown in output
vibe-validate pre-commit  # Retry
```

**Examples:**

```bash
vibe-validate pre-commit  # Standard pre-commit workflow
vibe-validate pre-commit --skip-sync  # Skip sync check (not recommended)
```

---

### `state`

Show current validation state from git notes

**What it does:**

Shows validation pass/fail status
Shows git tree hash (cache key)
Shows timestamp of last validation
Shows error summary (if failed)

**Exit codes:**

- `0` - State file found and read successfully
- `1` - State file not found or invalid

**When to use:** Debug why validation is cached/not cached, or see errors without re-running

**Options:**

- `-v, --verbose` - Show full error output without truncation

**Examples:**

```bash
vibe-validate state           # Show current state
vibe-validate state --verbose # Show full error output
```

---

### `sync-check`

Check if branch is behind remote main branch

**What it does:**

Checks if current branch is behind remote main
Compares local and remote commit histories
Reports sync status

**Exit codes:**

- `0` - Up to date or no remote tracking
- `1` - Branch is behind (needs merge)
- `2` - Git command failed

**Options:**

- `--main-branch <branch>` - Main branch name (overrides config)
- `--remote-origin <remote>` - Remote origin name (overrides config)
- `--yaml` - Output YAML only (no human-friendly display)

**Error recovery:**

If **branch behind (exit 1)**:
```bash
git fetch origin
git merge origin/main  # or git rebase origin/main
Resolve conflicts if any
vibe-validate pre-commit  # Retry
```

**Examples:**

```bash
vibe-validate sync-check
vibe-validate sync-check --yaml  # YAML output only
```

---

### `cleanup`

Post-merge cleanup (switch to main, delete merged branches)

**What it does:**

1. Switches to main branch
2. Pulls latest from origin/main
3. Identifies merged branches (via git log)
4. Deletes confirmed-merged branches
5. Reports cleanup summary

**Exit codes:**

- `0` - Cleanup successful
- `1` - Failed (not on deletable branch, git errors)

**When to use:** After PR merge to clean up local branches

**Options:**

- `--main-branch <branch>` - Main branch name
- `--dry-run` - Show what would be deleted without actually deleting
- `--yaml` - Output YAML only (no human-friendly display)

**Examples:**

```bash
vibe-validate cleanup --dry-run  # Preview
vibe-validate cleanup            # Execute
```

---

### `config`

Show or validate vibe-validate configuration

**What it does:**

Shows resolved configuration
Validates configuration structure
Displays all configuration settings

**Exit codes:**

- `0` - Configuration valid
- `1` - Configuration invalid or not found

**Options:**

- `--validate` - Validate configuration only (exit 0 if valid, 1 if invalid)
- `-v, --verbose` - Show detailed configuration with explanations

**Examples:**

```bash
vibe-validate config            # Show config
vibe-validate config --validate # Validate only
```

---

### `generate-workflow`

Generate GitHub Actions workflow from vibe-validate config

**What it does:**

Generates .github/workflows/validate.yml from config
Supports matrix mode (multiple Node/OS versions)
Supports non-matrix mode (separate jobs per phase)
Can check if workflow is in sync with config

**Exit codes:**

- `0` - Workflow generated (or in sync with --check)
- `1` - Generation failed (or out of sync with --check)

**Creates/modifies:**

- .github/workflows/validate.yml

**Options:**

- `--check` - Check if workflow is in sync with config (exit 0 if in sync, 1 if not)
- `--dry-run` - Show generated workflow without writing to file
- `--coverage` - Enable coverage reporting (Codecov)
- `--node-versions <versions>` - Node.js versions to test (comma-separated, default: "20,22")
- `--os <systems>` - Operating systems to test (comma-separated, default: "ubuntu-latest")
- `--fail-fast` - Fail fast in matrix strategy (default: false)

**Examples:**

```bash
vibe-validate generate-workflow
vibe-validate generate-workflow --node-versions 20,22 --os ubuntu-latest,macos-latest
vibe-validate generate-workflow --check  # Verify workflow is up to date
```

---

### `doctor`

Diagnose vibe-validate setup and environment (run after upgrading)

**What it does:**

Checks Node.js version (20+)
Verifies git repository exists
Checks package manager availability
Validates configuration file
Checks pre-commit hook setup
Verifies GitHub Actions workflow

**Exit codes:**

- `0` - All critical checks passed
- `1` - One or more critical checks failed

**When to use:** Diagnose setup issues or verify environment before using vibe-validate

**Options:**

- `--yaml` - Output YAML only (no human-friendly display)

**Examples:**

```bash
vibe-validate doctor         # Run diagnostics
vibe-validate doctor --yaml # YAML output only
```

---

### `watch-pr`

Watch CI checks for a pull/merge request in real-time

**What it does:**

1. Detects PR from current branch (or uses provided PR number)
2. Polls CI provider (GitHub Actions) for check status
3. Shows real-time progress of all matrix jobs
4. On failure: fetches logs and extracts vibe-validate state file
5. Provides actionable recovery commands
6. Exits when all checks complete or timeout reached

**Exit codes:**

- `0` - All checks passed
- `1` - One or more checks failed
- `2` - Timeout reached before completion

**When to use:** Monitor CI checks in real-time after pushing to PR, especially useful for AI agents

**Options:**

- `--provider <name>` - Force specific CI provider (github-actions, gitlab-ci)
- `--yaml` - Output YAML only (no interactive display)
- `--timeout <seconds>` - Maximum time to wait in seconds (default: 3600)
- `--poll-interval <seconds>` - Polling frequency in seconds (default: 10)
- `--fail-fast` - Exit immediately on first check failure

**Error recovery:**

If **check fails**:
```bash
# View validation result from YAML output
vibe-validate watch-pr 42 --yaml | yq '.failures[0].validationResult'

# Re-run failed check
gh run rerun <run-id> --failed
```

If **no PR found**:
```bash
# Create PR first
gh pr create

# Or specify PR number explicitly
vibe-validate watch-pr 42
```

**Examples:**

```bash
git push origin my-branch
vibe-validate watch-pr              # Auto-detect PR
vibe-validate watch-pr 42           # Watch specific PR
vibe-validate watch-pr --yaml      # YAML output only
vibe-validate watch-pr --fail-fast  # Exit on first failure
vibe-validate watch-pr --timeout 600  # 10 minute timeout
```

---

### `history`

View and manage validation history stored in git notes

---

### `run`

Run a command and extract LLM-friendly errors (with smart caching)

**What it does:**

1. Executes command in shell subprocess
2. Captures stdout and stderr output
3. Auto-detects format (vitest, jest, tsc, eslint, etc.)
4. Extracts errors using appropriate extractor
5. Outputs structured YAML with error details
6. Passes through exit code from command

**Exit codes:**

- `0` - Command succeeded
- `1` - Command failed (same code as original command)

**When to use:** Run individual tests or validation steps with LLM-friendly error extraction

**Options:**

- `--check` - Check if cached result exists without executing
- `--force` - Force execution and update cache (bypass cache read)

**Examples:**

```bash
vibe-validate run "npx vitest test.ts"           # Single test file
vibe-validate run "npx vitest -t 'test name'"    # Specific test
vibe-validate run "pnpm --filter @pkg test"    # Package tests
vibe-validate run "npx tsc --noEmit"           # Type check
vibe-validate run "pnpm lint"                  # Lint
```

---

## Global Options

- `-V, --version` - Show vibe-validate version
- `-v, --verbose` - Show detailed output (use with --help for this output)
- `-h, --help` - Show help for command

## Files

| File | Purpose |
|------|---------|
| `vibe-validate.config.yaml` | Configuration (required) |
| `refs/notes/vibe-validate/validate` | Validation state (git notes, auto-created) |
| `.github/workflows/validate.yml` | CI workflow (optional, generated) |
| `.husky/pre-commit` | Pre-commit hook (optional, setup via init) |

## Common Workflows

### First-time setup

```bash
vibe-validate init --template typescript-nodejs --setup-workflow
git add vibe-validate.config.yaml .github/workflows/validate.yml
git commit -m "feat: add vibe-validate"
```

### Before every commit (recommended)

```bash
vibe-validate pre-commit
# If fails: fix errors and retry
```

### After PR merge

```bash
vibe-validate cleanup
# Cleans up merged branches
```

### Check validation state

```bash
vibe-validate state --verbose
# Debug why validation failed
```

### Force re-validation

```bash
vibe-validate validate --force
# Bypass cache, always run
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Failure (validation failed, sync check failed, invalid config) |
| `2` | Error (git command failed, file system error) |

## Caching

- **Cache key**: Git tree hash of working directory (includes untracked files)
- **Cache hit**: Validation skipped (sub-second)
- **Cache miss**: Full validation runs (~60-90s)
- **Invalidation**: Any file change (tracked or untracked)

---

For more details: https://github.com/jdutton/vibe-validate