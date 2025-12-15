# Automated Publishing and GitHub Releases

This document describes the automated publishing workflow for vibe-validate packages to npm and GitHub releases.

## Overview

The automated publishing system uses GitHub Actions to:
- Publish all 8 packages to npm when a version tag is pushed
- Create GitHub releases with CHANGELOG content (stable versions only)
- Handle rollback automatically if any publish fails
- Support both RC (pre-release) and stable release workflows

### Key Features

- **Safety First**: Rollback via unpublish/deprecate if any package fails
- **Semver-Aware**: RC versions use `@next`, stable updates both `@latest` and `@next` (if newer)
- **CHANGELOG-Driven**: Extracts release notes automatically from CHANGELOG.md
- **Transparent**: Clear logging, error reporting, and GitHub summaries

## How It Works

### Workflow Trigger

The workflow triggers automatically when a version tag matching `v*.*.*` is pushed to the repository:

```bash
git tag v0.17.6-rc.1
git push origin v0.17.6-rc.1
```

### Publishing Behavior

#### RC Versions (e.g., `v0.17.6-rc.1`)
- ✅ Publish to npm with `@next` tag
- ❌ NO GitHub release creation
- **Use Case**: Testing releases before stable version

**Example:**
```bash
npm install vibe-validate@next
# Or specific version
npm install vibe-validate@0.17.6-rc.1
```

#### Stable Versions (e.g., `v0.17.6`)
- ✅ Publish to npm with `@latest` tag
- ✅ Update `@next` tag IF stable version is semver-newer than current `@next`
- ✅ Create GitHub release with CHANGELOG content
- **Use Case**: Production-ready releases

**Example:**
```bash
npm install vibe-validate
# Or explicit
npm install vibe-validate@latest
```

### Publishing Phases

**Phase 1: Publish with Primary Tag**
1. Validate version consistency across all packages
2. Build all packages
3. Run pre-publish checks
4. Publish 8 packages in dependency order:
   - utils → config → extractors → git → history → core → cli → vibe-validate
5. Track published packages for rollback safety

**Phase 2: Update @next Tag** (stable only, if needed)
1. Query current `@next` version from npm
2. Compare using semver: `stable > current_next`
3. If newer: Add `@next` tag to all 8 packages
4. If not newer: Skip (prevents downgrade)

**Phase 3: Create GitHub Release** (stable only)
1. Extract version section from CHANGELOG.md
2. Create release with extracted content
3. Link to tag

**Rollback Phase** (on any failure)
1. Read `.publish-manifest.json` (tracks published packages)
2. For each published package (reverse order):
   - Try: `npm unpublish <pkg>@<version>`
   - If fails (72hr limit): `npm deprecate <pkg>@<version>` with warning
3. Output clear error and recovery guide

## Setup Instructions

### Step 1: Create npm Automation Token

1. Log in to https://www.npmjs.com
2. Navigate to: **Settings → Access Tokens → Generate New Token**
3. Select **"Granular Access Token"**
4. Configure:
   - **Name**: `GitHub Actions - vibe-validate`
   - **Expiration**: 1 year (set calendar reminder to rotate)
   - **Packages**: Select all 8 packages:
     - `vibe-validate`
     - `@vibe-validate/cli`
     - `@vibe-validate/config`
     - `@vibe-validate/core`
     - `@vibe-validate/extractors`
     - `@vibe-validate/git`
     - `@vibe-validate/history`
     - `@vibe-validate/utils`
   - **Permissions**: **Read and write** (NOT admin)
