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

## 🧪 Step 3: Dry-Run Testing

Test publishing without actually uploading to npm:

```bash
# Test all packages
npm run publish:dry-run

# Or test individual packages
cd packages/extractors && npm publish --dry-run
cd packages/git && npm publish --dry-run
cd packages/config && npm publish --dry-run
cd packages/core && npm publish --dry-run
cd packages/cli && npm publish --dry-run
```

**Verify output includes:**
- ✅ Package name and version
- ✅ Files that will be published (dist/, README.md, LICENSE)
- ✅ No errors or warnings
- ✅ Tarball size is reasonable (< 1MB per package)

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

**IMPORTANT**: Publish in dependency order to avoid "dependency not found" errors.

### Manual Publishing (Recommended for First Release)

```bash
# 1. Publish packages with no dependencies (parallel order)
cd packages/extractors && npm publish
cd packages/git && npm publish
cd packages/config && npm publish

# 2. Publish core (depends on extractors, git via external deps if any)
cd packages/core && npm publish

# 3. Publish CLI (depends on core, git, config)
cd packages/cli && npm publish
```

### Automated Publishing (Use After Testing Manual Process)

```bash
# Publish all packages in correct order
npm run publish:all
```

## ✅ Step 6: Verify Published Packages

After publishing, verify packages are available:

```bash
# Check each package on npm
npm view @vibe-validate/extractors
npm view @vibe-validate/git
npm view @vibe-validate/config
npm view @vibe-validate/core
npm view @vibe-validate/cli

# Expected output for each:
# - version: 0.9.0
# - description, keywords, repository
# - dist.tarball URL
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
