# Configure Project: Adopt vibe-validate for Validation Guardrails

## Overview

Configure your project to use vibe-validate for comprehensive validation with:
- **Pre-commit validation** guardrails (prevent broken code from being committed)
- **Git-aware caching** (dramatic speedup)
- **Team-wide consistency** (shared validation configuration)
- **CI/CD integration** (same validation locally and in CI)

## Quick Start

```bash
# Install in project
npm install vibe-validate

# Generate configuration for project type
vv init

# Run validation
vv validate
```

## What Gets Created

The `vv init` command generates:
- `vibe-validate.config.yaml` - Validation configuration
- `.husky/pre-commit` - Pre-commit hook (optional)
- `.github/workflows/validate.yml` - CI workflow (optional)

## Configuration Example

```yaml
# vibe-validate.config.yaml
version: 1
git:
  mainBranch: main

validation:
  phases:
    - name: Pre-Qualification
      steps:
        - name: TypeScript Type Check
          command: pnpm typecheck
        - name: ESLint Code Quality
          command: pnpm lint
        - name: Build All Packages
          command: pnpm -r build

    - name: Testing
      steps:
        - name: Unit Tests with Coverage
          command: pnpm test:coverage
```

## Core Commands

```bash
# Run full validation suite
vv validate

# Check cached state (no re-run if code unchanged)
vv validate --check

# Force re-run (ignore cache)
vv validate --force

# View current validation state
vv state

# View validation history
vv history list
```

## Validation Phases

Phases run **sequentially**. If a phase fails, subsequent phases are skipped.

```yaml
validation:
  phases:
    - name: Pre-Qualification  # Runs first
      steps: [...]
    - name: Testing            # Runs only if Pre-Qualification passes
      steps: [...]
```

Steps within a phase can run **sequentially** or in **parallel**:

```yaml
# Sequential (default)
- name: Build
  steps:
    - name: Install
      command: npm install
    - name: Build
      command: npm run build

# Parallel
- name: Lint and Type Check
  parallel: true
  steps:
    - name: ESLint
      command: npm run lint
    - name: TypeScript
      command: npm run typecheck
```

## Pre-Commit Hook Setup

```bash
# Initialize git hooks
vv init --hooks

# Or manually add to .husky/pre-commit:
#!/bin/sh
vv validate --yaml || exit 1
```

## Complete Documentation

See main project documentation:
- **Getting Started:** `docs/getting-started.md`
- **Configuration Reference:** `docs/configuration-reference.md`
- **CLI Reference:** `docs/cli-reference.md`
- **CI/CD Integration:** `docs/ci-cd-integration.md`
