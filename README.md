# vibe-validate

**Git-aware validation orchestration for vibe coding** (LLM-assisted development)

## What is this?

`vibe-validate` is a validation orchestration tool designed for developers using AI assistants like Claude Code, Cursor, Aider, and Continue. It caches validation state using git tree hashes, runs steps in parallel, and formats errors for LLM consumption.

## Key Features

- ✅ **Git tree hash caching** - Skip validation when code unchanged (up to **312x speedup**)
- ✅ **LLM-optimized output** - Strip noise, extract actionable errors
- ✅ **Agent context detection** - Adapts output for Claude Code, Cursor, etc.
- ✅ **Parallel execution** - Run multiple validation steps simultaneously
- ✅ **Language-agnostic** - Works with any commands (TypeScript/JavaScript presets included)
- ✅ **Pre-commit workflow** - Branch sync + validation + cleanup

## Why vibe-validate?

**Problem**: Running full validation suites repeatedly during development is slow and frustrating. Traditional CI/CD tools don't cache based on actual code changes.

**Solution**: vibe-validate uses **deterministic git tree hashing** to cache validation results. If your code hasn't changed, validation completes in ~288ms instead of minutes.

**Real-world performance**:
- **Full validation**: ~90 seconds (9 steps across 2 parallel phases)
- **Cached validation**: 288ms (reading state file + git hash)
- **Speedup**: **312x** when code unchanged

## Quick Start

```bash
# Install
npm install -D @vibe-validate/cli

# Initialize with interactive preset selection
npx vibe-validate init

# Or specify a preset directly
npx vibe-validate init --preset=typescript-nodejs

# Run validation (full first time, cached on repeat)
npx vibe-validate validate

# Pre-commit workflow (branch sync + cached validation)
npx vibe-validate pre-commit
```

## CLI Commands

### `vibe-validate init`

Interactive setup wizard that creates a configuration file.

```bash
# Interactive mode (recommended for first-time setup)
npx vibe-validate init

# With preset
npx vibe-validate init --preset=typescript-library
npx vibe-validate init --preset=typescript-nodejs
npx vibe-validate init --preset=typescript-react
```

**Creates**: `vibe-validate.config.ts` (or `.js`, `.mjs`) in your project root.

### `vibe-validate validate`

Runs the full validation pipeline with automatic caching.

```bash
# Run validation (uses cache if code unchanged)
npx vibe-validate validate

# Force re-validation (bypass cache)
npx vibe-validate validate --force

# Human-friendly output
npx vibe-validate validate --format=human

# YAML output (for agents)
npx vibe-validate validate --format=yaml

# JSON output (for CI/CD)
npx vibe-validate validate --format=json
```

**Features**:
- ✅ Git tree hash caching (automatic)
- ✅ Parallel phase execution
- ✅ Smart error formatting (auto-detects tool type)
- ✅ Exit code 0 (pass) or 1 (fail)

### `vibe-validate pre-commit`

Complete pre-commit workflow: branch sync check + cached validation.

```bash
# Run before every commit (recommended)
npx vibe-validate pre-commit
```

**What it does**:
1. Checks if branch is behind `origin/main` (stops if true)
2. Calculates git tree hash of working tree
3. Skips validation if hash matches cached state (288ms)
4. Runs full validation if hash differs (~90s)
5. Caches result for next run

**When to use**:
- **Before every commit** (prevents broken code from being committed)
- **Before pushing to GitHub** (ensures CI will pass)
- **After pulling changes** (verify branch is still valid)

### `vibe-validate sync-check`

Checks if current branch is behind `origin/main` without auto-merging.

```bash
npx vibe-validate sync-check
```

**Exit codes**:
- `0` - Up to date or no remote tracking
- `1` - Branch is behind origin/main (needs merge)
- `2` - Error condition (git command failed)

**Safety**: Never auto-merges. Always requires explicit manual action.

### `vibe-validate state`

Shows current validation state.

```bash
# Human-friendly summary
npx vibe-validate state

# YAML format (for agents)
npx vibe-validate state --format=yaml

# JSON format (for scripts)
npx vibe-validate state --format=json
```

**Output includes**:
- Validation pass/fail status
- Timestamp of last validation
- Git tree hash (for cache key)
- Failed step details (if any)
- Agent-friendly error summary

### `vibe-validate config`

Shows current configuration with validation.

```bash
# Display configuration
npx vibe-validate config

# Validate configuration only
npx vibe-validate config --validate
```

