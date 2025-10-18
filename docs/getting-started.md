# Getting Started with vibe-validate

Welcome to vibe-validate! This guide will help you set up validation orchestration with git tree hash caching in your project.

## What is vibe-validate?

vibe-validate is a **validation orchestration tool** designed for developers using AI assistants. It:

- ✅ **Caches validation results** using git tree hashes (up to 312x speedup)
- ✅ **Runs validation steps in parallel** for faster execution
- ✅ **Formats errors for LLMs** - strips noise, provides actionable fixes
- ✅ **Detects AI assistants** - auto-optimizes output for Claude Code, Cursor, Aider, Continue
- ✅ **Integrates with git workflows** - branch sync checking, pre-commit validation
- ✅ **Works with any language** - JavaScript/TypeScript presets included, but language-agnostic

## Installation

### Prerequisites

- Node.js 20 or higher
- Git
- npm, pnpm, or yarn

### Install vibe-validate

```bash
# Using npm
npm install -D @vibe-validate/cli

# Using pnpm
pnpm add -D @vibe-validate/cli

# Using yarn
yarn add -D @vibe-validate/cli
```

## Quick Start

### Step 1: Initialize Configuration

Run the interactive setup wizard:

```bash
npx vibe-validate init
```

You'll be prompted to:
1. Choose a preset (typescript-library, typescript-nodejs, typescript-react)
2. Select configuration file format (.ts, .js, .mjs, .json)
3. Confirm validation steps

**Result**: Creates `vibe-validate.config.ts` (or your chosen format) in your project root.

### Step 2: Run Validation

```bash
npx vibe-validate validate
```

**First run**: Executes all validation steps (may take 30-120 seconds depending on project size).

**Subsequent runs**: If code unchanged, validation completes in ~288ms (cache hit!).

### Step 3: Add to package.json Scripts

For convenience, add to your `package.json`:

```json
{
  "scripts": {
    "validate": "vibe-validate validate",
    "pre-commit": "vibe-validate pre-commit"
  }
}
```

Now you can run:
```bash
npm run validate
npm run pre-commit
```

## Understanding the Configuration

After running `init`, you'll have a configuration file that looks like this:

```typescript
// vibe-validate.config.ts
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  validation: {
    phases: [
      {
        name: 'Pre-Qualification',
        parallel: true, // Run steps simultaneously
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
        ],
      },
    ],
    caching: {
      strategy: 'git-tree-hash', // Content-based caching
      enabled: true,
    },
    failFast: false, // Continue even if a step fails
  },
  git: {
    mainBranch: 'main',
    autoSync: false, // Never auto-merge
  },
  output: {
    format: 'auto', // Detects context (human/agent/CI)
  },
});
```

### Key Concepts

**Phases**: Groups of validation steps
- **Parallel phases**: Steps run simultaneously (faster, good for independent checks)
- **Sequential phases**: Steps run one after another (for dependent checks)

**Caching Strategy**:
- `git-tree-hash` (recommended): Caches based on actual code content
- `timestamp`: Caches based on file modification times
- `disabled`: No caching

**Fail Fast**:
- `false`: Runs all steps even if some fail (better error visibility)
- `true`: Stops at first failure (faster feedback on breakage)

## Workflow Integration

### Pre-commit Validation

**Recommended**: Run validation before every commit to catch issues early.

Add to your workflow:

```bash
# Before committing
npm run pre-commit

# This command:
# 1. Checks if branch is behind origin/main
# 2. Runs validation (uses cache if code unchanged)
# 3. Reports status

# If validation passes, proceed with commit
git add .
git commit -m "feat: add new feature"
```

### Pre-commit Hook (Automated)

Set up automatic validation on commit using Husky:

```bash
# Install Husky
npm install -D husky
npx husky install
```

Add to `package.json`:
```json
{
  "scripts": {
    "prepare": "husky install"
  }
}
```

Create `.husky/pre-commit`:
```bash
#!/bin/sh
npm run pre-commit
```

Now validation runs automatically before every commit!

### CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
# .github/workflows/validate.yml
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
- Consistent validation between local and CI
- JSON output for CI parsing
- Fast parallel execution
- Exit code 0 (pass) or 1 (fail)

