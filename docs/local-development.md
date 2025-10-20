# Local Development Guide

This guide explains how to develop and test vibe-validate locally, including linking it to test projects for real-world validation.

## Table of Contents

- [Quick Start](#quick-start)
- [Development Modes](#development-modes)
- [Linking Strategies](#linking-strategies)
- [CI/CD Configuration](#cicd-configuration)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

## Quick Start

### 1. Set Up vibe-validate

```bash
# Clone and set up vibe-validate
cd /path/to/workspace
git clone https://github.com/your-org/vibe-validate.git
cd vibe-validate

# Install dependencies and build
pnpm install
pnpm -r build

# Verify setup
pnpm test
pnpm validate
```

### 2. Link to Test Project

```bash
# Navigate to your test project
cd /path/to/test-project

# Link vibe-validate (choose one method below)
pnpm add -D file:../vibe-validate/packages/cli
```

### 3. Test Your Changes

```bash
# In vibe-validate: make changes and rebuild
cd /path/to/vibe-validate
# ... edit files ...
pnpm -r build

# In test project: test changes
cd /path/to/test-project
pnpm validate  # Uses your local vibe-validate
```

## Development Modes

### Mode 1: Local Development (Active Feature Work)

**Use case**: Developing new vibe-validate features and testing them immediately

**Setup**:
```bash
# In test project
pnpm add -D file:../vibe-validate/packages/cli
```

**package.json**:
```json
{
  "devDependencies": {
    "@vibe-validate/cli": "file:../vibe-validate/packages/cli"
  }
}
```

**Workflow**:
1. Make changes to vibe-validate
2. Run `pnpm -r build` in vibe-validate
3. Test immediately in linked project
4. No reinstall needed - file: protocol stays linked

**Pros**:
- ✅ Changes available immediately after rebuild
- ✅ No manual linking/unlinking
- ✅ Works across machine restarts
- ✅ Clear in package.json what mode you're in

**Cons**:
- ⚠️ Need to rebuild after each change
- ⚠️ File path is absolute, not portable

### Mode 2: Published Version (Normal Operation)

**Use case**: Production use, stable dependency, CI/CD pipelines

**Setup**:
```bash
# In test project
pnpm add -D @vibe-validate/cli@latest
```

**package.json**:
```json
{
  "devDependencies": {
    "@vibe-validate/cli": "^1.0.0"
  }
}
```

**Workflow**:
1. Use stable published version from npm
2. Update with `pnpm update @vibe-validate/cli`
3. No local development needed

**Pros**:
- ✅ Stable, versioned dependency
- ✅ Works in CI/CD without special setup
- ✅ No local vibe-validate workspace needed
- ✅ Semantic versioning support

**Cons**:
- ⚠️ Can't test unpublished changes
- ⚠️ Must wait for new release to get fixes

### Mode 3: Workspace Protocol (Monorepo-Style)

**Use case**: Side-by-side development with automatic fallback

**Setup**:
```bash
# In test project (if in same parent directory as vibe-validate)
pnpm add -D workspace:@vibe-validate/cli@*
```

**package.json**:
```json
{
  "devDependencies": {
    "@vibe-validate/cli": "workspace:*"
  }
}
```

**Workflow**:
1. pnpm automatically resolves to local workspace if available
2. Falls back to published version if workspace not found
3. Best of both worlds

**Pros**:
- ✅ Auto-detects local workspace
- ✅ Falls back to published version
- ✅ Clean switching between modes
- ✅ Works well with pnpm workspaces

**Cons**:
- ⚠️ Requires pnpm (not npm/yarn)
- ⚠️ Only works with specific directory structure

## Linking Strategies

### Strategy 1: File Protocol (Recommended)

**When to use**: Active vibe-validate development with test project

**Setup**:
```bash
cd /path/to/test-project
pnpm add -D file:../vibe-validate/packages/cli
```

**How it works**:
- Creates symlink-like reference to local package
- Changes available after rebuild
- No manual linking/unlinking needed

**Caveats**:
- Path must be relative to test project
- Must rebuild vibe-validate after changes
- Not suitable for CI/CD (use published version)

### Strategy 2: pnpm link (Multiple Test Projects)

**When to use**: Testing with multiple projects simultaneously

**Setup**:
```bash
# In vibe-validate
cd packages/cli
pnpm link --global

# In test project 1
cd /path/to/test-project-1
pnpm link --global @vibe-validate/cli

# In test project 2
cd /path/to/test-project-2
pnpm link --global @vibe-validate/cli
```

**Cleanup**:
```bash
# In each test project
pnpm unlink --global @vibe-validate/cli

# In vibe-validate
cd packages/cli
pnpm unlink --global
```

**How it works**:
- Creates global symlink to local package
- All linked projects use same local version
- Changes available after rebuild

**Caveats**:
- Must remember to unlink when done
- Can cause confusion if left linked
- Global state can be fragile

### Strategy 3: Workspace Protocol (Monorepo)

**When to use**: Test project in pnpm workspace with vibe-validate

**Setup**:
```yaml
# pnpm-workspace.yaml (in parent directory)
packages:
  - 'vibe-validate/packages/*'
  - 'test-project'
```

```bash
cd /path/to/test-project
pnpm add -D workspace:@vibe-validate/cli@*
```

**How it works**:
- pnpm treats both as workspace packages
- Automatically resolves to local version
- Changes available after rebuild

**Caveats**:
- Requires specific directory structure
- Only works with pnpm workspaces
- CI/CD needs special handling

## CI/CD Configuration

### Problem: CI doesn't have local vibe-validate workspace

When CI runs, it won't have your local vibe-validate directory.

### Solution 1: Conditional Dependency (Recommended)

**Development** (package.json):
```json
{
  "devDependencies": {
    "@vibe-validate/cli": "file:../vibe-validate/packages/cli"
  }
}
```

**Before CI commit**:
```bash
# Switch to published version
pnpm add -D @vibe-validate/cli@latest

# Commit changes
git add package.json pnpm-lock.yaml
git commit -m "chore: switch to published vibe-validate"
```

### Solution 2: Script-Based Switching

**package.json**:
```json
{
  "scripts": {
    "install:vibe-local": "pnpm add -D file:../vibe-validate/packages/cli",
    "install:vibe-published": "pnpm add -D @vibe-validate/cli@latest",
    "pretest": "node scripts/check-vibe-validate.js"
  }
}
```

**scripts/check-vibe-validate.js**:
```javascript
import { existsSync } from 'fs';
import { execSync } from 'child_process';

// Check if using file: protocol in CI
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const vibeValidateDep = pkg.devDependencies['@vibe-validate/cli'];

if (process.env.CI && vibeValidateDep?.startsWith('file:')) {
  console.error('❌ CI cannot use file: protocol for @vibe-validate/cli');
  console.error('Run: pnpm run install:vibe-published');
  process.exit(1);
}
```

### Solution 3: Separate Branches (Advanced)

**main branch**: Uses published version
**development branch**: Uses file: protocol

**Workflow**:
1. Develop on `development` branch with file: protocol
2. Merge to `main` after switching to published version
3. CI only runs on `main` branch

## Troubleshooting

### Issue: "Cannot find module '@vibe-validate/cli'"

**Cause**: vibe-validate not built or linked incorrectly

**Solution**:
```bash
# In vibe-validate workspace
cd /path/to/vibe-validate
pnpm -r build

# In test project
pnpm install  # Re-resolve dependencies
```

### Issue: "Changes not reflected in test project"

**Cause**: Forgot to rebuild vibe-validate after changes

**Solution**:
```bash
# In vibe-validate workspace
pnpm -r build  # Rebuild all packages

# Verify build output exists
ls -la packages/cli/dist/
```

### Issue: "Cannot find exported member" from @vibe-validate packages

**Symptom**: TypeScript error when importing from workspace packages:
```
error TS2305: Module '@vibe-validate/config' has no exported member 'MyNewExport'.
```

**Root Cause**: pnpm caches workspace packages based on version number in `package.json`. When you add new exports without bumping the version, pnpm uses the cached package which doesn't have your new code.

**Why this happens**:
- **Version ranges** (`^0.9.0`) cause pnpm to cache based on semver
- pnpm doesn't monitor the `dist/` folder for changes
- New exports exist in your source but not in the cached package

**Solution 1: Use workspace:* protocol (RECOMMENDED)**

Always use `workspace:*` for internal dependencies during development:

```json
// packages/cli/package.json
{
  "dependencies": {
    "@vibe-validate/config": "workspace:*",  // ✅ Always live
    "@vibe-validate/core": "workspace:*"
  }
}
```

**Benefits**:
- Creates live symlinks to source packages
- TypeScript always sees latest types from `dist/`
- No caching issues during development
- Automatically replaced with version ranges when publishing

**Solution 2: Force pnpm to refresh (if using version ranges)**

```bash
# Nuclear option - removes all cached packages
rm -rf node_modules
pnpm install

# Rebuild to ensure types are up-to-date
pnpm -r build
```

**Prevention**: The vibe-validate monorepo uses `workspace:*` protocol for all internal dependencies to avoid this issue. If you're working on vibe-validate itself, this should not be a problem.

### Issue: "file: protocol breaks CI"

**Cause**: CI doesn't have local vibe-validate workspace

**Solution**: Use conditional dependency or script-based switching (see [CI/CD Configuration](#cicd-configuration))

### Issue: "pnpm link breaks after reboot"

**Cause**: Global link state lost after machine restart

**Solution**:
```bash
# Re-establish link
cd /path/to/vibe-validate/packages/cli
pnpm link --global

cd /path/to/test-project
pnpm link --global @vibe-validate/cli
```

**Better solution**: Use file: protocol instead of pnpm link

### Issue: "Workspace protocol not resolving"

**Cause**: Test project not in pnpm workspace

**Solution**: Verify pnpm-workspace.yaml includes test project:
```yaml
packages:
  - 'vibe-validate/packages/*'
  - 'test-project'  # Must be listed here
```

## Best Practices

### 1. Document Your Setup

In your test project's CLAUDE.md or CONTRIBUTING.md:

```markdown
## Using Local vibe-validate (Development)

This project can use a local vibe-validate for testing:

1. Clone vibe-validate to `../vibe-validate` (sibling directory)
2. Run `pnpm add -D file:../vibe-validate/packages/cli`
3. Make changes to vibe-validate and run `pnpm -r build`
4. Test with `pnpm validate` in this project

To switch back to published version:
```bash
pnpm add -D @vibe-validate/cli@latest
```
```

### 2. Use .gitignore for Lock Files

If using file: protocol in development only:

```gitignore
# .gitignore
pnpm-lock.yaml  # Prevent committing file: protocol locks
```

**Warning**: Only do this if team agrees to regenerate locks

### 3. Add Helper Scripts

```json
{
  "scripts": {
    "vibe:local": "pnpm add -D file:../vibe-validate/packages/cli",
    "vibe:published": "pnpm add -D @vibe-validate/cli@latest",
    "vibe:rebuild": "cd ../vibe-validate && pnpm -r build && cd -"
  }
}
```

Usage:
```bash
pnpm run vibe:local        # Switch to local
pnpm run vibe:rebuild      # Rebuild local vibe-validate
pnpm validate              # Test changes
pnpm run vibe:published    # Switch back to published
```

### 4. Test Before Publishing

Before publishing vibe-validate to npm:

1. Test with file: protocol in multiple projects
2. Run full validation suite
3. Verify all quality checks pass
4. Document any breaking changes

### 5. Keep Workspace Clean

```bash
# Periodically check what's linked
pnpm list @vibe-validate/cli

# If using file:, ensure vibe-validate is up to date
cd ../vibe-validate
git pull
pnpm install
pnpm -r build
```

## Real-World Example: External Project Integration

This example shows how vibe-validate was integrated into an existing TypeScript project.

### Initial Setup (Pre-Publish)

```bash
# Example project directory
cd /path/to/your-project

# Link to local vibe-validate (development mode)
pnpm add -D file:../vibe-validate/packages/cli

# Create config (copy from template and customize)
npx vibe-validate init --template typescript-nodejs

# Or create custom config
cat > vibe-validate.config.yaml << 'EOF'
$schema: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json

git:
  mainBranch: main

validation:
  phases:
    - name: Pre-Qualification + Build
      parallel: true
      steps:
        - name: TypeScript
          command: npm run typecheck
        - name: ESLint
          command: npm run lint
        - name: OpenAPI
          command: npm run test:openapi
        - name: Build
          command: npm run build

    - name: Testing
      parallel: true
      steps:
        - name: Unit tests
          command: npm run test:unit
        - name: Integration tests
          command: npm run test:integration
        - name: STDIO tests
          command: npm run test:system:stdio
        - name: HTTP tests
          command: npm run test:system:ci
        - name: Headless tests
          command: npm run test:system:headless
EOF

# Test validation
pnpm validate
```

### Post-Publish Setup

```bash
# Switch to published version
pnpm add -D @vibe-validate/cli@latest

# Commit changes
git add package.json pnpm-lock.yaml vibe-validate.config.yaml
git commit -m "feat: migrate to vibe-validate for validation"
```

### Development Workflow

```bash
# When testing vibe-validate changes
pnpm run vibe:local          # Switch to local
cd ../vibe-validate
# ... make changes ...
pnpm -r build
cd -
pnpm validate                # Test changes

# When done testing
pnpm run vibe:published      # Switch back to published
```

## Further Reading

- [CONTRIBUTING.md](../CONTRIBUTING.md) - General contribution guidelines
- [README.md](../README.md) - User documentation
- [packages/config/README.md](../packages/config/README.md) - Configuration reference
- [packages/cli/README.md](../packages/cli/README.md) - CLI reference
