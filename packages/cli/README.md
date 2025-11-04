# @vibe-validate/cli

> Command-line interface for vibe-validate validation framework

[![npm version](https://img.shields.io/npm/v/@vibe-validate/cli.svg)](https://www.npmjs.com/package/@vibe-validate/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The `@vibe-validate/cli` package provides a command-line interface for running validations with git tree hash-based caching, designed specifically for AI-assisted development workflows.

## Features

- **🚀 Git tree hash-based caching** - 312x faster validation on unchanged code
- **🤖 Agent-friendly output** - Minimal token waste, structured error reporting
- **⚡ Parallel phase execution** - Run validation steps concurrently
- **🔄 Pre-commit workflow** - Automatic branch sync checking + validation
- **📊 State management** - Track validation history and cache status
- **🎯 TypeScript-first** - Full type safety with runtime validation

## Installation

**Recommended**: Install via the umbrella package:

```bash
npm install -D vibe-validate
```

Or use directly via `npx`:

```bash
npx vibe-validate validate
```

> **Note**: This package is also available as `@vibe-validate/cli`, but we recommend using the umbrella package `vibe-validate` for simpler installation.

## Upgrading

After upgrading vibe-validate to a new version, run the doctor command to check for configuration issues and deprecated files:

```bash
npx vibe-validate doctor
```

This will detect deprecated state files, outdated .gitignore entries, and provide actionable migration steps.

## Quick Start

1. **Create configuration file**:

```bash
npx vibe-validate init --template typescript-nodejs
```

This creates `vibe-validate.config.yaml` with sensible defaults.

2. **Run validation**:

```bash
npx vibe-validate validate
```

3. **Check validation state**:

```bash
npx vibe-validate state
```

## Available Commands

### `validate`

Run validation workflow with caching.

```bash
npx vibe-validate validate [options]
```

**Options:**
- `--force` - Bypass cache and force re-validation
- `--no-cache` - Disable caching for this run
- `-v, --verbose` - Show detailed progress and output
- `--config <path>` - Path to config file (default: `vibe-validate.config.yaml`)

**Examples:**

```bash
# Normal validation (uses cache, minimal output)
npx vibe-validate validate

# Force re-validation (bypass cache)
npx vibe-validate validate --force

# Verbose output (detailed progress indicators)
npx vibe-validate validate --verbose

# Custom config file
npx vibe-validate validate --config ./custom-config.yaml
```

**Exit Codes:**
- `0` - Validation passed
- `1` - Validation failed
- `2` - Configuration or runtime error

---

### `state`

Display validation state and cache status.

```bash
npx vibe-validate state [options]
```

**Options:**
- `-v, --verbose` - Show full error output without truncation

**Examples:**

```bash
# Minimal YAML output (agent-friendly)
npx vibe-validate state

# Verbose output (includes explanatory text)
npx vibe-validate state --verbose
```

**Output includes:**
- Last validation result (passed/failed)
- Git tree hash
- Timestamp
- Failed step details (if any)
- Suggested next steps

---

### `config`

Display resolved configuration.

```bash
npx vibe-validate config [options]
```

**Options:**
- `-v, --verbose` - Show detailed configuration with explanations
- `--config <path>` - Path to config file

**Examples:**

```bash
# Show configuration (minimal YAML)
npx vibe-validate config

# Verbose output (includes explanatory text)
npx vibe-validate config --verbose
```

**Use cases:**
- Verify configuration is loaded correctly
- Debug configuration behavior
- Inspect settings

---

### `pre-commit`

Run pre-commit workflow (branch sync + validation).

```bash
npx vibe-validate pre-commit
```

**Workflow:**
1. Check if branch is behind `origin/main`
2. If behind → Exit with instructions to merge
3. If up-to-date → Run validation (with caching)
4. If validation passes → Allow commit
5. If validation fails → Block commit with error details

**Recommended setup** (`.husky/pre-commit`):

```bash
#!/bin/sh
npx vibe-validate pre-commit
```

---

### `sync-check`

Check if current branch is behind the configured remote and main branch.

```bash
npx vibe-validate sync-check [options]
```

**Options:**
- `--main-branch <branch>` - Main branch name (overrides config, default: `main`)
- `--remote-origin <remote>` - Remote origin name (overrides config, default: `origin`)
- `--yaml` - Suppress human-friendly output, output YAML only

**Exit Codes:**
- `0` - Up to date or no remote
- `1` - Behind remote (needs merge)
- `2` - Error condition

**Examples:**

```bash
# Check against configured remote/branch (from config file)
npx vibe-validate sync-check

# Check against upstream/main (forked repos)
npx vibe-validate sync-check --remote-origin upstream

# Check against upstream/develop
npx vibe-validate sync-check --main-branch develop --remote-origin upstream
```

**Configuration:**

Set defaults in `vibe-validate.config.yaml`:

<!-- config:partial -->
```yaml
git:
  mainBranch: main      # Default: 'main'
  remoteOrigin: origin  # Default: 'origin'
```

**Common scenarios:**

<!-- config:partial -->
```yaml
# Forked repository - sync with upstream
git:
  mainBranch: main
  remoteOrigin: upstream

# Legacy project - use master branch
git:
  mainBranch: master
  remoteOrigin: origin
```

---

### `cleanup`

Clean up merged branches after PR merge.

```bash
npx vibe-validate cleanup
```

**Workflow:**
1. Switch to `main` branch
2. Pull latest changes from `origin/main`
3. Identify merged branches
4. Delete merged branches (with confirmation)
5. Report summary

**Safety features:**
- Only deletes confirmed-merged branches
- Never deletes `main`, `master`, or `develop`
- Provides confirmation before deletion

---

### `generate-workflow`

Generate GitHub Actions workflow from vibe-validate configuration.

```bash
npx vibe-validate generate-workflow [options]
```

**Options:**
- `--node-versions <versions>` - Node.js versions to test (comma-separated, default: `"20,22"`)
- `--os <systems>` - Operating systems to test (comma-separated, default: `"ubuntu-latest"`)
- `--fail-fast` - Fail fast in matrix strategy (default: `false`)
- `--coverage` - Enable coverage reporting with Codecov
- `--dry-run` - Show generated workflow without writing to file
- `--check` - Check if workflow is in sync with config (exit 0 if in sync, 1 if not)

**Examples:**

```bash
# Generate workflow with defaults (Node 20,22 on ubuntu-latest)
npx vibe-validate generate-workflow

# Generate workflow with full matrix
npx vibe-validate generate-workflow \
  --node-versions "20,22,24" \
  --os "ubuntu-latest,macos-latest,windows-latest"

# Enable coverage reporting
npx vibe-validate generate-workflow --coverage

# Enable fail-fast (stop on first failure)
npx vibe-validate generate-workflow --fail-fast

# Preview without writing
npx vibe-validate generate-workflow --dry-run

# Check if workflow is in sync
npx vibe-validate generate-workflow --check
```

**What it generates:**

Creates `.github/workflows/validate.yml` with:
- Matrix strategy for multi-OS and multi-Node.js testing
- Automatic pnpm/npm detection
- Validation state artifact upload on failure
- Separate coverage job (if `--coverage` is enabled)
- All-validation-passed gate job

**Matrix mode** (default when multiple versions/OSes):
```yaml
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    node: [20, 22, 24]
```

**Non-matrix mode** (single version/OS or `--no-matrix`):
- Creates individual jobs per validation step
- Preserves phase dependencies

**Workflow sync checking:**

Use `--check` in CI to ensure workflow stays in sync with config:

```yaml
# .github/workflows/validate.yml
- name: Check workflow sync
  run: npx vibe-validate generate-workflow --check
```

**Exit codes:**
- `0` - Workflow generated successfully or in sync
- `1` - Workflow out of sync (when using `--check`)
- `2` - Configuration or runtime error

---

### `doctor`

Check repository health and best practices (run after upgrading vibe-validate).

```bash
npx vibe-validate doctor
```

**Checks:**
- Pre-commit hook installed
- Deprecated state file detection
- Config file is valid
- Git repository exists
- On feature branch (not main)

**Output:**
- ✅ Passing checks
- ⚠️  Warnings with recommendations
- ❌ Failing checks with fix instructions

---

## Configuration

Create `vibe-validate.config.yaml` in your project root:

<!-- config:example -->
```yaml
# JSON Schema for IDE autocomplete
$schema: https://unpkg.com/@vibe-validate/config/config.schema.json

git:
  mainBranch: main
  remoteOrigin: origin
  warnIfBehind: true

validation:
  phases:
    - name: Pre-Qualification
      parallel: true
      steps:
        - name: TypeScript
          command: pnpm typecheck
        - name: ESLint
          command: pnpm lint

    - name: Testing
      steps:
        - name: Unit Tests
          command: pnpm test
```

**Or use a config template:**

```bash
npx vibe-validate init --template typescript-nodejs
```

**Available templates:**
- `minimal` - Bare-bones starting point
- `typescript-library` - TypeScript library (no runtime)
- `typescript-nodejs` - Node.js application with TypeScript
- `typescript-react` - React application with TypeScript

All templates available at: https://github.com/jdutton/vibe-validate/tree/main/packages/cli/config-templates

## Caching

vibe-validate uses **git tree hash-based caching** for deterministic, content-based validation:

**How it works:**
1. Calculate git tree hash of current working tree (includes all changes)
2. Check if hash matches cached state
3. If match → Skip validation (instant, < 1s)
4. If different → Run full validation (~60-90s)

**Performance:**
- **First run**: ~60-90s (depends on your validation steps)
- **Cached run**: < 1s (312x faster!)
- **After code change**: ~60-90s (full re-validation)

**Cache invalidation:**
- Automatic when any file changes (via git tree hash)
- Manual with `--force` flag
- Disabled with `--no-cache` flag

## Agent-Friendly Output

vibe-validate is optimized for AI agents like Claude Code with YAML-only structured output:

**Benefits:**
- **YAML everywhere**: Single format that's both machine and human readable
- **Minimal token waste**: 4-5 lines on failure vs 200+ with traditional tools
- **Structured errors**: Complete details via `vibe-validate state` command
- **Clear next steps**: Actionable commands in validation output
- **Auto-detection**: Minimal output for agents, verbose for interactive terminals
- **Zero noise**: No server logs, no verbose progress bars (unless `--verbose`)

**Example failure output:**

```bash
❌ Validation failed: Phase Pre-Qualification step TypeScript failed

Run 'npx vibe-validate state' for details
```

**Then check state:**

```bash
npx vibe-validate state
```

**Output:**

<!-- validation-result:example -->
```yaml
passed: false
timestamp: 2025-10-16T20:00:00.000Z
treeHash: abc123...
failedStep: TypeScript
failedStepOutput: |
  src/index.ts:10:5 - error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
rerunCommand: pnpm typecheck
```

## Integration with Pre-Commit Hooks

**Recommended setup using [husky](https://typicode.github.io/husky/):**

1. Install husky:

```bash
npm install -D husky
npx husky init
```

2. Create `.husky/pre-commit`:

```bash
#!/bin/sh
npx vibe-validate pre-commit
```

3. Test the hook:

```bash
git add .
git commit -m "test commit"
```

**What happens:**
- ✅ Branch sync check runs first
- ✅ Validation runs with caching
- ✅ Commit allowed if validation passes
- ❌ Commit blocked if validation fails

## Troubleshooting

### "Validation cache randomly invalidates"

**Cause**: Git tree hash non-determinism (should be fixed in v0.9.3+)

**Solution**: Upgrade to `@vibe-validate/cli@^0.9.3`

### "Command injection error"

**Cause**: Security vulnerability in git branch operations (fixed in v0.9.3+)

**Solution**: Upgrade to `@vibe-validate/cli@^0.9.3`

### "Module not found" errors

**Cause**: Packages not built after installation

**Solution**:

```bash
pnpm install
pnpm -r build
```

### "Permission denied" on pre-commit hook

**Cause**: Hook script not executable

**Solution**:

```bash
chmod +x .husky/pre-commit
```

## CLI Aliases

The CLI provides two aliases:

- `vibe-validate` - Full command name
- `vv` - Short alias for convenience

**Examples:**

```bash
vv validate
vv state
vv config
```

## Environment Variables

- `NODE_ENV` - Set to `test` to disable progress indicators
- `CI` - Auto-detected, disables colors and interactive features

## Links

- [Full Documentation](https://github.com/jdutton/vibe-validate#readme)
- [Configuration Reference](https://github.com/jdutton/vibe-validate/blob/main/docs/configuration-reference.md)
- [Config Templates Guide](https://github.com/jdutton/vibe-validate/blob/main/packages/cli/config-templates/README.md)
- [Getting Started](https://github.com/jdutton/vibe-validate/blob/main/docs/getting-started.md)

## License

MIT © [Jeff Dutton](https://github.com/jdutton)
