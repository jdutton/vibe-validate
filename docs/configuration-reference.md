# Configuration Reference

Complete reference for vibe-validate configuration options.

## Configuration File

vibe-validate uses **YAML** as the configuration format.

The configuration file must be named `vibe-validate.config.yaml` in your project root.

**Migrating from legacy formats**: If you have an existing `.mjs` config, run:
```bash
npx vibe-validate init --migrate
```

## Basic Configuration

### YAML Configuration

```yaml
# vibe-validate.config.yaml

# JSON Schema for IDE autocomplete and validation
$schema: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json

# Use a preset as base (typescript-library, typescript-nodejs, typescript-react)
extends: typescript-library

# Git integration settings
git:
  mainBranch: main
  remoteOrigin: origin
  autoSync: false  # Never auto-merge - safety first

# Validation configuration
validation:
  caching:
    strategy: git-tree-hash  # Content-based caching
    enabled: true
  failFast: true  # Stop at first failure
```

### Configuration with Custom Phases

If you need to customize validation steps beyond the preset defaults:

```yaml
# vibe-validate.config.yaml
$schema: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json

extends: typescript-library

git:
  mainBranch: main
  remoteOrigin: origin
  autoSync: false

validation:
  # Override preset phases with custom steps
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

  caching:
    strategy: git-tree-hash
    enabled: true

  failFast: false  # Continue even if a step fails
```

## Configuration Schema

### Top-Level Options

```typescript
{
  validation: ValidationConfig;  // Required
  git?: GitConfig;               // Optional
  output?: OutputConfig;         // Optional
}
```

## Validation Configuration

### `validation.phases`

Array of validation phases. Each phase groups related validation steps.

**Type**: `Phase[]`

**Required**: Yes

```typescript
phases: [
  {
    name: string;        // Phase name
    parallel?: boolean;  // Run steps in parallel (default: false)
    steps: Step[];       // Validation steps
  },
  // ... more phases
]
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

```typescript
// Parallel execution (faster, for independent checks)
{
  name: 'Static Analysis',
  parallel: true,
  steps: [
    { name: 'TypeScript', command: 'tsc --noEmit' },
    { name: 'ESLint', command: 'eslint src/' },
  ],
}

// Sequential execution (for dependent checks)
{
  name: 'Testing',
  parallel: false,
  steps: [
    { name: 'Unit Tests', command: 'vitest run' },
    { name: 'Integration Tests', command: 'npm run test:integration' },
  ],
}
```

### Step Configuration

#### `name` (required)

Display name for the validation step.

**Type**: `string`

**Example**: `"TypeScript"`, `"Unit Tests"`, `"Build"`

#### `command` (required)

Shell command to execute for this validation step.

**Type**: `string`

**Examples**:
```typescript
{ name: 'TypeScript', command: 'tsc --noEmit' }
{ name: 'ESLint', command: 'eslint src/ --max-warnings=0' }
{ name: 'Tests', command: 'vitest run --coverage' }
{ name: 'Build', command: 'npm run build' }
```

**Note**: Commands run in the project root directory.

#### Environment-Specific Commands

You can use `process.env` to customize commands based on environment:

```javascript
// vibe-validate.config.mjs
export default {
  validation: {
    phases: [{
      name: 'Testing',
      steps: [{
        name: 'Unit Tests',
        // Verbose output in CI, concise locally
        command: process.env.CI
          ? 'npm test -- --reporter=verbose'
          : 'npm test',
        description: 'Run unit tests with coverage',
      }]
    }]
  }
}
```

**Common patterns**:
- `process.env.CI` - Detect CI environment (GitHub Actions, GitLab CI, etc.)
- `process.env.CLAUDE_CODE` - Detect Claude Code agent
- `process.env.NODE_ENV` - Development vs production
- `process.env.DEBUG` - Enable debug output

**Why use environment-specific commands?**
- **Verbose output in CI**: When tests fail in CI, you need full details immediately
- **Concise output locally**: Developers prefer minimal noise during development
- **Different tool configurations**: Use different configs for different environments

**Example with multiple environments**:
```javascript
const isCI = process.env.CI === 'true';
const isClaude = process.env.CLAUDE_CODE === '1';

