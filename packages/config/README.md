# @vibe-validate/config

Configuration system for vibe-validate with strict Zod schema validation and JSON Schema support.

## Features

- ✅ **Strict Schema Validation**: Runtime validation with Zod (rejects unknown properties)
- ✅ **JSON Schema Support**: IDE autocomplete and validation for YAML configs
- ✅ **YAML Configuration**: Primary format with schema validation
- ✅ **Type Safety**: Full TypeScript definitions for programmatic use

## Installation

```bash
npm install @vibe-validate/config
```

## Usage

### YAML Configuration (Recommended)

Create a `vibe-validate.config.yaml` file using a template:

```bash
npx vibe-validate init --template typescript-nodejs
```

**Available templates:**
- `minimal` - Bare-bones starting point
- `typescript-library` - TypeScript libraries/npm packages
- `typescript-nodejs` - Node.js applications
- `typescript-react` - React/Next.js applications

All templates: https://github.com/jdutton/vibe-validate/tree/main/config-templates

### Example YAML Configuration

```yaml
$schema: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json

# Git settings
git:
  mainBranch: main
  autoSync: false
  warnIfBehind: true

# Validation configuration
validation:
  phases:
    - name: Pre-Qualification
      parallel: true
      steps:
        - name: TypeScript
          command: tsc --noEmit
          description: Type-check all code
        - name: ESLint
          command: eslint .
          description: Lint for code quality

    - name: Testing
      parallel: false
      steps:
        - name: Unit Tests
          command: npm test
          description: Run test suite

  failFast: true  # Stop all validation on first phase failure

# Output configuration
output:
  showProgress: true
  verbose: false
  noColor: false
```

### YAML Schema Support

The `$schema` property enables IDE autocomplete and validation:

```yaml
$schema: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json
```

This gives you:
- ✅ Autocomplete for all configuration properties
- ✅ Inline validation errors
- ✅ Hover documentation for each field
- ✅ Type checking for YAML configs

## API (Programmatic Usage)

### `loadConfig(cwd?)`

Load configuration from current directory:

```typescript
import { loadConfig } from '@vibe-validate/config';

const config = await loadConfig(); // Searches for vibe-validate.config.yaml
```

### `loadConfigFromFile(path)`

Load and validate configuration from a specific file:

```typescript
import { loadConfigFromFile } from '@vibe-validate/config';

const config = await loadConfigFromFile('./vibe-validate.config.yaml');
```

### `findAndLoadConfig(cwd?)`

Find and load configuration from working directory:

```typescript
import { findAndLoadConfig } from '@vibe-validate/config';

const config = await findAndLoadConfig(); // Searches for config in cwd
```

### `validateConfig(rawConfig)`

Validate a raw configuration object:

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

## Configuration File Discovery

The loader searches for the config file:

- `vibe-validate.config.yaml` (only supported format)

**Note**: `.mjs` config format is no longer supported. If you have a legacy `.mjs` config, run `vibe-validate doctor` to see migration guidance.

## Configuration Schema

See the complete configuration reference: https://github.com/jdutton/vibe-validate/blob/main/docs/configuration-reference.md

### Key Sections

- **`git`** - Git repository settings (mainBranch, autoSync, etc.)
- **`validation`** - Validation phases and steps configuration
- **`validation.phases`** - Array of validation phases to execute
- **`validation.phases[].steps`** - Array of commands to run in each phase
- **`validation.failFast`** - Stop all validation on first phase failure (default: true)
- **`output`** - Output formatting options
- **`ci`** - CI/CD configuration (Node versions, OS matrix, etc.)
- **`hooks`** - Git hooks configuration

### Strict Validation

All Zod schemas use strict validation - unknown properties are rejected:

```yaml
validation:
  phases: []
  unknownProperty: true  # ❌ ERROR: Unrecognized key 'unknownProperty'
```

This catches typos and prevents configuration drift.

## License

MIT