5. **Copy the token** (you won't see it again)

### Step 2: Configure GitHub Secret

1. Navigate to: https://github.com/jdutton/vibe-validate/settings/secrets/actions
2. Click **"New repository secret"**
3. **Name**: `NPM_TOKEN`
4. **Value**: [paste token from Step 1]
5. Click **"Add secret"**

### Step 3: Verify Setup

Test with an RC version before using for stable releases:

```bash
# Bump to RC version
pnpm bump-version 0.17.6-rc.1

# Update CHANGELOG.md
## [0.17.6-rc.1] - 2025-12-15
### Testing
- Test automated publishing workflow

# Commit and tag
git add -A
git commit -m "test: RC automated publishing"
git tag v0.17.6-rc.1
git push origin main v0.17.6-rc.1

# Monitor workflow
# Visit: https://github.com/jdutton/vibe-validate/actions

# Verify publish
npm view vibe-validate@next version
# Should show: 0.17.6-rc.1
```

## Release Process

### For RC (Pre-Release) Versions

**Use Case**: Testing before stable release

**CHANGELOG Note**: RC versions do NOT need CHANGELOG entries. Keep changes under `## [Unreleased]` section until ready for stable release. The workflow skips CHANGELOG extraction for RCs.

**Branch Note**: RC versions can be published from feature branches for testing. No need to merge to main first.

```bash
# 1. Bump version to RC
pnpm bump-version 0.17.6-rc.1

# 2. NO CHANGELOG update needed
# Changes should already be under ## [Unreleased] section
# (CHANGELOG extraction is skipped for RC versions)

# 3. Commit
git add -A
git commit -m "chore: Prepare v0.17.6-rc.1"

# 4. Tag and push
git tag v0.17.6-rc.1
# Can push from feature branch for testing:
git push origin <current-branch> v0.17.6-rc.1
# Or from main:
git push origin main v0.17.6-rc.1

# 5. Monitor workflow
# Visit: https://github.com/jdutton/vibe-validate/actions

# 6. Verify
npm view vibe-validate@next version
npm view @vibe-validate/cli@next version
```

### For Stable Versions

**Use Case**: Production release

```bash
# 1. Bump version to stable
pnpm bump-version 0.17.6

# 2. Update CHANGELOG.md
# Move "Unreleased" section to:
## [0.17.6] - YYYY-MM-DD
### Bug Fixes
- Fix description

### Features
- Feature description

# 3. Commit
git add -A
git commit -m "chore: Release v0.17.6"

# 4. Tag and push
git tag v0.17.6
git push origin main v0.17.6

# 5. Monitor workflow
# Visit: https://github.com/jdutton/vibe-validate/actions

# 6. Verify
npm view vibe-validate@latest version
npm view vibe-validate@next version  # Should also be 0.17.6 if newer
# Visit: https://github.com/jdutton/vibe-validate/releases
```

## Troubleshooting

### Scenario 1: Version Mismatch Detected

**Error**: `validate-version.js` detects mismatched versions across packages

**Cause**: Packages not synchronized (forgot to run `pnpm bump-version`)

**Recovery**:
```bash
# Fix versions
pnpm bump-version 0.17.6

# Commit fix
git add -A && git commit -m "chore: Fix version to 0.17.6"

# Delete old tag
git tag -d v0.17.6
git push origin :refs/tags/v0.17.6

# Recreate tag
git tag v0.17.6
git push origin main v0.17.6
```

### Scenario 2: CHANGELOG Section Missing

**Error**: `extract-changelog.js` can't find version in CHANGELOG.md

**Cause**: Forgot to update CHANGELOG.md before tagging

**Recovery**:
```bash
# Update CHANGELOG.md
vim CHANGELOG.md
# Add: ## [0.17.6] - 2025-12-15

# Commit
git add CHANGELOG.md && git commit -m "docs: Add v0.17.6 to CHANGELOG"

# Delete old tag
git tag -d v0.17.6
git push origin :refs/tags/v0.17.6

# Recreate tag
git tag v0.17.6
git push origin main v0.17.6
```

### Scenario 3: Publish Fails Mid-Way

**Error**: Package 5 of 8 fails to publish

**Automatic Handling**:
1. Workflow attempts to unpublish packages 1-4
2. If unpublish fails (>72hr): Deprecates with warning
3. Workflow fails with error details

**Manual Recovery** (if needed):
```bash
# Check what's published
npm view @vibe-validate/utils@0.17.6
npm view @vibe-validate/config@0.17.6
# ... check all

# Within 72 hours: Manual unpublish
npm unpublish vibe-validate@0.17.6
npm unpublish @vibe-validate/cli@0.17.6
# ... reverse order

# After 72 hours: Publish next patch
pnpm bump-version 0.17.7
# Start release process again
```

### Scenario 4: NPM_TOKEN Expired

**Error**: `403 Forbidden` or authentication error

**Recovery**:
1. Log in to https://www.npmjs.com
2. Navigate to Settings → Access Tokens
3. **Revoke** old token
4. Generate new token (same settings as Step 1 above)
5. Update GitHub secret with new token

## Manual Fallback

If automation fails completely, use manual publishing:

```bash
# Ensure versions are correct
pnpm bump-version 0.17.6

# Build packages
pnpm -r build

# Run pre-publish checks
tsx tools/pre-publish-check.ts

# Publish manually
pnpm publish:all

# Create GitHub release manually
gh release create v0.17.6 --title "Release v0.17.6" --notes "$(tsx tools/extract-changelog.ts 0.17.6 && cat .changelog-release.md)"
```

See [docs/publishing.md](./publishing.md) for detailed manual procedures.

## Security Considerations

### NPM_TOKEN

- **Type**: Granular Access Token (NOT legacy token)
- **Scope**: Limited to vibe-validate packages only
- **Permissions**: Read + write (NOT admin)
- **Expiration**: 1 year with rotation reminder
- **Storage**: GitHub secrets (encrypted at rest)
- **Access**: Only GitHub Actions workflows
- **Logging**: Automatically masked in workflow logs

### npm Provenance

The workflow enables npm provenance (`NPM_CONFIG_PROVENANCE: true`), which:
- Links published packages to GitHub Actions workflow
- Provides supply chain transparency
- Creates verifiable build attestation
- Helps users verify package authenticity

Verify provenance:
```bash
npm view vibe-validate --json | jq .dist.attestations
```

### Workflow Permissions

The workflow uses minimal permissions:
- `contents: write` - Required for creating GitHub releases
- `id-token: write` - Required for npm provenance
- No other permissions granted

## Monitoring

### GitHub Actions

Monitor workflow runs:
- https://github.com/jdutton/vibe-validate/actions/workflows/publish.yml

### npm Registry

Verify published packages:
```bash
# Check latest
npm view vibe-validate@latest version

# Check next (RC)
npm view vibe-validate@next version

# Check specific version
npm view vibe-validate@0.17.6

# Check all versions
npm view vibe-validate versions
```

### GitHub Releases

View releases:
- https://github.com/jdutton/vibe-validate/releases

## FAQs

### Q: Can I publish RC after stable?

**A:** Yes! The semver comparison ensures `@next` won't downgrade. If you publish `0.17.6` (stable) then `0.18.0-rc.1` (RC), the RC will become the new `@next` because `0.18.0-rc.1` > `0.17.6`.

### Q: What happens if I push the wrong tag?

**A:** Delete the tag immediately:
```bash
git tag -d v0.17.6
git push origin :refs/tags/v0.17.6
```

The workflow will fail early (before publishing) if versions don't match, CHANGELOG is missing, or validation fails.

### Q: Can I re-run a failed workflow?

**A:** Yes! GitHub Actions allows re-running failed workflows from the Actions UI. The workflow is idempotent for fresh runs (not for partial failures - those require manual recovery).

### Q: How do I test the workflow without publishing?

**A:** The publishing tools support dry-run mode:
```bash
tsx tools/publish-with-rollback.ts 0.17.6 --dry-run
```

This simulates the entire workflow locally without actual publishing.

### Q: What if npm unpublish fails?

**A:** After 72 hours, npm unpublish is restricted. The workflow automatically falls back to `npm deprecate`, which marks packages with a warning message. Users will see: "⚠️ Incomplete publish - DO NOT USE" when installing.

## Related Documentation

- [Publishing Manual Fallback](./publishing.md) - Manual publishing procedures
- [Release Workflow](./release-workflow.md) - Overall release process
- [CHANGELOG Format](../CHANGELOG.md) - Keep a Changelog format

## Support

If you encounter issues:

1. Check workflow logs: https://github.com/jdutton/vibe-validate/actions
2. Verify npm token: https://www.npmjs.com/settings/jeffrdutton/tokens
3. Review this documentation
4. File an issue: https://github.com/jdutton/vibe-validate/issues