## Performance: Caching Explained

### How Git Tree Hash Caching Works

vibe-validate uses **deterministic git tree hashing** for cache keys:

```bash
# First run (cache miss)
$ npx vibe-validate validate
Phase 1: Pre-Qualification ━━━━━━━━━━━━━━━ 15s
Phase 2: Testing ━━━━━━━━━━━━━━━━━━━━━━━━ 75s
✅ Validation passed (90s)

# Second run (cache hit - code unchanged)
$ npx vibe-validate validate
✅ Validation cached (288ms)
```

**Cache key calculation**:
1. `git add --intent-to-add .` - Mark untracked files (no actual staging)
2. `git write-tree` - Generate content-based hash
3. `git reset` - Restore index to clean state

**Why it works**:
- Content-based (not timestamp-based)
- Includes untracked files
- Deterministic (same code = same hash)
- No side effects (index restored after calculation)

### When Cache is Invalidated

Cache is invalidated when:
- ✅ **Any file content changes** (tracked or untracked)
- ✅ **New files are added**
- ✅ **Files are deleted**
- ✅ **Git tree structure changes**

Cache is NOT invalidated by:
- ❌ File modification timestamps
- ❌ Git commit history
- ❌ Git branch changes
- ❌ Environment variables

### Performance Tips

1. **Organize validation steps efficiently**:
   - Put fast checks first (TypeScript, ESLint)
   - Put slow checks last (tests, builds)
   - Run independent checks in parallel phases

2. **Use fail-fast for quick feedback**:
   ```typescript
   failFast: true // Stop at first failure
   ```

3. **Skip expensive checks in pre-commit**:
   - Run quick checks (lint, typecheck) in pre-commit
   - Run full suite (tests, build) in CI

## Common Commands

```bash
# Initialize configuration
npx vibe-validate init

# Run validation
npx vibe-validate validate

# Run validation (force, bypass cache)
npx vibe-validate validate --force

# Pre-commit workflow
npx vibe-validate pre-commit

# Check branch sync
npx vibe-validate sync-check

# Show validation state
npx vibe-validate state

# Show configuration
npx vibe-validate config

# Post-merge cleanup
npx vibe-validate cleanup
```

## Next Steps

- **Customize configuration**: See [Configuration Reference](configuration-reference.md)
- **Learn CLI commands**: See [CLI Reference](cli-reference.md)
- **Extend presets**: See [Presets Guide](presets-guide.md)
- **Integrate with AI assistants**: See [Agent Integration Guide](agent-integration-guide.md)
- **Understand error formatters**: See [Error Formatters Guide](error-formatters-guide.md)

## Troubleshooting

### Validation is slow every time

**Problem**: Cache not working, validation runs full every time.

**Solution**:
1. Check validation status: `npx vibe-validate validate --check`
2. Ensure working tree is clean: `git status`
3. View validation state: `npx vibe-validate state`
4. Try force re-validation: `npx vibe-validate validate --force`

### Command not found

**Problem**: `vibe-validate` command not recognized.

**Solution**:
1. Ensure installed: `npm install -D @vibe-validate/cli`
2. Use `npx` prefix: `npx vibe-validate validate`
3. Check npm bin directory is in PATH

### Configuration file not found

**Problem**: "No configuration file found" error.

**Solution**:
1. Run `npx vibe-validate init` to create config
2. Ensure config is in project root
3. Check supported formats: `.ts`, `.js`, `.mjs`, `.json`
4. Verify config filename: `vibe-validate.config.*`

### Validation passes locally but fails in CI

**Problem**: Tests pass locally but fail in CI environment.

**Solution**:
1. Run `npx vibe-validate validate --force` locally
2. Check for environment-specific issues:
   - Hardcoded paths
   - Missing environment variables
   - Flaky tests
   - Timezone/locale differences
3. Ensure test isolation (no shared state)
4. Match CI Node.js version locally

## Getting Help

- **GitHub Issues**: [github.com/jdutton/vibe-validate/issues](https://github.com/jdutton/vibe-validate/issues)
- **Documentation**: [docs/](.)
- **Examples**: [examples/](../examples/)

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup and guidelines.