export default {
  validation: {
    phases: [{
      steps: [{
        name: 'Tests',
        command: isCI
          ? 'vitest run --reporter=verbose --coverage'
          : isClaude
            ? 'vitest run --reporter=json'
            : 'vitest run',
      }]
    }]
  }
}
```

### `validation.caching`

Configuration for validation state caching.

#### `strategy`

Caching strategy to use.

**Type**: `'git-tree-hash' | 'timestamp' | 'disabled'`

**Default**: `'git-tree-hash'`

**Options**:

- **`git-tree-hash`** (recommended): Content-based caching using deterministic git tree hashing
  - Cache key based on actual file content
  - Includes untracked files
  - Deterministic (same code = same hash)
  - Invalidated when any file content changes

- **`timestamp`**: Time-based caching using file modification times
  - Cache key based on most recent file modification
  - Faster calculation than git-tree-hash
  - Less accurate (file touch invalidates cache)

- **`disabled`**: No caching
  - Always runs full validation
  - Useful for debugging caching issues

**Example**:
```typescript
caching: {
  strategy: 'git-tree-hash',
  enabled: true,
}
```

#### `enabled`

Whether caching is enabled.

**Type**: `boolean`

**Default**: `true`

**Example**:
```typescript
caching: {
  enabled: false, // Disable caching entirely
}
```

### `validation.failFast`

Whether to stop validation at first failure.

**Type**: `boolean`

**Default**: `false`

**Options**:

- **`false`** (recommended): Runs all validation steps even if some fail
  - Provides complete error visibility
  - Shows all issues in one run
  - Better for fixing multiple issues at once

- **`true`**: Stops at first failure
  - Faster feedback on breakage
  - Useful for quick iteration
  - May hide subsequent issues

**Example**:
```typescript
validation: {
  failFast: true, // Stop at first failure
  phases: [
    // ...
  ],
}
```

## Git Configuration

Configuration for git workflow integration.

### `git.mainBranch`

Name of the main branch to sync with.

**Type**: `string`

**Default**: `'main'`

**Examples**:
```typescript
git: {
  mainBranch: 'main',   // Most projects
  // or
  mainBranch: 'master', // Legacy projects
  // or
  mainBranch: 'develop', // Git-flow projects
}
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
```typescript
git: {
  mainBranch: 'main',
  remoteOrigin: 'origin',  // Standard workflow (most projects)
}

// Forked repository workflow
git: {
  mainBranch: 'main',
  remoteOrigin: 'upstream',  // Sync with upstream, not your fork
}

// Git-flow with custom remote
git: {
  mainBranch: 'develop',
  remoteOrigin: 'upstream',  // Track upstream/develop
}
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
```typescript
git: {
  autoSync: false, // Never auto-merge (always false)
}
```

## Output Configuration

Configuration for output formatting.

### `output.format`

Output format for validation results.

**Type**: `'human' | 'yaml' | 'json' | 'auto'`

**Default**: `'auto'`

**Options**:

- **`human`**: Colorful, verbose output with emojis and progress bars
  - Best for manual terminal usage
  - Includes context and explanations
  - Uses chalk for colors

- **`yaml`**: Structured YAML output
  - Agent-friendly format
  - Used by AI assistants (Claude Code, Cursor, etc.)
  - Includes embedded error output

- **`json`**: Machine-readable JSON output
  - CI/CD integration
  - Programmatic consumption
  - Parseable by scripts

- **`auto`** (recommended): Automatically detects context
  - `human` for manual terminal usage
  - `yaml` for AI assistants (detected via environment variables)
  - `json` for CI environments (CI=true)

**Example**:
```typescript
output: {
  format: 'auto', // Automatically detect context
}
```

### Output Behavior

#### Real-Time Streaming

All validation commands stream output in real-time as they execute. This means you'll see:

- **Test progress** as tests run
- **Build output** as compilation happens
- **Lint results** as files are checked

Output is both streamed to the terminal AND captured for the state file, ensuring:
- Immediate visibility during execution
- Complete error details preserved for later analysis
- Better debugging experience in CI environments

**Example output during test execution:**
```
🔍 Running Testing (1 steps in parallel)...
   ⏳ Unit Tests with Coverage  →  npm test

 RUN  v3.2.4 /path/to/project
 ✓ should pass first test
 ✓ should pass second test
 ✗ should fail this test

      ✅ Unit Tests with Coverage - PASSED (15.3s)
```

This real-time feedback is especially valuable when:
- Running long test suites
- Debugging CI failures
- Working with LLM assistants that need immediate feedback

## Using Presets

Start with a preset and customize as needed.

### Available Presets

- **`typescript-library`**: For npm packages and libraries
- **`typescript-nodejs`**: For Node.js applications and servers
- **`typescript-react`**: For React/Next.js applications

### Extending a Preset

```typescript
import { defineConfig, mergeConfig } from '@vibe-validate/config';
import { typescriptNodejsPreset } from '@vibe-validate/config/presets';

export default defineConfig(
  mergeConfig(typescriptNodejsPreset, {
    validation: {
      phases: [
        // Add custom phases after preset phases
        {
          name: 'Security Scan',
          steps: [
            { name: 'npm audit', command: 'npm audit --audit-level=high' },
            { name: 'snyk', command: 'snyk test' },
          ],
        },
      ],
      caching: {
        strategy: 'git-tree-hash', // Override preset caching
      },
    },
    git: {
      mainBranch: 'develop', // Override preset main branch
    },
  })
);
```

### Overriding Preset Steps

Replace specific steps from the preset:

```typescript
import { defineConfig, mergeConfig } from '@vibe-validate/config';
import { typescriptLibraryPreset } from '@vibe-validate/config/presets';

