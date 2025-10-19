# CLI Reference

Complete reference guide for all vibe-validate CLI commands.

## Table of Contents

- [Global Options](#global-options)
- [Commands](#commands)
  - [validate](#validate)
  - [pre-commit](#pre-commit)
  - [state](#state)
  - [sync-check](#sync-check)
  - [cleanup](#cleanup)
  - [config](#config)
  - [init](#init)
  - [doctor](#doctor)
  - [generate-workflow](#generate-workflow)
- [Exit Codes](#exit-codes)
- [Environment Variables](#environment-variables)

## Global Options

All commands support these global options:

### `--help, -h`

Display help information for the command.

```bash
vibe-validate --help
vibe-validate validate --help
```

### `--version, -v`

Display the version of vibe-validate.

```bash
vibe-validate --version
```

### Output Format Options

Many commands support output format selection:

- `--format <format>` - Output format: `human`, `yaml`, `json`, or `auto` (default)
- `--human` - Force human-readable output (colorful, verbose)
- `--yaml` - Force YAML output (structured, agent-friendly)
- `--json` - Force JSON output (programmatic consumption)

The `auto` format detects the execution context:
- **Agent mode** (Claude Code, Cursor, Aider, Continue): YAML output
- **CI mode** (GitHub Actions, GitLab CI, etc.): YAML output
- **Human mode** (terminal): Colorful, verbose output

## Commands

### `validate`

Run the complete validation pipeline with caching support.

#### Usage

```bash
vibe-validate validate [options]
```

#### Options

- `--force` - Force re-validation, bypass cache
- `--format <format>` - Output format (human/yaml/json/auto)
- `--human` - Force human-readable output
- `--yaml` - Force YAML output
- `--json` - Force JSON output

#### Description

Executes the complete validation pipeline defined in your `vibe-validate.config.ts`:

1. **Calculate git tree hash** - Content-based hash of working directory
2. **Check validation state cache** - Skip if code unchanged
3. **Run validation phases** - Execute all configured validation steps
4. **Save validation state** - Cache results for future runs

**Performance**: Cached validation is typically 50-300x faster than full validation.

#### Examples

**Full validation (first run or after code changes):**
```bash
vibe-validate validate
# Output: Runs all validation phases (~30-120s depending on project)
```

**Cached validation (no code changes):**
```bash
vibe-validate validate
# Output: Skipped - validation state is current (< 1s)
```

**Force re-validation (bypass cache):**
```bash
vibe-validate validate --force
# Output: Runs all phases even if cache is valid
```

**Agent-friendly output:**
```bash
vibe-validate validate --yaml
# Output: Structured YAML with embedded error details
```

#### Exit Codes

- `0` - Validation passed (or cached state is valid)
- `1` - Validation failed (one or more steps failed)
- `2` - Configuration error or missing config file

#### State File

Validation results are cached in `.vibe-validate-state.yaml`:

```yaml
passed: true
timestamp: 2025-10-16T15:30:00.000Z
treeHash: a1b2c3d4e5f6789...
failedStep: null
failedStepOutput: null
agentPrompt: null
```

**Important**: Add `.vibe-validate-state.yaml` to your `.gitignore`.

---

### `pre-commit`

Run the pre-commit workflow: branch sync check + cached validation.

#### Usage

```bash
vibe-validate pre-commit [options]
```

#### Options

- `--force` - Force validation even if cached
- `--format <format>` - Output format (human/yaml/json/auto)
- `--human` - Force human-readable output
- `--yaml` - Force YAML output
- `--json` - Force JSON output

#### Description

The pre-commit workflow ensures code quality before committing:

1. **Check branch sync** - Verify branch is not behind origin/main
2. **Run cached validation** - Skip if validation state is current
3. **Exit with appropriate code** - 0 for success, 1 for failure

This command is designed for pre-commit hooks and local development workflows.

#### Examples

**Typical pre-commit usage:**
```bash
vibe-validate pre-commit
# Output:
# ✅ Branch is up to date with origin/main
# ✅ Validation state is current (skipped)
```

**When branch is behind:**
```bash
vibe-validate pre-commit
# Output:
# ❌ Branch is behind origin/main by 3 commits
# Run: git merge origin/main
# Exit code: 1
```

**Force full validation:**
```bash
vibe-validate pre-commit --force
# Output: Runs full validation even if cached
```

#### Integration

**Husky (recommended):**
```bash
# .husky/pre-commit
#!/bin/sh
npx vibe-validate pre-commit
```

**package.json script:**
```json
{
  "scripts": {
    "pre-commit": "vibe-validate pre-commit"
  }
}
```

#### Exit Codes

- `0` - Branch is synced and validation passed
- `1` - Branch is behind origin/main OR validation failed
- `2` - Configuration error or git error

---

### `state`

Display the current validation state.

#### Usage

```bash
vibe-validate state [options]
```

#### Options

- `--format <format>` - Output format (human/yaml/json/auto)
- `--human` - Force human-readable output
- `--yaml` - Force YAML output
- `--json` - Force JSON output

#### Description

Shows the current validation state from `.vibe-validate-state.yaml`, including:
- Validation result (passed/failed)
- Timestamp of last validation
- Git tree hash (for cache validation)
- Failed step details (if validation failed)
- Agent-friendly error prompt (if failed)

#### Examples

**Human-readable output:**
```bash
vibe-validate state
# Output:
# ✅ Validation State
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Status:    PASSED
# Timestamp: 2025-10-16 15:30:00
# Tree Hash: a1b2c3d4e5f6789...
```

**YAML output (agent-friendly):**
```bash
vibe-validate state --yaml
# Output:
# passed: true
# timestamp: 2025-10-16T15:30:00.000Z
# treeHash: a1b2c3d4e5f6789...
# failedStep: null
```

**JSON output (programmatic):**
```bash
vibe-validate state --json
# Output:
# {
#   "passed": true,
#   "timestamp": "2025-10-16T15:30:00.000Z",
#   "treeHash": "a1b2c3d4e5f6789...",
#   "failedStep": null
# }
```

#### Exit Codes

- `0` - State file found and readable
- `1` - State file not found or invalid

---

### `sync-check`

Check if the current branch is behind the configured remote and main branch.

#### Usage

```bash
vibe-validate sync-check [options]
```

#### Options

- `--main-branch <branch>` - Main branch name (overrides config)
- `--remote-origin <remote>` - Remote origin name (overrides config)
- `--format <format>` - Output format (human/yaml/json/auto)

#### Description

Safely checks branch synchronization without auto-merging:

1. **Fetch from origin** - Update remote tracking branches
2. **Compare with main** - Check if current branch is behind
3. **Report status** - Exit with appropriate code

**Safety**: This command NEVER auto-merges. It only reports status.

#### Examples

**Branch is up to date:**
```bash
vibe-validate sync-check
# Output:
# ✅ Branch is up to date with origin/main
# Exit code: 0
```

**Branch is behind:**
```bash
vibe-validate sync-check
# Output:
# ❌ Branch is behind origin/main by 3 commits
# Run: git merge origin/main
# Exit code: 1
```

**Check against upstream (forked repos):**
```bash
vibe-validate sync-check --remote-origin upstream
# Output:
# ✅ Branch is up to date with upstream/main
```

**Check against custom branch:**
```bash
vibe-validate sync-check --main-branch develop --remote-origin upstream
# Output:
# ✅ Branch is up to date with upstream/develop
```

**Not on a git branch:**
```bash
vibe-validate sync-check
# Output:
# ⚠️ Not on a git branch (detached HEAD)
# Exit code: 0
```

**No remote configured:**
```bash
vibe-validate sync-check
# Output:
# ⚠️ No remote 'origin' configured
# Exit code: 0
```

#### Exit Codes

- `0` - Branch is up to date OR not applicable (no remote, detached HEAD)
- `1` - Branch is behind remote main branch (merge needed)
- `2` - Git error (repository not found, etc.)

#### Configuration

Git configuration is customizable for different workflows:

```typescript
// vibe-validate.config.ts
export default defineConfig({
  git: {
    mainBranch: 'main',      // Default: 'main'
    remoteOrigin: 'origin',  // Default: 'origin'
  },
});
```

**Common scenarios**:

```typescript
// Forked repository - sync with upstream
git: {
  mainBranch: 'main',
  remoteOrigin: 'upstream',
}

// Legacy project - use master branch
git: {
  mainBranch: 'master',
  remoteOrigin: 'origin',
}

// Git-flow workflow - track develop
git: {
  mainBranch: 'develop',
  remoteOrigin: 'origin',
}
```

**CLI overrides**: Options passed via CLI always take precedence over config file settings.

---

### `cleanup`

Post-PR merge cleanup: switch to main, sync, and delete merged branches.

#### Usage

```bash
vibe-validate cleanup
```

#### Options

None.

#### Description

Automates workspace cleanup after PR merge:

1. **Switch to main branch** - Checkout main (or configured main branch)
2. **Sync with origin** - Pull latest changes from remote
3. **Identify merged branches** - Find branches fully merged into main
4. **Delete merged branches** - Remove local branches (with confirmation)

**Safety**: Only deletes branches that are fully merged. Unmerged branches are preserved.

#### Examples

**Typical cleanup:**
```bash
vibe-validate cleanup
# Output:
# 🔄 Switching to main branch...
# ✅ Syncing with origin/main...
# 🔍 Finding merged branches...
#
# Found 3 merged branches:
#   - feature/add-logging
#   - fix/validation-bug
#   - docs/update-readme
#
# Delete these branches? (y/N): y
# ✅ Deleted feature/add-logging
# ✅ Deleted fix/validation-bug
# ✅ Deleted docs/update-readme
```

**No merged branches:**
```bash
vibe-validate cleanup
# Output:
# 🔄 Switching to main branch...
# ✅ Syncing with origin/main...
# 🔍 Finding merged branches...
# ✅ No merged branches to clean up
```

**Already on main:**
```bash
vibe-validate cleanup
# Output:
# ✅ Already on main branch
# ✅ Syncing with origin/main...
# 🔍 Finding merged branches...
# (continues normally)
```

#### Exit Codes

- `0` - Cleanup completed successfully (or nothing to clean)
- `1` - Git error (repository not found, merge conflicts, etc.)

#### Configuration

Git configuration is customizable:

```typescript
// vibe-validate.config.ts
export default defineConfig({
  git: {
    mainBranch: 'main',      // Branch to switch to and sync
    remoteOrigin: 'origin',  // Remote to pull from
  },
});
```

---

### `config`

Display or validate the current configuration.

#### Usage

```bash
vibe-validate config [options]
```

#### Options

- `--format <format>` - Output format (human/yaml/json/auto)
- `--human` - Force human-readable output
- `--yaml` - Force YAML output
- `--json` - Force JSON output
- `--validate` - Validate configuration and exit

#### Description

Shows the active configuration loaded from your config file, including:
- Validation phases and steps
- Caching strategy configuration
- Git integration settings
- Output format preferences
- Preset information (if using a preset)

#### Examples

**Human-readable output:**
```bash
vibe-validate config
# Output:
# ⚙️  Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Config file: vibe-validate.config.ts
# Preset:      typescript-nodejs
#
# Validation Phases (2):
#   Phase 1: Pre-Qualification (parallel)
#     - TypeScript: tsc --noEmit
#     - ESLint: eslint src/
#   ...
```

**YAML output:**
```bash
vibe-validate config --yaml
# Output:
# validation:
#   phases:
#     - name: Pre-Qualification
#       parallel: true
#       steps:
#         - name: TypeScript
#           command: tsc --noEmit
#   ...
```

**Validate configuration only:**
```bash
vibe-validate config --validate
# Output:
# ✅ Configuration is valid
# Exit code: 0
```

**Invalid configuration:**
```bash
vibe-validate config --validate
# Output:
# ❌ Configuration validation failed:
#   - validation.phases: Expected array, received object
# Exit code: 1
```

#### Exit Codes

- `0` - Configuration is valid and loaded successfully
- `1` - Configuration validation failed (invalid schema)
- `2` - Configuration file not found

---

### `init`

Setup wizard for creating configuration and installing integrations.

#### Usage

```bash
vibe-validate init [options]
```

#### Options

- `-p, --preset <preset>` - Use preset (typescript-library|typescript-nodejs|typescript-react)
- `-f, --force` - Overwrite existing configuration
- `--dry-run` - Preview changes without writing files
- `--setup-hooks` - Install pre-commit hook (idempotent)
- `--setup-workflow` - Create GitHub Actions workflow (idempotent)
- `--fix-gitignore` - Add state file to .gitignore (idempotent)

#### Description

**Default mode** - Creates a `vibe-validate.config.ts` file with the specified preset:

1. **Detect git configuration** - Auto-detect main branch and remote
2. **Generate config** - Create TypeScript config file with preset
3. **Show next steps** - Display setup instructions

**Focused modes** - Perform specific setup tasks (can be combined):

- `--setup-hooks` - Creates `.husky/pre-commit` hook
- `--setup-workflow` - Creates `.github/workflows/validate.yml`
- `--fix-gitignore` - Adds `.vibe-validate-state.yaml` to .gitignore

All focused modes are **idempotent** - safe to run multiple times.

#### Examples

**Create config with default preset:**
```bash
vibe-validate init

# Output:
🔍 Auto-detected git configuration:
   Main branch: main
   Remote: origin
✅ Configuration file created successfully
📋 Created: vibe-validate.config.ts
   Preset: typescript-library

Next steps:
  1. Review and customize vibe-validate.config.ts
  2. Run: vibe-validate validate
  3. Add to package.json scripts:
     "validate": "vibe-validate validate"
     "pre-commit": "vibe-validate pre-commit"
```

**Create config with specific preset:**
```bash
vibe-validate init --preset typescript-nodejs
```

**Preview config creation (dry-run):**
```bash
vibe-validate init --dry-run

# Output:
🔍 Configuration preview (dry-run):
   Would create:
   - /path/to/vibe-validate.config.ts
   - Preset: typescript-library

💡 Run without --dry-run to create configuration
```

**Install pre-commit hook only:**
```bash
vibe-validate init --setup-hooks

# Output:
✅ Pre-commit hook: Created .husky/pre-commit hook (Note: Install husky as dev dependency if not already installed)
```

**Create GitHub Actions workflow only:**
```bash
vibe-validate init --setup-workflow

# Output:
✅ GitHub Actions workflow: Created .github/workflows/validate.yml
```

**Fix .gitignore only:**
```bash
vibe-validate init --fix-gitignore

# Output:
✅ Gitignore: Added .vibe-validate-state.yaml to .gitignore
```

**Combine multiple focused modes:**
```bash
vibe-validate init --setup-hooks --fix-gitignore

# Output:
✅ Gitignore: Added .vibe-validate-state.yaml to .gitignore
✅ Pre-commit hook: Created .husky/pre-commit hook
```

**Preview focused mode changes:**
```bash
vibe-validate init --setup-hooks --dry-run

# Output:
🔍 Pre-commit hook (dry-run):
   Install husky and create .husky/pre-commit hook with vibe-validate command
   Would create:
   - .husky/pre-commit (create)

💡 Run without --dry-run to apply changes
```

#### Generated Files

**vibe-validate.config.ts:**
```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  preset: 'typescript-nodejs',
  validation: {
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },
  },
  git: {
    mainBranch: 'main',
  },
  output: {
    format: 'auto',
  },
});
```

**package.json (updated):**
```json
{
  "scripts": {
    "validate": "vibe-validate validate",
    "pre-commit": "vibe-validate pre-commit"
  }
}
```

#### Exit Codes

- `0` - Configuration created successfully
- `1` - Setup cancelled or error occurred

---

### `doctor`

Diagnose repository health and vibe-validate setup.

#### Usage

```bash
vibe-validate doctor [options]
```

#### Options

- `--verbose` - Show detailed diagnostic information

#### Description

Performs comprehensive health checks on your repository and vibe-validate setup:

1. **Environment checks** - Node.js version, git availability
2. **Config checks** - Config file exists, valid format, deprecation warnings
3. **Git checks** - Main branch, remote origin, sync status
4. **Integration checks** - Pre-commit hook, GitHub Actions workflow, .gitignore
5. **Version check** - Compare current version with latest on npm
6. **Validation state** - Check if validation is current

Each check shows:
- ✅ **Pass** - Working correctly
- ❌ **Fail** - Needs attention, includes suggestion
- ⚠️ **Warning** - Non-critical issue

**Educational approach**: Failed checks show both manual steps AND automated `init` commands.

#### Examples

**Basic health check:**
```bash
vibe-validate doctor

# Output:
🏥 vibe-validate Doctor

✅ Node.js version (v20.11.0)
✅ Git repository
✅ Config file (vibe-validate.config.yaml)
✅ Config valid
✅ Package manager (pnpm)
✅ Main branch (main)
✅ Remote origin (origin)
✅ GitHub Actions workflow
❌ Pre-commit hook
   Pre-commit hook not installed
   💡 Manual: npx husky init && echo "npx vibe-validate pre-commit" > .husky/pre-commit
   💡 Or run: vibe-validate init --setup-hooks
   💡 Or disable: set hooks.preCommit.enabled=false in config
❌ Gitignore state file
   .vibe-validate-state.yaml not in .gitignore (state file should not be committed)
   💡 Manual: echo ".vibe-validate-state.yaml" >> .gitignore
   💡 Or run: vibe-validate init --fix-gitignore
✅ Validation state (current)

Summary: 11/13 checks passed

💡 Fix issues using suggested commands, then run 'vibe-validate doctor' again
```

**Verbose diagnostic output:**
```bash
vibe-validate doctor --verbose

# Output includes detailed information for each check
```

**Iterative fix workflow:**
```bash
# 1. Diagnose
vibe-validate doctor

# 2. Fix issues
vibe-validate init --setup-hooks --fix-gitignore

# 3. Verify
vibe-validate doctor

# Output:
Summary: 13/13 checks passed ✅
```

#### Exit Codes

- `0` - All checks passed
- `1` - One or more checks failed

---

### `generate-workflow`

Generate GitHub Actions workflow for CI/CD validation.

#### Usage

```bash
vibe-validate generate-workflow [options]
```

#### Options

- `--node-versions <versions>` - Node.js versions to test (comma-separated, default: "18,20")
- `--os <platforms>` - Operating systems to test (comma-separated, default: "ubuntu-latest")
- `--package-manager <pm>` - Package manager to use (npm|pnpm|yarn, auto-detected)

#### Description

Generates a `.github/workflows/validate.yml` file configured for your project:

1. **Matrix testing** - Test across multiple Node.js versions and OS platforms
2. **Smart package manager** - Auto-detects npm, pnpm, or yarn
3. **Optimized caching** - Caches dependencies and validation state
4. **Fail-fast strategy** - Stops on first failure to save CI minutes

The generated workflow integrates with GitHub's status checks for pull requests.

#### Examples

**Generate default workflow:**
```bash
vibe-validate generate-workflow

# Output:
✅ Generated .github/workflows/validate.yml
   Node versions: 18, 20
   OS: ubuntu-latest
   Package manager: pnpm (auto-detected)

Next steps:
  1. Review .github/workflows/validate.yml
  2. Commit and push to enable CI validation
```

**Custom Node.js versions:**
```bash
vibe-validate generate-workflow --node-versions "18,20,22"
```

**Multi-platform testing:**
```bash
vibe-validate generate-workflow --os "ubuntu-latest,windows-latest,macos-latest"
```

**Specific package manager:**
```bash
vibe-validate generate-workflow --package-manager npm
```

**Or use focused init mode:**
```bash
vibe-validate init --setup-workflow
# Simpler alternative with sensible defaults
```

#### Generated Workflow

**Key features:**
- Runs on push to main and all pull requests
- Matrix strategy for multiple Node.js versions
- Package manager dependency caching
- Fails fast on first error
- Uses vibe-validate's git tree hash caching

#### Exit Codes

- `0` - Workflow generated successfully
- `1` - Generation failed (missing config, invalid options)

---

## Exit Codes

All vibe-validate commands use consistent exit codes:

| Exit Code | Meaning |
|-----------|---------|
| `0` | Success - command completed successfully |
| `1` | Failure - validation failed, branch behind, etc. |
| `2` | Error - configuration error, git error, etc. |

### Exit Code Usage in CI/CD

```bash
# Fail CI/CD if validation fails
vibe-validate validate
if [ $? -ne 0 ]; then
  echo "Validation failed"
  exit 1
fi

# Fail PR if branch is behind main
vibe-validate sync-check
if [ $? -eq 1 ]; then
  echo "Branch is behind main - please merge"
  exit 1
fi
```

---

## Environment Variables

vibe-validate respects these environment variables:

### Agent Detection

- `CLAUDE_CODE` - Set to `1` to enable Claude Code mode (YAML output)
- `CURSOR` - Set to `1` to enable Cursor mode (YAML output)
- `AIDER` - Set to `1` to enable Aider mode (YAML output)
- `CONTINUE` - Set to `1` to enable Continue mode (YAML output)
- `CI` - Set to `true` by most CI systems (YAML output)

**Example:**
```bash
CLAUDE_CODE=1 vibe-validate validate
# Forces agent-friendly YAML output
```

### Output Control

- `NO_COLOR` - Disable colored output (standard environment variable)
- `FORCE_COLOR` - Force colored output even in non-TTY environments

**Example:**
```bash
NO_COLOR=1 vibe-validate validate
# Disables all color codes in output
```

### Git Configuration

- `GIT_DIR` - Override git directory location
- `GIT_WORK_TREE` - Override git working tree location

**Example:**
```bash
GIT_DIR=/path/to/.git vibe-validate validate
# Use specific git repository
```

---

## Configuration Files

vibe-validate uses **YAML** configuration format:

**File name**: `vibe-validate.config.yaml` (must be in project root)

**Create config**: Run `npx vibe-validate init` to generate configuration file.

---

## Common Workflows

### Development Workflow

```bash
# Make changes to code
vim src/index.ts

# Run validation before committing
vibe-validate pre-commit

# Commit changes
git commit -m "feat: add new feature"
```

### CI/CD Workflow

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npx vibe-validate validate --yaml
```

### Pre-Commit Hook

```bash
# .husky/pre-commit
#!/bin/sh
npx vibe-validate pre-commit
```

### Branch Management

```bash
# Before starting new work
vibe-validate sync-check

# After PR is merged
vibe-validate cleanup
```

---

## Troubleshooting

### "Configuration file not found"

**Solution**: Run `vibe-validate init` to create a configuration file.

### "Branch is behind origin/main"

**Solution**: Merge changes from main:
```bash
git merge origin/main
```

### "Validation state is stale"

**Solution**: Force re-validation:
```bash
vibe-validate validate --force
```

### "Git tree hash mismatch"

**Solution**: Ensure working directory is clean:
```bash
git status
# Commit or stash uncommitted changes
```

### "Command not found: vibe-validate"

**Solution**: Install vibe-validate:
```bash
npm install -D @vibe-validate/cli
```

Or use with npx:
```bash
npx vibe-validate validate
```

---

## Related Documentation

- [Getting Started Guide](./getting-started.md)
- [Configuration Reference](./configuration-reference.md)
- [Presets Guide](./presets-guide.md)
- [Error Formatters Guide](./error-formatters-guide.md)
- [Agent Integration Guide](./agent-integration-guide.md)

---

## See Also

- [vibe-validate GitHub Repository](https://github.com/yourusername/vibe-validate)
- [npm Package](https://www.npmjs.com/package/@vibe-validate/cli)
- [Issue Tracker](https://github.com/yourusername/vibe-validate/issues)
