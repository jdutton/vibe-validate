# Configuration Reference

Complete reference for vibe-validate configuration options.

## Configuration File

vibe-validate uses **YAML** as the configuration format.

The configuration file must be named `vibe-validate.config.yaml` in your project root.

## Basic Configuration

### YAML Configuration

```yaml
# vibe-validate.config.yaml

# JSON Schema for IDE autocomplete and validation
$schema: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json

# Git integration settings
git:
  mainBranch: main
  remoteOrigin: origin
  autoSync: false  # Never auto-merge - safety first

# Validation configuration
validation:
  failFast: true  # Stop at first failure
```

### Configuration with Custom Phases

Example with custom validation phases:

```yaml
# vibe-validate.config.yaml
$schema: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json

git:
  mainBranch: main
  remoteOrigin: origin
  autoSync: false

validation:
  # Define custom validation phases
  phases:
    - name: Pre-Qualification
      parallel: true  # Run steps simultaneously
      steps:
        - name: TypeScript
          command: tsc --noEmit
          description: Type-check TypeScript files
        - name: ESLint
          command: eslint src/
          description: Lint source code

    - name: Testing
      parallel: false  # Run steps sequentially
      steps:
        - name: Unit Tests
          command: npm test
          description: Run unit tests with coverage

  failFast: false  # Continue even if a step fails
```

## Configuration Schema

### Top-Level Options

```yaml
validation:  # Required - validation configuration
  phases: []

git:  # Optional - git integration settings
  mainBranch: main
```

## Validation Configuration

### `validation.phases`

Array of validation phases. Each phase groups related validation steps.

**Type**: `Phase[]`

**Required**: Yes

```yaml
phases:
  - name: Phase Name         # Required: string
    parallel: false           # Optional: boolean (default: false)
    steps:                    # Required: array of steps
      - name: Step Name
        command: command here
```

### Phase Options

#### `name` (required)

Display name for the phase.

**Type**: `string`

**Example**: `"Pre-Qualification"`, `"Testing"`, `"Build"`

#### `parallel` (optional)

Whether to run steps in this phase simultaneously or sequentially.

**Type**: `boolean`

**Default**: `false`

**Examples**:

```yaml
# Parallel execution (faster, for independent checks)
- name: Static Analysis
  parallel: true
  steps:
    - name: TypeScript
      command: tsc --noEmit
    - name: ESLint
      command: eslint src/

# Sequential execution (for dependent checks)
- name: Testing
  parallel: false
  steps:
    - name: Unit Tests
      command: vitest run
    - name: Integration Tests
      command: npm run test:integration
```

#### `timeout` (optional)

Default timeout for all steps in this phase (in milliseconds).

**Type**: `number`

**Default**: `300000` (5 minutes)

**Example**:
```yaml
- name: End-to-End Tests
  parallel: false
  timeout: 900000  # 15 minutes for all steps in this phase
  steps:
    - name: E2E Tests
      command: npm run test:e2e
```

**Note**: Individual steps can override this with their own `timeout` property.

#### `failFast` (optional)

Stop executing steps in this phase after first failure.

**Type**: `boolean`

**Default**: `true`

**Examples**:
```yaml
# Stop phase on first step failure (default)
- name: Pre-Qualification
  parallel: true
  failFast: true  # Stop if TypeScript OR ESLint fails
  steps:
    - name: TypeScript
      command: tsc --noEmit
    - name: ESLint
      command: eslint src/

# Run all steps even if some fail (collect all errors)
- name: Code Quality Checks
  parallel: true
  failFast: false  # Run all checks to see all issues
  steps:
    - name: TypeScript
      command: tsc --noEmit
    - name: ESLint
      command: eslint src/
    - name: Prettier
      command: prettier --check src/
```

**Note**: This is different from `validation.failFast` which controls whether to stop ALL validation (all phases) on first phase failure.

### Step Configuration

#### `name` (required)

Display name for the validation step.

**Type**: `string`

**Example**: `"TypeScript"`, `"Unit Tests"`, `"Build"`

#### `command` (required)

Shell command to execute for this validation step.

**Type**: `string`

**Examples**:
```yaml
- name: TypeScript
  command: tsc --noEmit

- name: ESLint
  command: eslint src/ --max-warnings=0

- name: Tests
  command: vitest run --coverage

- name: Build
  command: npm run build
```

**Note**: Commands run in the project root directory by default (see `cwd` option to override).

