# @vibe-validate/config

TypeScript-first configuration system for vibe-validate with Zod schema validation and framework presets.

## Features

- ✅ **TypeScript-First**: Full type safety with IDE autocomplete
- ✅ **Zod Validation**: Runtime schema validation with detailed error messages
- ✅ **Framework Presets**: Pre-configured setups for common TypeScript project types
- ✅ **Preset Override**: Extend and customize presets easily
- ✅ **Multiple File Formats**: Support for `.ts`, `.mts`, `.js`, `.mjs`, and `.json` configs
- ✅ **Config Extension**: Extend other config files

## Installation

```bash
npm install @vibe-validate/config
```

## Usage

### Basic Configuration

Create a `vibe-validate.config.ts` file in your project root:

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  validation: {
    phases: [
      {
        name: 'Type Checking',
        parallel: false,
        steps: [
          { name: 'TypeScript', command: 'tsc --noEmit' }
        ]
      }
    ]
  }
});
```

### Using a Preset

Start with a framework-specific preset:

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  preset: 'typescript-nodejs',
  // Optional: Override or extend preset configuration
  validation: {
    phases: [
      // Add custom phases or override preset phases
    ]
  }
});
```

### Available Presets

#### `typescript-library`

Default preset for TypeScript npm libraries:
- TypeScript type checking
- ESLint linting
- Unit tests
- Build validation

#### `typescript-nodejs`

Preset for Node.js applications:
- TypeScript type checking + build
- ESLint linting
- Unit + integration tests

#### `typescript-react`

Preset for React applications:
- TypeScript type checking
- ESLint linting
- Unit + component tests
- Production build (10min timeout)

## Configuration Schema

### Full Configuration Example

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  validation: {
    phases: [
      {
        name: 'Phase 1: Pre-Qualification',
        parallel: true,
        timeout: 300000, // 5 minutes (default)
        failFast: true,  // Stop on first error (default)
        steps: [
          {
            name: 'TypeScript',
            command: 'tsc --noEmit',
            timeout: 60000, // Step-specific timeout
            continueOnError: false,
            env: { NODE_ENV: 'test' },
            cwd: './packages/core'
          }
        ]
      }
    ],
    caching: {
      strategy: 'git-tree-hash', // 'git-tree-hash' | 'timestamp' | 'disabled'
      enabled: true,
      statePath: '.vibe-validate-state.yaml'
    }
  },
  git: {
    mainBranch: 'main',
    autoSync: false,
    warnIfBehind: true
  },
  output: {
    format: 'auto', // 'auto' | 'human' | 'yaml' | 'json'
    showProgress: true,
    verbose: false,
    noColor: false
  }
});
```

### Config Extension

Extend another config file:

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  extends: '../base-config.ts',
  validation: {
    // Overrides merged with base config
  }
});
```

## API

### `defineConfig(config)`

Type-safe configuration helper providing IDE autocomplete and validation.

### `getPreset(name)`

Get a preset by name:

```typescript
import { getPreset } from '@vibe-validate/config';

const preset = getPreset('typescript-library');
```

### `listPresets()`

List all available presets:

```typescript
import { listPresets } from '@vibe-validate/config';

console.log(listPresets()); // ['typescript-library', 'typescript-nodejs', 'typescript-react']
```

### `loadConfigFromFile(path)`

Load and validate configuration from a file:

```typescript
import { loadConfigFromFile } from '@vibe-validate/config';

const config = await loadConfigFromFile('./vibe-validate.config.ts');
```

### `findAndLoadConfig(cwd?)`

Find and load configuration from working directory:

```typescript
import { findAndLoadConfig } from '@vibe-validate/config';

const config = await findAndLoadConfig(); // Searches for config in cwd
```

### `loadConfigWithFallback(cwd?)`

Load configuration with fallback to default preset:

```typescript
import { loadConfigWithFallback } from '@vibe-validate/config';

const config = await loadConfigWithFallback(); // Uses typescript-library preset if no config found
```

## Configuration File Discovery

The loader searches for config files in this order:

1. `vibe-validate.config.ts`
2. `vibe-validate.config.mts`
3. `vibe-validate.config.js`
4. `vibe-validate.config.mjs`
5. `vibe-validate.config.json`
6. `.vibe-validate.json`

## Validation

Zod schemas provide runtime validation with detailed error messages:

```typescript
import { validateConfig, safeValidateConfig } from '@vibe-validate/config';

// Throws ZodError on invalid config
const config = validateConfig(rawConfig);

// Returns { success, data?, errors? }
const result = safeValidateConfig(rawConfig);
if (!result.success) {
  console.error(result.errors);
}
```

## License

MIT
