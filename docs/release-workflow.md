# Release Workflow

This document describes the release process for vibe-validate packages.

## Overview

vibe-validate uses a **monorepo structure** with 5 independently publishable npm packages:

- `@vibe-validate/cli` - Command-line interface
- `@vibe-validate/config` - Configuration management
- `@vibe-validate/core` - Validation orchestration engine
- `@vibe-validate/formatters` - Output formatting
- `@vibe-validate/git` - Git integration utilities

All packages are versioned together and released simultaneously.

## Prerequisites

1. **Clean repository**: No uncommitted changes or untracked files
2. **Main branch**: Must be on the `main` branch (or explicitly allow another branch)
3. **Validation passed**: All validation checks must pass
4. **Built packages**: All packages must be built (`pnpm build`)
5. **npm authentication**: Must be logged in to npm with publish access

## Release Types

### Patch Release (0.9.x → 0.9.y)

Bug fixes, security patches, documentation updates, no breaking changes.

```bash
pnpm release:patch
```

### Minor Release (0.9.x → 0.10.0)

New features, backward-compatible changes, significant improvements.

```bash
pnpm release:minor
```

### Major Release (0.9.x → 1.0.0)

Breaking changes, API redesigns, major architecture changes.

```bash
pnpm release:major
```

## Automated Release Process

The release scripts automatically handle the complete workflow:

```bash
# Example: Patch release (0.9.3 → 0.9.4)
pnpm release:patch
```

**What happens automatically:**

1. **Version Bump**: Updates version in all 5 package.json files
2. **Build**: Rebuilds all packages with new versions
3. **Git Add**: Stages all changed files
4. **Git Commit**: Creates a commit with message `chore: Release patch version`
5. **Git Tag**: Creates annotated tag `v0.9.4` with message `Release v0.9.4`

**After automation completes, you still need to:**

1. **Push to GitHub**: `git push origin main --tags`
2. **Publish to npm**: `pnpm publish:all` (includes pre-publish validation)

## Manual Release Process (Advanced)

If you need more control over the release process:

### Step 1: Pre-Publish Validation

```bash
pnpm pre-publish
```

This checks:
- ✅ Git repository exists
- ✅ On main branch (or use `--allow-branch`)
- ✅ No uncommitted changes
- ✅ No untracked files
- ✅ All validation passes
- ✅ All packages built

**If any check fails**, the script exits with an error and explains how to fix it.

### Step 2: Version Bump (Manual)

```bash
# Patch: 0.9.3 → 0.9.4
pnpm version:patch

# Minor: 0.9.3 → 0.10.0
pnpm version:minor

# Major: 0.9.3 → 1.0.0
pnpm version:major
```

This updates the `version` field in all package.json files **without creating a git commit or tag**.

### Step 3: Rebuild Packages

```bash
pnpm build
```

Ensures all packages are built with the new version number.

### Step 4: Commit Version Change

```bash
# Example for v1.0.0
git add -A
git commit -m "chore: Release v1.0.0"
```

### Step 5: Create Git Tag

```bash
# Example for v1.0.0
git tag -a v1.0.0 -m "Release v1.0.0 - Initial stable release"
```

**Tag naming convention**: `v<major>.<minor>.<patch>` (e.g., `v1.0.0`, `v1.2.3`)

### Step 6: Push to GitHub

```bash
git push origin main --tags
```

This pushes both the commit and the tag to GitHub.

### Step 7: Publish to npm

```bash
pnpm publish:all
```

This runs `pnpm pre-publish` first (validation check), then publishes all 5 packages to npm in the correct dependency order:

1. `@vibe-validate/formatters` (no dependencies)
2. `@vibe-validate/git` (no dependencies)
3. `@vibe-validate/config` (depends on formatters)
4. `@vibe-validate/core` (depends on formatters, git)
5. `@vibe-validate/cli` (depends on all other packages)

## Dry Run Testing

Before publishing, test the release process:

```bash
pnpm publish:dry-run
```

This shows what files would be published for each package **without actually publishing**.

## Version Synchronization

**CRITICAL**: All 5 packages MUST have the same version number.

The `version:patch`, `version:minor`, and `version:major` scripts use `pnpm -r exec` to update all packages simultaneously.

**Manual version changes are NOT recommended** - always use the npm scripts.

## GitHub Actions (Future)

Once the repository is public on GitHub, we can automate releases with GitHub Actions:

```yaml
# .github/workflows/publish.yml (FUTURE)
name: Publish to npm

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: pnpm install
      - run: pnpm build
      - run: pnpm pre-publish
      - run: pnpm publish:all
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

This would automatically publish to npm when a version tag is pushed to GitHub.

## Rollback Strategy

If a published version has critical bugs:

### Option 1: Deprecate the Version

```bash
npm deprecate @vibe-validate/cli@0.9.4 "Critical bug - use 0.9.5 instead"
npm deprecate @vibe-validate/config@0.9.4 "Critical bug - use 0.9.5 instead"
# ... repeat for all packages
```

### Option 2: Publish a Patch Release

```bash
# Fix the bug
pnpm release:patch    # Bumps to 0.9.5
pnpm publish:all      # Publishes fixed version
```

**NEVER use `npm unpublish`** - this breaks existing users and is generally discouraged by npm.

## Release Checklist

Before releasing:

- [ ] All PRs merged to main
- [ ] All tests passing (pnpm validate)
- [ ] CHANGELOG.md updated with user-facing changes
- [ ] Documentation updated for new features
- [ ] Breaking changes documented (for major releases)
- [ ] Security vulnerabilities addressed
- [ ] Performance regressions investigated

After releasing:

- [ ] GitHub release created with release notes
- [ ] Announcement posted (if significant release)
- [ ] Documentation site updated (when available)
- [ ] Dependencies updated in example projects

## Semantic Versioning

vibe-validate follows [Semantic Versioning (semver)](https://semver.org/):

- **MAJOR (1.0.0)**: Breaking changes (incompatible API changes)
- **MINOR (0.1.0)**: New features (backward-compatible functionality)
- **PATCH (0.0.1)**: Bug fixes (backward-compatible fixes)

### Pre-1.0.0 Versioning

**Current status**: vibe-validate is in **0.9.x (beta)** phase.

During 0.x releases:
- Breaking changes may occur in minor versions (0.9.x → 0.10.0)
- Use caution when upgrading
- Read release notes carefully

**v1.0.0 release criteria:**
- Production-ready with stable API
- Comprehensive documentation
- Proven in real-world usage
- Security audit complete
- No known critical bugs

## Troubleshooting

### "Not on main branch" Error

```bash
# Either switch to main:
git checkout main

# Or explicitly allow current branch:
pnpm pre-publish --allow-branch my-branch
```

### "Uncommitted changes" Error

```bash
# Commit your changes:
git add -A
git commit -m "fix: description"

# Or stash them:
git stash
```

### "Validation failed" Error

```bash
# Check validation state:
pnpm run validate

# Fix reported issues, then re-run pre-publish:
pnpm pre-publish
```

### "Missing build outputs" Error

```bash
# Rebuild all packages:
pnpm build
```

### "npm authentication required" Error

```bash
# Login to npm:
npm login

# Verify access to @vibe-validate org:
npm access list packages
```

## Questions?

For release-related questions, contact jeff.r.dutton@gmail.com or open a GitHub issue.