#### `description` (optional)

Human-readable description of what this step does.

**Type**: `string`

**Example**:
```yaml
- name: TypeScript
  command: tsc --noEmit
  description: Type-check all TypeScript files
```

**Note**: Used for documentation and informational purposes only.

#### `timeout` (optional)

Override the phase timeout for this specific step (in milliseconds).

**Type**: `number`

**Default**: Inherits from `phase.timeout` (300000ms = 5 minutes)

**Example**:
```yaml
- name: Integration Tests
  command: npm run test:integration
  timeout: 600000  # 10 minutes (longer than phase default)
```

#### `continueOnError` (optional)

Continue to next step even if this step fails.

**Type**: `boolean`

**Default**: `false`

**Example**:
```yaml
- name: Optional Linter
  command: npm run lint:experimental
  continueOnError: true  # Don't fail phase if this fails
```

**Use case**: Non-critical checks that shouldn't block validation.

#### `env` (optional)

Environment variables to set for this step only.

**Type**: `object` (key-value pairs)

**Example**:
```yaml
- name: Tests
  command: npm test
  env:
    NODE_ENV: test
    CI: "true"
    COVERAGE: "true"

- name: Build
  command: npm run build
  env:
    NODE_ENV: production
    BUILD_TARGET: es2020
```

**Note**: These variables are merged with system environment variables (step-level vars take precedence).

#### `cwd` (optional)

Working directory for this step's command.

**Type**: `string` (relative or absolute path)

**Default**: Project root directory

**Example**:
```yaml
- name: Test Subpackage
  command: npm test
  cwd: packages/core

- name: Build Docs
  command: npm run build
  cwd: ./docs-site
```

**Use case**: Monorepos or projects with subdirectories that need isolated commands.

### `validation.failFast`

Whether to stop validation at first phase failure.

**Type**: `boolean`

**Default**: `true`

**Options**:

- **`true`** (default): Stops at first phase failure
  - Faster feedback on breakage
  - Useful for quick iteration
  - May hide subsequent issues

- **`false`**: Runs all validation phases even if some fail
  - Provides complete error visibility
  - Shows all issues in one run
  - Better for fixing multiple issues at once

**Example**:
```yaml
validation:
  failFast: false  # Run all phases even if one fails
  phases:
    # ... (your phases here)
```

## Git Configuration

Configuration for git workflow integration.

### `git.mainBranch`

Name of the main branch to sync with.

**Type**: `string`

**Default**: `'main'`

**Examples**:
```yaml
# Most projects
git:
  mainBranch: main

# Legacy projects
git:
  mainBranch: master

# Git-flow projects
git:
  mainBranch: develop
```

### `git.remoteOrigin`

Name of the git remote to sync with.

**Type**: `string`

**Default**: `'origin'`

**When to customize**:
- **Forked repositories**: Use `upstream` to sync with the original repository
- **Multiple remotes**: Specify which remote to track for validation
- **Enterprise workflows**: Custom remote names for internal git servers

**Examples**:
```yaml
# Standard workflow (most projects)
git:
  mainBranch: main
  remoteOrigin: origin

# Forked repository workflow
git:
  mainBranch: main
  remoteOrigin: upstream  # Sync with upstream, not your fork

# Git-flow with custom remote
git:
  mainBranch: develop
  remoteOrigin: upstream  # Track upstream/develop
```

**How it's used**:
- `pre-commit` command: Checks if branch is behind `<remoteOrigin>/<mainBranch>`
- `sync-check` command: Verifies sync with `<remoteOrigin>/<mainBranch>`
- Branch validation: Ensures you're up-to-date before committing

### `git.autoSync`

Whether to automatically merge/rebase when behind main branch.

**Type**: `boolean`

**Default**: `false`

**Safety**: This option is **always false** for safety. vibe-validate never auto-merges.

**Example**:
```yaml
git:
  autoSync: false  # Never auto-merge (always false)
```

## CI Configuration

Configuration for GitHub Actions workflow generation (via `generate-workflow` command).

### `ci.nodeVersions` (optional)

Node.js versions to test in CI matrix.

**Type**: `string[]`

**Default**: `['20', '22']`

**Example**:
```yaml
ci:
  nodeVersions: ['20', '22', '24']  # Test on Node.js 20, 22, and 24
```

### `ci.os` (optional)

Operating systems to test in CI matrix.

**Type**: `string[]`

**Default**: `['ubuntu-latest']`

