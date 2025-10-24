# Publishing Guide - vibe-validate

This guide walks through publishing vibe-validate packages to npm.

**Current Version**: v0.9.6 (published 2025-10-17)
**Next Version**: v0.9.7 (in development)

## 📋 Pre-Publishing Checklist

Before publishing any new version, ensure:

- [ ] **All package.json versions updated to target version**
  - Root package.json
  - @vibe-validate/core
  - @vibe-validate/git
  - @vibe-validate/extractors
  - @vibe-validate/config
  - @vibe-validate/cli

- [x] **PublishConfig added to all packages**
  - `"publishConfig": { "access": "public" }` configured
  - Scoped packages (@vibe-validate/*) require public access

- [x] **Repository URLs standardized**
  - All packages reference: `git+https://github.com/jdutton/vibe-validate.git`
  - Each package includes `"directory": "packages/<name>"` field

- [x] **Publish scripts added to root package.json**
  - `npm run publish:dry-run` - Test publish without uploading
  - `npm run publish:all` - Publish all packages in dependency order
  - Individual publish scripts for each package

- [ ] **CHANGELOG.md updated**
  - Release notes for new version
  - Feature list, bug fixes, breaking changes
  - Migration notes if applicable

- [ ] **Build verification**
  - `pnpm -r build` completed successfully
  - All 5 packages build without errors
  - Dist artifacts generated correctly

- [ ] **Full validation passes**
  - Run `pnpm validate` or `pnpm pre-commit`
  - All tests passing
  - No linter or type errors

- [x] **Dependency verification**
  - CLI uses `workspace:*` for internal deps (resolves to published versions)
  - External dependencies correctly specified

## 🔐 Step 1: npm Login (USER ACTION REQUIRED)

Before publishing, you must authenticate with npm:

```bash
# Login to npm (opens browser for authentication)
npm login

# Verify login
npm whoami
# Expected output: jdutton (or your npm username)
```

## 🏢 Step 2: npm Organization Setup

### Option A: Create Organization via npm Website (Recommended)
1. Go to https://www.npmjs.com
2. Click your profile → "Add Organization"
3. Organization name: `vibe-validate`
4. Select "Free" plan (unlimited public packages)
5. Add members if needed

### Option B: Create Organization via CLI
```bash
# Create organization
npm org create vibe-validate

# Verify organization exists
npm org ls vibe-validate
```

## 🧪 Step 3: Verify All Packages

**CRITICAL:** Check ALL packages before publishing (easy to miss the umbrella package).

### List All Packages

```bash
# List all package directories
ls -d packages/*/

# Expected output:
# packages/cli/
# packages/config/
# packages/core/
# packages/extractors/
# packages/git/
# packages/history/
# packages/vibe-validate/  ← UMBRELLA PACKAGE (not scoped!)
```

**Package Checklist (7 total):**
- [ ] @vibe-validate/extractors
- [ ] @vibe-validate/git
- [ ] @vibe-validate/config
- [ ] @vibe-validate/core
- [ ] @vibe-validate/history
- [ ] @vibe-validate/cli
- [ ] **vibe-validate** (umbrella package - NOT scoped)

### Dry-Run Testing

Test publishing without actually uploading to npm:

```bash
# IMPORTANT: Default dry-run MISSES the umbrella package!
# npm run publish:dry-run  # ← Only tests @vibe-validate/* (scoped)

# Test ALL packages individually with pnpm:
cd packages/extractors && pnpm publish --dry-run --no-git-checks
cd packages/git && pnpm publish --dry-run --no-git-checks
cd packages/config && pnpm publish --dry-run --no-git-checks
cd packages/core && pnpm publish --dry-run --no-git-checks
cd packages/history && pnpm publish --dry-run --no-git-checks
cd packages/cli && pnpm publish --dry-run --no-git-checks
cd packages/vibe-validate && pnpm publish --dry-run --no-git-checks  # ← DON'T FORGET!
```

**Verify output for EACH package includes:**
- ✅ Package name and version
- ✅ Files that will be published (dist/, README.md, LICENSE)
- ✅ No errors or warnings
- ✅ Tarball size is reasonable (< 1MB per package)
- ✅ Dependencies show version numbers (NOT `workspace:*`)

## 📦 Step 4: Create Package Tarballs (Optional)

Test local installation before publishing:

```bash
# Create tarballs for all packages
cd packages/extractors && npm pack
cd packages/git && npm pack
cd packages/config && npm pack
cd packages/core && npm pack
cd packages/cli && npm pack

# Test installation in clean directory
mkdir /tmp/vibe-validate-test
cd /tmp/vibe-validate-test
npm install /Users/jeff/Workspaces/vibe-validate/packages/cli/vibe-validate-cli-0.9.0.tgz

# Test CLI works
npx vibe-validate --version
# Expected: 0.9.0

npx vibe-validate --help
# Should show all commands
```

## 🚀 Step 5: Publish to npm

**CRITICAL**: Use `pnpm publish` (NOT `npm publish`) to correctly resolve `workspace:*` dependencies.

**Why pnpm publish?**
- `npm publish` leaves `workspace:*` in dependencies → uninstallable packages
- `pnpm publish` converts `workspace:*` to actual version numbers → correct dependencies

### Manual Publishing (Recommended for First Release)

```bash
# CRITICAL: Use pnpm publish with --no-git-checks flag

# 1. Publish packages with no dependencies (parallel order)
cd packages/extractors && pnpm publish --no-git-checks
cd packages/git && pnpm publish --no-git-checks
cd packages/config && pnpm publish --no-git-checks

# 2. Publish core (depends on extractors)
cd packages/core && pnpm publish --no-git-checks

# 3. Publish history (depends on config)
cd packages/history && pnpm publish --no-git-checks

# 4. Publish CLI (depends on all above)
cd packages/cli && pnpm publish --no-git-checks

# 5. Publish umbrella package (depends on CLI)
cd packages/vibe-validate && pnpm publish --no-git-checks
```

### Automated Publishing (Alternative - Use pnpm -r)

```bash
# WARNING: This may miss packages not matching the workspace pattern
# Prefer manual publishing to ensure all packages are published

# Publish scoped packages
pnpm -r --filter='@vibe-validate/*' publish --no-git-checks

# THEN publish umbrella package separately
cd packages/vibe-validate && pnpm publish --no-git-checks
```

### ⚠️ Common Mistake: Using npm publish

**DO NOT USE `npm publish`** - it will create broken packages with `workspace:*` dependencies.

If you accidentally publish with `npm publish`:
1. Deprecate broken version: `npm deprecate @vibe-validate/cli@X.Y.Z "message"`
2. Bump to patch version (e.g., 0.12.0 → 0.12.1)
3. Re-publish using `pnpm publish --no-git-checks`

## ✅ Step 6: Verify Published Packages

After publishing, verify **ALL 7 packages** are available:

```bash
# Check each package on npm (use pnpm view for consistency)
pnpm view @vibe-validate/extractors version
pnpm view @vibe-validate/git version
pnpm view @vibe-validate/config version
pnpm view @vibe-validate/core version
pnpm view @vibe-validate/history version
pnpm view @vibe-validate/cli version
pnpm view vibe-validate version  # ← UMBRELLA PACKAGE

# All should show the same version (e.g., 0.12.1)
```

**Verify dependencies resolved correctly:**

```bash
# Check CLI dependencies are version numbers (NOT workspace:*)
pnpm view @vibe-validate/cli dependencies

# Should show:
# {
#   '@vibe-validate/config': '0.12.1',
#   '@vibe-validate/core': '0.12.1',
#   ...
# }
# NOT workspace:*

# Check umbrella package dependency
pnpm view vibe-validate dependencies

# Should show:
# { '@vibe-validate/cli': '0.12.1' }
```

## 🧪 Step 7: Test Installation from npm

Test installation in a clean project:

```bash
# Create test project
mkdir /tmp/test-vibe-validate-install
cd /tmp/test-vibe-validate-install
npm init -y

# Install from npm
npm install -D @vibe-validate/cli

# Verify installation
npx vibe-validate --version
# Expected: 0.9.0

# Test init command
npx vibe-validate init
# Should show interactive setup

# Verify all dependencies installed correctly
npm ls @vibe-validate/cli
# Should show full dependency tree with all @vibe-validate packages
```

## 📋 Step 8: Test in External Project

Once published, test installation in an external project:

```bash
cd /path/to/test-project

# Install published version
npm install -D @vibe-validate/cli@^X.Y.Z

# Test full workflow
npx vibe-validate config
npx vibe-validate validate
npx vibe-validate pre-commit
```

## 🏷️ Step 9: Git Tagging

Tag the release in git:

```bash
cd /Users/jeff/Workspaces/vibe-validate

# Create tag
git tag -a vX.Y.Z -m "Release vX.Y.Z - Description"

# Push tag to GitHub
git push origin vX.Y.Z
```

## 📊 Post-Publishing Checklist

After successful publish:

- [ ] All 5 packages visible on npmjs.com
- [ ] Package pages show correct README.md
- [ ] Installation from npm works in clean project
- [ ] CLI commands work after npm install
- [ ] External project testing successful
- [ ] Git tag created and pushed

## 🐛 Troubleshooting

### "You must be logged in to publish packages"
```bash
npm login
# Follow browser authentication
```

### "You do not have permission to publish @vibe-validate/X"
```bash
# Verify organization membership
npm org ls vibe-validate

# Add yourself as member (if needed)
npm org add vibe-validate <your-npm-username>
```

### "Package name already taken"
```bash
# Check if package exists
npm view @vibe-validate/cli

# If owned by you, you can unpublish within 72 hours
npm unpublish @vibe-validate/cli@0.9.0

# Then re-publish
npm publish
```

### "workspace:* dependency not resolved"
This is expected before publishing. The `workspace:*` protocol is replaced with `^0.9.0` during npm publish automatically by pnpm.

### Tarball size too large
```bash
# Check what's being included
npm pack --dry-run

# Verify .npmignore excludes unnecessary files:
# - test/
# - *.test.ts
# - node_modules (automatically excluded)
```

## 📈 Monitoring Post-Release

After v0.9.0 is published:

1. **Monitor npm downloads**: https://npm-stat.com/charts.html?package=%40vibe-validate%2Fcli
2. **Watch for issues**: GitHub Issues (once repo is public)
3. **Collect feedback**: From early adopters using v0.9.0
4. **Plan v0.9.1**: Address critical bugs discovered
5. **Iterate toward v1.0.0**: API refinements based on real usage

## 🎯 Success Criteria

v0.9.0 publishing is successful when:

- ✅ All 5 packages published to npm
- ✅ Installation works via `npm install @vibe-validate/cli`
- ✅ CLI commands functional after npm install
- ✅ External projects successfully migrated to published version
- ✅ No breaking issues discovered in first 48 hours
- ✅ At least 2-3 projects successfully using published version

## 📞 Support

If you encounter issues during publishing:

- **npm support**: support@npmjs.com
- **Project issues**: GitHub Issues at https://github.com/jdutton/vibe-validate/issues
- **Documentation**: docs/ directory in this repo

---

**Ready to publish?** Start with Step 1 (npm login) and proceed sequentially through each step.
