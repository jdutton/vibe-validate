# vibe-validate

> Git-aware validation orchestration with 312x faster cached runs

[![npm version](https://img.shields.io/npm/v/@vibe-validate/cli.svg)](https://www.npmjs.com/package/@vibe-validate/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**What it does**: Caches your validation results (tests, lint, typecheck) using git tree hashes. When code hasn't changed, validation completes in ~288ms instead of minutes.

**Who it's for**: TypeScript/JavaScript developers, especially those using AI assistants (Claude Code, Cursor, Aider, Continue)

## Quick Start (3 commands)

```bash
# 1. Install
npm install -D @vibe-validate/cli

# 2. Initialize (creates config, detects your project type)
npx vibe-validate init

# 3. Validate (run before every commit - uses cache when code unchanged)
npx vibe-validate validate
```

**When code changes**: ~60-90s (runs all checks)
**When code unchanged**: ~288ms (312x faster with cache!)

## Integration with package.json

Make vibe-validate part of your existing workflow:

```json
{
  "scripts": {
    "validate": "vibe-validate validate",
    "pre-commit": "vibe-validate pre-commit",
    "test:all": "vibe-validate validate"
  }
}
```

**Benefits:**
- Shorter commands: `npm run validate` vs `npx vibe-validate validate`
- Familiar pattern for TypeScript developers (like `npm run typecheck`)
- Works with any package manager (npm, pnpm, yarn)
- Easier to document in team workflows

**Usage:**
```bash
npm run validate      # Run validation (cached if code unchanged)
npm run pre-commit    # Pre-commit workflow (branch sync + validation)
```

## Try It Out (No Installation)

Evaluate if your project is suitable for vibe-validate:

```bash
# Check if your project meets prerequisites
npx @vibe-validate/cli@latest doctor
```

**Prerequisites checked:**
- ✅ Node.js 20+ installed
- ✅ Git repository initialized
- ✅ Package manager available (npm/pnpm)

**Additional guidance:** `doctor` will also provide setup recommendations for configuration, pre-commit hooks, and GitHub Actions workflow sync to help you get started.

## Why vibe-validate?

**Built for agentic coding workflows** to help deterministically enforce SDLC best practices and minimize context window usage when working with AI assistants like [Claude Code](https://claude.ai/code).

### Core Design Goals

1. **Validate before pushing** - Prevent broken PRs by catching issues locally before they reach CI
2. **PR/local sync** - Guarantee PR validation passes because it's identical to local testing
3. **Speed up validation** - Parallel execution + smart caching + fail-fast = faster iteration
4. **Minimize context window usage** - Agent-optimized error formatting with test filters
5. **Keep branches synchronized** - Enforce branch sync with main during development

### Key Features

- **312x faster cached validation** (288ms vs 90s when code unchanged)
- **Git tree hash caching** - Content-based, deterministic (includes untracked files)
- **Parallel phase execution** - Run independent checks simultaneously
- **Agent-optimized output** - Auto-detects Claude Code, Cursor, Aider, Continue
- **Branch sync enforcement** - Pre-commit hook ensures branches stay current
- **GitHub Actions generator** - CI/CD workflow auto-generated from config

### vs. Alternatives

**vs. Running commands manually** (`npm test && npm run lint && ...`):
- ✅ 312x faster with caching
- ✅ Parallel execution
- ✅ Branch sync checking
- ✅ Agent-friendly error output

**vs. Nx/Turborepo**:
- ✅ Simpler setup (one config file vs complex workspace)
- ✅ Language-agnostic (not tied to npm workspaces)
- ✅ Designed for AI assistants (Claude Code integration)
- ✅ SDLC enforcement (pre-commit, branch sync)

**vs. Pre-commit framework (Python)**:
- ✅ Native Node.js (no Python dependency)
- ✅ Full validation orchestration (not just pre-commit)
- ✅ Caching between local/CI runs
- ✅ GitHub Actions generator

**Primarily tested with:** [Claude Code](https://claude.ai/code) - Anthropic's AI-powered coding assistant

## Common Commands

```bash
# Run validation (uses cache if code unchanged)
npx vibe-validate validate

# Diagnose vibe-validate configuration and environment
npx vibe-validate doctor

# Generate GitHub Actions workflow
npx vibe-validate generate-workflow

# Pre-commit workflow (recommended before every commit)
npx vibe-validate pre-commit

# View validation state
npx vibe-validate state

# Force re-validation (bypass cache)
npx vibe-validate validate --force
```

## Example: Before & After

**Before** (traditional workflow):
```bash
npm run typecheck && npm run lint && npm test
# Always takes 60-90 seconds, even if nothing changed
```

**After** (with vibe-validate):
```bash
npx vibe-validate validate
# First run: 60-90s (cache miss)
# Every run after: 288ms if code unchanged (cache hit)
# Speedup: 312x when code unchanged
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

# Verbose output with detailed progress
npx vibe-validate validate --verbose

# Check validation status without running
npx vibe-validate validate --check
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

# Full error output (no truncation)
npx vibe-validate state --verbose
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
    mainBranch: 'main', // Customize for 'master', 'develop', etc.
    autoSync: false,     // Never auto-merge (safety first)
  },
  // State files are always written as YAML (human and machine readable)
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

### Customizing Main Branch

By default, vibe-validate assumes your main branch is `main`. To use a different branch:

```typescript
export default defineConfig({
  git: {
    mainBranch: 'master',  // or 'develop', 'trunk', etc.
  },
});
```

**Or via CLI:**
```bash
npx vibe-validate sync-check --main-branch master
```

**Note:** The `pre-commit` command respects `git.mainBranch` from your config file.

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
      - run: npx vibe-validate validate
        # State files are always YAML (human and machine readable)
```

**Benefits**:
- Exit code 0/1 for pass/fail
- YAML state files (machine-readable and human-reviewable)
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