**Example**:
```yaml
ci:
  os: ['ubuntu-latest', 'macos-latest', 'windows-latest']
```

### `ci.failFast` (optional)

Stop CI matrix on first failure.

**Type**: `boolean`

**Default**: `false`

**Example**:
```yaml
ci:
  failFast: true  # Stop testing other OS/Node combos on first failure
```

### `ci.coverage` (optional)

Enable coverage reporting in CI.

**Type**: `boolean`

**Default**: `false`

**Example**:
```yaml
ci:
  coverage: true  # Upload coverage reports to Codecov
```

**Complete CI Example**:
```yaml
ci:
  nodeVersions: ['20', '22', '24']
  os: ['ubuntu-latest', 'macos-latest']
  failFast: false
  coverage: true
```

## Hooks Configuration

Configuration for git hooks (pre-commit, etc.).

### `hooks.preCommit.enabled` (optional)

Enable pre-commit hook checking during `doctor` command.

**Type**: `boolean`

**Default**: `true`

**Example**:
```yaml
hooks:
  preCommit:
    enabled: false  # Skip pre-commit hook checks
```

### `hooks.preCommit.command` (optional)

Custom command to run in pre-commit hook.

**Type**: `string`

**Default**: `'npx vibe-validate pre-commit'`

**Example**:
```yaml
hooks:
  preCommit:
    enabled: true
    command: 'pnpm vibe-validate pre-commit'  # Use pnpm instead of npx
```

**Complete Hooks Example**:
```yaml
hooks:
  preCommit:
    enabled: true
    command: 'npx vibe-validate pre-commit'
```

## Using Config Templates

Start with a template and customize as needed.

### Available Templates

- **`minimal`**: Bare-bones starting point
- **`typescript-library`**: For npm packages and libraries
- **`typescript-nodejs`**: For Node.js applications and servers
- **`typescript-react`**: For React/Next.js applications

All templates are available at: https://github.com/jdutton/vibe-validate/tree/main/config-templates

### Using a Template

```bash
# Initialize with a specific template
npx vibe-validate init --template typescript-nodejs

# Or copy directly from GitHub
curl -o vibe-validate.config.yaml \
  https://raw.githubusercontent.com/jdutton/vibe-validate/main/config-templates/typescript-nodejs.yaml
```

### Customizing Templates

After copying a template, customize it for your project:

```yaml
# Start with typescript-nodejs template, then customize
validation:
  phases:
    - name: Pre-Qualification
      parallel: true
      steps:
        - name: TypeScript
          command: pnpm typecheck
        - name: ESLint
          command: pnpm lint

    - name: Testing
      parallel: false
      steps:
        - name: Unit Tests
          command: pnpm test

    # Add custom security phase
    - name: Security
      parallel: true
      steps:
        - name: npm audit
          command: npm audit --audit-level=high
        - name: Snyk scan
          command: snyk test

    - name: Build
      parallel: false
      steps:
        - name: Build
          command: pnpm build

  failFast: true

git:
  mainBranch: develop  # Customize for your workflow
  remoteOrigin: origin
  autoSync: false
```

## Environment Variables

vibe-validate respects these environment variables for agent context detection:

- `CLAUDE_CODE=true` - Detects Claude Code context
- `CURSOR=true` - Detects Cursor context
- `AIDER=true` - Detects Aider context
- `CONTINUE=true` - Detects Continue context
- `CI=true` - Detects CI environment

**Purpose**: Agent detection optimizes output verbosity for AI assistants vs. interactive terminals.

**Behavior**:
- **Agent contexts** (Claude Code, Cursor, etc.): Minimal terminal output, errors in validation state
- **CI environments**: Minimal terminal output, errors in validation state
- **Interactive terminals**: Verbose terminal output with colors and progress indicators

**Note**: All contexts use YAML format (access via `vibe-validate state` command)

**Note**: Use CLI flags for behavior control (e.g., `--force` to bypass cache, `--verbose` for detailed output)

## Complete Example

Comprehensive configuration with all options:

