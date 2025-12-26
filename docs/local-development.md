# Local Development Guide

This guide explains how to develop and test vibe-validate locally by linking it to test projects.

## Quick Start

### 1. Set Up vibe-validate

```bash
# Clone and set up vibe-validate
cd /path/to/workspace
git clone https://github.com/jdutton/vibe-validate.git
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

# Link vibe-validate using file: protocol
pnpm add -D file:../vibe-validate/packages/cli
```

### 3. Test Your Changes

```bash
# In vibe-validate: make changes and rebuild
cd /path/to/vibe-validate
# ... edit files ...
pnpm -r build

# In test project: test changes immediately
cd /path/to/test-project
npx vibe-validate validate  # Uses your local vibe-validate
```

## Linking Methods

### Method 1: File Protocol (Recommended)

**Use case**: Active vibe-validate development with test project

```bash
cd /path/to/test-project
pnpm add -D file:../vibe-validate/packages/cli
```

**Pros**:
- ✅ Changes available immediately after rebuild
- ✅ No manual linking/unlinking
- ✅ Works across machine restarts

**Cons**:
- ⚠️ Need to rebuild after each change
- ⚠️ File path is relative, not portable

### Method 2: pnpm link (Multiple Test Projects)

**Use case**: Testing with multiple projects simultaneously

```bash
# In vibe-validate
cd packages/cli
pnpm link --global

# In test project
cd /path/to/test-project
pnpm link --global @vibe-validate/cli
```

**Cleanup**:
```bash
# In test project
pnpm unlink --global @vibe-validate/cli

# In vibe-validate
cd packages/cli
pnpm unlink --global
```

**Pros**:
- ✅ One link works for multiple test projects

**Cons**:
- ⚠️ Must remember to unlink when done
- ⚠️ Global state can be fragile

## Troubleshooting

### Changes not reflected in test project

**Cause**: Forgot to rebuild after changes

**Solution**:
```bash
cd /path/to/vibe-validate
pnpm -r build  # Rebuild all packages
```

### Cannot find module '@vibe-validate/cli'

**Cause**: vibe-validate not built or linked incorrectly

**Solution**:
```bash
# In vibe-validate workspace
cd /path/to/vibe-validate
pnpm -r build

# In test project
pnpm install  # Re-resolve dependencies
```

### TypeScript "Cannot find exported member" errors

**Cause**: pnpm caches workspace packages based on version number. New exports exist in source but not in cached package.

**Solution**: The vibe-validate monorepo uses `workspace:*` protocol for all internal dependencies to avoid this issue. If you're working on vibe-validate itself, this should not be a problem.

If you encounter this in an external project:
```bash
rm -rf node_modules
pnpm install
pnpm -r build
```

## CI/CD Considerations

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
pnpm add -D vibe-validate@latest

# Commit changes
git add package.json pnpm-lock.yaml
git commit -m "chore: switch to published vibe-validate"
```

## Best Practices

### 1. Add Helper Scripts

Add to your test project's `package.json`:

```json
{
  "scripts": {
    "vibe:local": "pnpm add -D file:../vibe-validate/packages/cli",
    "vibe:published": "pnpm add -D vibe-validate@latest",
    "vibe:rebuild": "cd ../vibe-validate && pnpm -r build && cd -"
  }
}
```

Usage:
```bash
pnpm run vibe:local        # Switch to local
pnpm run vibe:rebuild      # Rebuild local vibe-validate
npx vibe-validate validate # Test changes
pnpm run vibe:published    # Switch back to published
```

### 2. Test Before Publishing

Before publishing vibe-validate to npm:

1. Test with file: protocol in multiple projects
2. Run full validation suite (`pnpm validate`)
3. Verify all quality checks pass
4. Document any breaking changes

## Further Reading

- [CONTRIBUTING.md](../.github/CONTRIBUTING.md) - General contribution guidelines
- [README.md](../README.md) - User documentation
- [Configuration Reference](./skill/resources/configuration-reference.md) - Complete config options
- [CLI Reference](./skill/resources/cli-reference.md) - All CLI commands