// Get preset config
const preset = typescriptLibraryPreset;

// Override specific phases
preset.validation.phases[0].steps = [
  { name: 'TypeScript', command: 'tsc --noEmit --strict' }, // Stricter
  { name: 'ESLint', command: 'eslint src/ --max-warnings=0' }, // No warnings
];

export default defineConfig(preset);
```

## Config Inheritance

Use the `extends` field to inherit from another configuration.

```typescript
// vibe-validate.config.base.ts
export default {
  validation: {
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },
  },
};

// vibe-validate.config.ts
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  extends: './vibe-validate.config.base.ts',
  validation: {
    phases: [
      // Custom phases
    ],
  },
});
```

## Environment Variables

vibe-validate respects these environment variables:

### Agent Detection

- `CLAUDE_CODE=true` - Detects Claude Code
- `CURSOR=true` - Detects Cursor
- `AIDER=true` - Detects Aider
- `CONTINUE=true` - Detects Continue
- `CI=true` - Detects CI environment

### Behavior Overrides

- `VIBE_VALIDATE_FORCE=true` - Force validation (bypass cache)
- `VIBE_VALIDATE_FORMAT=human|yaml|json` - Override output format
- `VIBE_VALIDATE_NO_COLOR=true` - Disable colored output

## Complete Example

Comprehensive configuration with all options:

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  validation: {
    phases: [
      {
        name: 'Pre-Qualification',
        parallel: true,
        steps: [
          { name: 'TypeScript', command: 'tsc --noEmit' },
          { name: 'ESLint', command: 'eslint src/ --max-warnings=0' },
          { name: 'Prettier', command: 'prettier --check src/' },
        ],
      },
      {
        name: 'Testing',
        parallel: false,
        steps: [
          { name: 'Unit Tests', command: 'vitest run --coverage' },
          { name: 'Integration Tests', command: 'npm run test:integration' },
        ],
      },
      {
        name: 'Build',
        parallel: false,
        steps: [
          { name: 'Build', command: 'npm run build' },
          { name: 'Bundle Size', command: 'npm run check:bundle-size' },
        ],
      },
      {
        name: 'Security',
        parallel: true,
        steps: [
          { name: 'npm audit', command: 'npm audit --audit-level=high' },
          { name: 'License Check', command: 'npm run check:licenses' },
        ],
      },
    ],
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },
    failFast: false,
  },
  git: {
    mainBranch: 'main',
    remoteOrigin: 'origin',
    autoSync: false,
  },
  output: {
    format: 'auto',
  },
});
```

## Common Git Configuration Scenarios

### Standard Single-Remote Workflow

Most projects use the default `origin` remote:

```typescript
git: {
  mainBranch: 'main',
  remoteOrigin: 'origin',  // Default - can be omitted
}
```

### Forked Repository Workflow

When working on a fork, sync with the upstream repository:

```typescript
git: {
  mainBranch: 'main',
  remoteOrigin: 'upstream',  // Sync with original repo, not your fork
}
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

```typescript
git: {
  mainBranch: 'master',
  remoteOrigin: 'origin',
}
```

### Git-Flow Workflow

Track `develop` branch instead of `main`:

```typescript
git: {
  mainBranch: 'develop',
  remoteOrigin: 'origin',
}
```

### Enterprise Custom Remote

Internal git servers with custom remote names:

```typescript
git: {
  mainBranch: 'main',
  remoteOrigin: 'corporate',  // Custom remote name
}
```

## Troubleshooting Git Configuration

### "Branch is behind origin/main" but should check upstream

**Problem**: You're working on a fork but vibe-validate checks `origin` instead of `upstream`.

**Solution**: Set `remoteOrigin: 'upstream'` in your config:

```typescript
git: {
  mainBranch: 'main',
  remoteOrigin: 'upstream',
}
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

```typescript
git: {
  mainBranch: 'master',  // or 'develop', 'trunk', etc.
  remoteOrigin: 'origin',
}
```

## Validation File Locations

Cache state file:

- **Location**: `.vibe-validate-state.yaml` (project root)
- **Git**: Should be .gitignored
- **Contents**: Validation results, git tree hash, timestamp, errors

**Add to `.gitignore`**:
```gitignore
# vibe-validate state (never commit)
.vibe-validate-state.yaml
```

## See Also

- [Getting Started](getting-started.md) - Initial setup
- [CLI Reference](cli-reference.md) - Command-line options
- [Presets Guide](presets-guide.md) - Using and customizing presets
- [Error Formatters Guide](error-formatters-guide.md) - Error formatting details
