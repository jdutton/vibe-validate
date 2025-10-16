# Configuration Reference

Complete reference for vibe-validate configuration options.

## Configuration File

vibe-validate looks for configuration files in your project root in this order:

1. `vibe-validate.config.ts`
2. `vibe-validate.config.js`
3. `vibe-validate.config.mjs`
4. `vibe-validate.config.json`
5. `.vibe-validaterc.ts`
6. `.vibe-validaterc.js`

**Recommended**: Use `.ts` or `.mjs` format for TypeScript type checking and modern JavaScript features.

## Basic Configuration

### TypeScript Configuration (Recommended)

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  validation: {
    phases: [
      // Validation phases configuration
    ],
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },
    failFast: false,
  },
  git: {
    mainBranch: 'main',
    autoSync: false,
  },
  output: {
    format: 'auto',
  },
});
```

### JavaScript (ESM) Configuration

```javascript
// vibe-validate.config.mjs
export default {
  validation: {
    phases: [
      // Validation phases configuration
    ],
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },
  },
};
```

### JSON Configuration

```json
{
  "validation": {
    "phases": [
      {
        "name": "Pre-Qualification",
        "parallel": true,
        "steps": [
          { "name": "TypeScript", "command": "tsc --noEmit" }
        ]
      }
    ],
    "caching": {
      "strategy": "git-tree-hash",
      "enabled": true
    }
  }
}
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
    autoSync: false,
  },
  output: {
    format: 'auto',
  },
});
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