```yaml
# vibe-validate.config.yaml
$schema: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json

# Git configuration
git:
  mainBranch: main
  remoteOrigin: origin
  autoSync: false
  warnIfBehind: true

# CI/CD configuration (for generate-workflow command)
ci:
  nodeVersions: ['20', '22', '24']
  os: ['ubuntu-latest', 'macos-latest']
  failFast: false
  coverage: true

# Hooks configuration
hooks:
  preCommit:
    enabled: true
    command: 'npx vibe-validate pre-commit'

# Validation configuration
validation:
  phases:
    - name: Pre-Qualification
      parallel: true
      timeout: 300000  # 5 minutes for all steps in this phase
      failFast: true   # Stop phase on first step failure
      steps:
        - name: TypeScript
          command: tsc --noEmit
          description: Type-check all TypeScript files

        - name: ESLint
          command: eslint src/ --max-warnings=0
          description: Lint source code

        - name: Prettier
          command: prettier --check src/
          description: Check code formatting

    - name: Testing
      parallel: false
      timeout: 600000  # 10 minutes for this phase
      steps:
        - name: Unit Tests
          command: vitest run --coverage
          description: Run unit tests with coverage
          env:
            NODE_ENV: test
            COVERAGE: "true"

        - name: Integration Tests
          command: npm run test:integration
          description: Run integration tests
          timeout: 900000  # 15 minutes (override phase timeout)
          env:
            NODE_ENV: test

    - name: Build
      parallel: false
      steps:
        - name: Build
          command: npm run build
          description: Build application
          env:
            NODE_ENV: production

        - name: Bundle Size
          command: npm run check:bundle-size
          description: Verify bundle size limits
          continueOnError: true  # Don't fail if bundle is slightly large

    - name: Security
      parallel: true
      failFast: false  # Run all security checks even if one fails
      steps:
        - name: npm audit
          command: npm audit --audit-level=high
          description: Check for security vulnerabilities
          continueOnError: true  # Don't block on audit findings

        - name: License Check
          command: npm run check:licenses
          description: Verify dependency licenses

  failFast: false  # Continue all phases even if one fails
```

## Common Git Configuration Scenarios

### Standard Single-Remote Workflow

Most projects use the default `origin` remote:

```yaml
git:
  mainBranch: main
  remoteOrigin: origin  # Default - can be omitted
```

### Forked Repository Workflow

When working on a fork, sync with the upstream repository:

```yaml
git:
  mainBranch: main
  remoteOrigin: upstream  # Sync with original repo, not your fork
```

**Setup**:
```bash
# Add upstream remote (one-time setup)
git remote add upstream https://github.com/original/repo.git

# Configure vibe-validate to track upstream
# (add remoteOrigin: 'upstream' to config)
```

### Legacy Main Branch Name

Projects using `master` instead of `main`:

```yaml
git:
  mainBranch: master
  remoteOrigin: origin
```

### Git-Flow Workflow

Track `develop` branch instead of `main`:

```yaml
git:
  mainBranch: develop
  remoteOrigin: origin
```

### Enterprise Custom Remote

Internal git servers with custom remote names:

```yaml
git:
  mainBranch: main
  remoteOrigin: corporate  # Custom remote name
```

## Troubleshooting Git Configuration

### "Branch is behind origin/main" but should check upstream

**Problem**: You're working on a fork but vibe-validate checks `origin` instead of `upstream`.

**Solution**: Set `remoteOrigin: 'upstream'` in your config:

```yaml
git:
  mainBranch: main
  remoteOrigin: upstream
```

### "Remote not found" error

**Problem**: Configured remote doesn't exist in your repository.

**Solution**: Verify remote exists:

```bash
git remote -v

# Add missing remote if needed
git remote add upstream https://github.com/owner/repo.git
```

### Using different branch names

**Problem**: Your team uses `master` or `develop` instead of `main`.

**Solution**: Configure the correct branch name:

```yaml
git:
  mainBranch: master  # or 'develop', 'trunk', etc.
  remoteOrigin: origin
```

## Validation State Storage

Validation state is stored in git notes (not files):

- **Storage**: Git notes under `refs/notes/vibe-validate/runs`
- **Access**: Use `vibe-validate state` command to view current state
- **History**: Use `vibe-validate history list` to view all validations
- **Contents**: Validation results, git tree hash, timestamp, errors

**No `.gitignore` needed** - state is stored in git notes, not tracked files.

**Migration from v0.11.x**: If upgrading, run `vibe-validate doctor` to detect deprecated `.vibe-validate-state.yaml` files.

## See Also

- [Getting Started](getting-started.md) - Initial setup
- [CLI Reference](cli-reference.md) - Command-line options
- [Config Templates Guide](../config-templates/README.md) - Using and customizing templates
- [Error Formatters Guide](error-formatters-guide.md) - Error formatting details