**Features**:
- ✅ Shows resolved configuration (with preset merging)
- ✅ Validates config schema (Zod validation)
- ✅ Reports any configuration errors

### `vibe-validate cleanup`

Post-merge branch cleanup (use after PR merge).

```bash
npx vibe-validate cleanup
```

**What it does**:
1. Switches to `main` branch
2. Pulls latest changes from `origin/main`
3. Identifies merged branches
4. Deletes confirmed-merged branches
5. Provides cleanup summary

**Safety**: Only deletes branches confirmed merged via git log inspection.

### `vibe-validate generate-workflow`

Generate GitHub Actions workflow from vibe-validate configuration.

```bash
# Generate workflow file
npx vibe-validate generate-workflow

# Check if workflow is in sync with config
npx vibe-validate generate-workflow --check

# Show generated workflow without writing
npx vibe-validate generate-workflow --dry-run

# Customize matrix strategy
npx vibe-validate generate-workflow --node-versions=20,22,24 --os=ubuntu-latest,macos-latest

# Enable coverage reporting
npx vibe-validate generate-workflow --coverage

# Fail fast in matrix mode
npx vibe-validate generate-workflow --fail-fast
```

**Options**:
- `--node-versions <versions>` - Comma-separated Node.js versions (default: auto-detected from package.json)
- `--os <systems>` - Comma-separated OS values (default: ubuntu-latest)
- `--fail-fast` - Fail fast in matrix strategy (default: false)
- `--coverage` - Enable coverage reporting with Codecov
- `--dry-run` - Show generated workflow without writing to file
- `--check` - Check if workflow is in sync with config (exit 0 if in sync, 1 if not)

**Matrix Mode**:
- Automatically enabled when multiple Node versions or OSes specified
- Runs single `validate` job with matrix strategy
- Includes validation state artifact upload on failure

**Non-Matrix Mode** (default for single Node version):
- Creates individual GitHub Actions jobs for each validation step
- Respects phase dependencies from config
- Better visualization in GitHub Actions UI

**Example Generated Workflow**:
```yaml
name: Validation Pipeline
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest]
        node: ["22"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm run validate
```

**Exit Codes**:
- `0` - Success (workflow generated or in sync)
- `1` - Failure (generation failed or workflow out of sync)

## Configuration

### Quick Start with Presets

vibe-validate includes presets for common project types:

```bash
# Library (default) - For npm packages
npx vibe-validate init --preset=typescript-library

# Node.js Application - For servers/CLI apps
npx vibe-validate init --preset=typescript-nodejs

# React Application - For React/Next.js apps
npx vibe-validate init --preset=typescript-react
```

### Configuration File Example

`vibe-validate.config.ts`:

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  validation: {
    phases: [
      {
        name: 'Pre-Qualification',
        parallel: true, // Run steps in parallel
        steps: [
          { name: 'TypeScript', command: 'tsc --noEmit' },
          { name: 'ESLint', command: 'eslint src/' },
        ],
      },
      {
        name: 'Testing',
        parallel: false, // Run steps sequentially
        steps: [
          { name: 'Unit Tests', command: 'vitest run' },
          { name: 'Integration', command: 'npm run test:integration' },
        ],
      },
    ],
    caching: {
      strategy: 'git-tree-hash', // Deterministic caching
      enabled: true,
    },
    failFast: false, // Continue even if a step fails
  },
  git: {
    mainBranch: 'main',
    autoSync: false, // Never auto-merge
  },
  output: {
    format: 'auto', // 'human' | 'yaml' | 'json' | 'auto'
  },
});
```

### Extending Presets

Start with a preset and override specific settings:

```typescript
import { defineConfig, mergeConfig } from '@vibe-validate/config';
import { typescriptNodejsPreset } from '@vibe-validate/config/presets';

export default defineConfig(
  mergeConfig(typescriptNodejsPreset, {
    validation: {
      phases: [
        // Add custom phase after preset phases
        {
          name: 'Security Scan',
          steps: [
            { name: 'npm audit', command: 'npm audit --audit-level=high' },
          ],
        },
      ],
    },
  })
);
```

## Workflows

### Development Workflow

```bash
# 1. Start new feature
git checkout -b feature/new-feature

# 2. Make changes
# ... edit code ...

# 3. Validate before commit
npx vibe-validate pre-commit
# ✅ Branch sync: OK
# ✅ Validation: Cached (288ms) - code unchanged
# ✅ Ready to commit

# 4. Commit changes
git add .
git commit -m "feat: add new feature"

