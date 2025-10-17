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

```bash
npm install -D @vibe-validate/cli
```

Or use directly via `npx`:

```bash
npx @vibe-validate/cli validate
```

## Quick Start

1. **Create configuration file** (`vibe-validate.config.mjs`):

```javascript
import { defineConfig, preset } from '@vibe-validate/config';

export default defineConfig({
  preset: preset('typescript-nodejs'),
});
```

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
- `--format <format>` - Output format: `human`, `yaml`, `json`, or `auto`
- `--config <path>` - Path to config file (default: `vibe-validate.config.mjs`)

**Examples:**

```bash
# Normal validation (uses cache)
npx vibe-validate validate

# Force re-validation (bypass cache)
npx vibe-validate validate --force

# JSON output (for CI/CD)
npx vibe-validate validate --format json

# Custom config file
npx vibe-validate validate --config ./custom-config.mjs
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
- `--format <format>` - Output format: `human`, `yaml`, or `json`

**Examples:**

```bash
# Human-readable state
npx vibe-validate state

# YAML output (for agents)
npx vibe-validate state --format yaml

# JSON output (for scripts)
npx vibe-validate state --format json
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
- `--format <format>` - Output format: `human`, `yaml`, or `json`
- `--config <path>` - Path to config file

**Examples:**

```bash
# Show configuration
npx vibe-validate config

# JSON output
npx vibe-validate config --format json
```

**Use cases:**
- Verify configuration is loaded correctly
- Debug preset behavior
- Inspect default values

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

Check if current branch is behind remote.

```bash
npx vibe-validate sync-check [options]
```

**Options:**
- `--remote-branch <branch>` - Remote branch to check (default: `origin/main`)

**Exit Codes:**
- `0` - Up to date or no remote
- `1` - Behind remote (needs merge)
- `2` - Error condition

**Examples:**

```bash
# Check against origin/main
npx vibe-validate sync-check

# Check against origin/develop
npx vibe-validate sync-check --remote-branch origin/develop
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

Check repository health and best practices.

```bash
npx vibe-validate doctor
```

**Checks:**
- Pre-commit hook installed
- Validation state file exists
- Config file is valid
- Git repository exists
- On feature branch (not main)

**Output:**
- ✅ Passing checks
- ⚠️  Warnings with recommendations
- ❌ Failing checks with fix instructions

---

## Configuration

Create `vibe-validate.config.mjs` in your project root:

```javascript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  validation: {
    phases: [
      {
        name: 'Pre-Qualification',
        parallel: true,
        steps: [
          { name: 'TypeScript', command: 'pnpm typecheck' },
          { name: 'ESLint', command: 'pnpm lint' },
        ],
      },
      {
        name: 'Testing',
        steps: [
          { name: 'Unit Tests', command: 'pnpm test' },
        ],
      },
    ],
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },
  },
  git: {
    mainBranch: 'main',
    warnIfBehind: true,
  },
  output: {
    format: 'auto',
    showProgress: true,
  },
});
```

**Or use presets:**

```javascript
import { defineConfig, preset } from '@vibe-validate/config';

export default defineConfig({
  preset: preset('typescript-nodejs'),
});
```

**Available presets:**
- `typescript-library` - TypeScript library (no runtime)
- `typescript-nodejs` - Node.js application with TypeScript
- `typescript-react` - React application with TypeScript

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

vibe-validate is optimized for AI agents like Claude Code:

**Benefits:**
- **Minimal token waste**: 4-5 lines on failure vs 200+ with traditional tools
- **Structured errors**: Complete details in `.vibe-validate-state.yaml`
- **Clear next steps**: Actionable commands in state file
- **Zero noise**: No server logs, no verbose progress bars

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
- `LLM_OUTPUT` - Set to `1` for minimal output (agent-friendly)

## Links

- [Full Documentation](https://github.com/jeffrdutton/vibe-validate#readme)
- [Configuration Guide](https://github.com/jeffrdutton/vibe-validate/blob/main/docs/configuration.md)
- [Presets Reference](https://github.com/jeffrdutton/vibe-validate/blob/main/docs/presets.md)
- [API Reference](https://github.com/jeffrdutton/vibe-validate/blob/main/docs/api/)
- [Examples](https://github.com/jeffrdutton/vibe-validate/tree/main/examples)

## License

MIT © [Jeff Dutton](https://github.com/jeffrdutton)