# 5. Push and create PR
git push origin feature/new-feature
gh pr create
```

### CI/CD Integration

#### GitHub Actions

`.github/workflows/validate.yml`:

```yaml
name: Validate
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npx vibe-validate validate --format=json
```

**Benefits**:
- Exit code 0/1 for pass/fail
- JSON output for CI parsing
- Parallel execution (faster CI)
- Consistent with local validation

### Pre-commit Hook

Add to `package.json`:

```json
{
  "scripts": {
    "prepare": "husky install",
    "pre-commit": "vibe-validate pre-commit"
  }
}
```

`.husky/pre-commit`:

```bash
#!/bin/sh
npm run pre-commit
```

**Benefits**:
- Prevents broken code from being committed
- Fast cached validation (288ms on repeat)
- Branch sync enforcement
- No manual intervention needed

## Integration with AI Assistants

### Claude Code

vibe-validate automatically detects Claude Code and provides agent-optimized output:

```bash
# Claude Code automatically uses YAML format
npx vibe-validate validate
# Output optimized for LLM consumption:
# - Error output embedded in YAML
# - ANSI codes stripped
# - Actionable fix suggestions
```

**CLAUDE.md setup**:

```markdown
## Development Workflow

**MANDATORY before every commit**:
\`\`\`bash
npx vibe-validate pre-commit
\`\`\`

Never commit without passing validation.
```

### Cursor / Aider / Continue

Works automatically via environment variable detection:

- `CURSOR=true` → Cursor-optimized output
- `AIDER=true` → Aider-optimized output
- `CONTINUE=true` → Continue-optimized output

All AI assistants get:
- ✅ Noise-free error output
- ✅ Smart error formatting (TypeScript, ESLint, Vitest)
- ✅ Actionable fix suggestions
- ✅ Fast cached validation

## Performance

### Caching Strategy

vibe-validate uses **deterministic git tree hashing** for cache keys:

```bash
# First run (cache miss)
$ npx vibe-validate validate
Phase 1: Pre-Qualification ━━━━━━━━━━━━━━━ 15s
Phase 2: Testing ━━━━━━━━━━━━━━━━━━━━━━━━ 75s
✅ Validation passed (90.5s)

# Second run (cache hit, no code changes)
$ npx vibe-validate validate
✅ Validation cached (288ms)
```

**Cache key calculation**:
1. `git add --intent-to-add .` (mark untracked files, no staging)
2. `git write-tree` (deterministic content hash)
3. `git reset` (restore index to clean state)

**Why it works**:
- Content-based (not timestamp-based)
- Includes untracked files
- Deterministic (same code = same hash)
- No side effects (index restored)

### Performance Metrics

Real-world project (TypeScript Node.js app):

| Validation Step | Duration |
|----------------|----------|
| TypeScript | 8.2s |
| ESLint | 4.1s |
| Vitest Unit | 12.3s |
| Integration | 22.7s |
| Build | 43.2s |
| **Total (parallel)** | **90.5s** |
| **Cached** | **0.288s** |
| **Speedup** | **312x** |

## Packages

This is a monorepo containing:

- **[@vibe-validate/core](packages/core)** - Validation orchestration engine
- **[@vibe-validate/git](packages/git)** - Git workflow utilities
- **[@vibe-validate/formatters](packages/formatters)** - Error parsing & LLM optimization
- **[@vibe-validate/config](packages/config)** - Configuration system with presets
- **[@vibe-validate/cli](packages/cli)** - Command-line interface

## Requirements

- Node.js 20+
- Git
- npm/pnpm/yarn

## Troubleshooting

### Validation is slow every time

**Problem**: Cache not working, validation runs every time.

**Solution**: Check for:
1. `.vibe-validate-state.yaml` exists and is writable
2. Working tree is clean (`git status`)
3. No `.gitignore` blocking state file

### Validation passes locally but fails in CI

**Problem**: Tests are flaky or environment-dependent.

**Solution**:
1. Run `npx vibe-validate validate --force` locally
2. Check for hardcoded paths or environment variables
3. Ensure test isolation (no shared state)

### Branch sync check fails

**Problem**: `sync-check` reports branch is behind, but it's not.

**Solution**:
1. Fetch latest from origin: `git fetch origin`
2. Check remote tracking: `git branch -vv`
3. Ensure `origin/main` exists: `git ls-remote origin main`

### Config file not found

**Problem**: `vibe-validate validate` says no config found.

**Solution**:
1. Run `npx vibe-validate init` to create config
2. Ensure file is in project root
3. Check supported formats: `.ts`, `.js`, `.mjs`, `.json`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT © Jeff Dutton
