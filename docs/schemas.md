# JSON Schemas

vibe-validate publishes JSON Schema files for all configuration and result types, enabling IDE autocomplete, validation, and type safety.

## Overview

vibe-validate provides 5 published JSON Schema files:

| Schema | Package | Purpose | Use Case |
|--------|---------|---------|----------|
| `config.schema.json` | `@vibe-validate/config` | Configuration file validation | User config files (`vibe-validate.config.yaml`) |
| `validate-result.schema.json` | `@vibe-validate/core` | Validation result format | Validation output, history records |
| `run-result.schema.json` | `@vibe-validate/cli` | Run command output | `run` command results |
| `watch-pr-result.schema.json` | `@vibe-validate/cli` | PR monitoring output | `watch-pr` command results |
| `error-extractor-result.schema.json` | `@vibe-validate/extractors` | Error extraction format | Extractor outputs, nested validation |

## Schema Locations

### Why These Package Assignments?

**`config.schema.json` in `@vibe-validate/config`**
- Input schema for user configurations
- Loaded by config package
- No dependencies on other packages

**`validate-result.schema.json` in `@vibe-validate/core`**
- Engine output format
- Used by history package to record/truncate validation runs
- Must be in core to avoid circular dependency (cli → history, history → core)

**`run-result.schema.json` and `watch-pr-result.schema.json` in `@vibe-validate/cli`**
- CLI-specific command outputs
- Not used by other packages
- Encapsulated in CLI package

**`error-extractor-result.schema.json` in `@vibe-validate/extractors`**
- Extractor output format
- Used by core package for nested validation
- Independent from CLI and config

## Accessing Schemas

### NPM CDN URLs (Recommended)

Use unpkg.com to access schemas directly from published npm packages:

#### Version-Pinned URLs (For User Projects)

Version-pinned URLs ensure your IDE autocomplete matches your installed package version:

```yaml
# vibe-validate.config.yaml
$schema: https://unpkg.com/@vibe-validate/config@0.15.0/config.schema.json
```

**Benefits:**
- ✅ Stable URLs tied to npm versions (not Git branch)
- ✅ Schema matches installed package API
- ✅ No breakage when main branch changes
- ✅ IDE autocomplete works with exact version

**How `vibe-validate init` handles versioning:**

The `init` command automatically generates version-pinned URLs matching the CLI version:

```typescript
// packages/cli/src/commands/init.ts
const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
templateConfig.$schema = `https://unpkg.com/@vibe-validate/config@${version}/config.schema.json`;
```

#### Latest Version URLs (For Documentation)

Latest URLs automatically point to the newest published version:

```yaml
$schema: https://unpkg.com/@vibe-validate/config/config.schema.json
$schema: https://unpkg.com/@vibe-validate/core/validate-result.schema.json
$schema: https://unpkg.com/@vibe-validate/cli/run-result.schema.json
```

**Use for:**
- Documentation examples
- Guides and tutorials
- Quick prototyping

**Don't use for:**
- Production config files (use version-pinned instead)
- Projects with locked dependencies

### All Schema URLs

#### Config Schema
```yaml
# Version-pinned (recommended for user configs)
$schema: https://unpkg.com/@vibe-validate/config@0.15.0/config.schema.json

# Latest (for docs/examples)
$schema: https://unpkg.com/@vibe-validate/config/config.schema.json
```

#### Validate Result Schema
```yaml
# Version-pinned
$schema: https://unpkg.com/@vibe-validate/core@0.15.0/validate-result.schema.json

# Latest
$schema: https://unpkg.com/@vibe-validate/core/validate-result.schema.json
```

#### Run Result Schema
```yaml
# Version-pinned
$schema: https://unpkg.com/@vibe-validate/cli@0.15.0/run-result.schema.json

# Latest
$schema: https://unpkg.com/@vibe-validate/cli/run-result.schema.json
```

#### Watch PR Result Schema
```yaml
# Version-pinned
$schema: https://unpkg.com/@vibe-validate/cli@0.15.0/watch-pr-result.schema.json

# Latest
$schema: https://unpkg.com/@vibe-validate/cli/watch-pr-result.schema.json
```

#### Error Extractor Result Schema
```yaml
# Version-pinned
$schema: https://unpkg.com/@vibe-validate/extractors@0.15.0/error-extractor-result.schema.json

# Latest
$schema: https://unpkg.com/@vibe-validate/extractors/error-extractor-result.schema.json
```

## IDE Integration

### VS Code

VS Code automatically validates YAML files with `$schema` properties:

```yaml
# vibe-validate.config.yaml
$schema: https://unpkg.com/@vibe-validate/config@0.15.0/config.schema.json

validation:
  phases:
    # Type 'phases' and get autocomplete for all properties!
```

**Features:**
- ✅ Autocomplete for all properties
- ✅ Inline validation errors (red squiggles)
- ✅ Hover documentation for fields
- ✅ Type checking for YAML

**Extensions needed:**
- [YAML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) by Red Hat

### JetBrains IDEs (IntelliJ, WebStorm, etc.)

JetBrains IDEs support JSON Schema validation out of the box:

```yaml
$schema: https://unpkg.com/@vibe-validate/config@0.15.0/config.schema.json
```

**Features:**
- ✅ Autocomplete with Ctrl+Space
- ✅ Error highlighting
- ✅ Quick documentation (Ctrl+Q)
- ✅ Schema validation on save

**Configuration:**
- Settings → Languages & Frameworks → Schemas and DTDs → JSON Schema Mappings
- Add pattern `**/vibe-validate.config.yaml` → Schema URL

## How Schemas Are Generated

All vibe-validate schemas are generated from **Zod schemas** using `zod-to-json-schema`:

### Config Schema Generation

```typescript
// packages/config/src/config-schema.ts
export const VibeValidateConfigSchema = z.object({
  git: GitConfigSchema.optional(),
  validation: ValidationConfigSchema,
  // ...
}).strict();

// packages/config/src/scripts/generate-schema.ts
import { zodToJsonSchema } from 'zod-to-json-schema';

const jsonSchema = zodToJsonSchema(VibeValidateConfigSchema, {
  name: 'VibeValidateConfig',
  $refStrategy: 'none', // Inline all definitions
});

fs.writeFileSync('config.schema.json', JSON.stringify(jsonSchema, null, 2));
```

**Build step:**
```json
{
  "scripts": {
    "build": "tsc && node dist/scripts/generate-schema.js"
  }
}
```

### Result Schema Generation

Similar process for all result schemas:

```typescript
// packages/core/src/result-schema.ts
export const ValidationResultSchema = z.object({
  passed: z.boolean(),
  timestamp: z.string(),
  treeHash: z.string(),
  // ...
});

// packages/core/src/scripts/generate-result-schema.ts
const jsonSchema = zodToJsonSchema(ValidationResultSchema, {
  name: 'ValidationResult',
  $refStrategy: 'none',
});
```

### Why Zod → JSON Schema?

**Single Source of Truth:**
- Runtime validation (Zod)
- TypeScript types (via `z.infer<>`)
- JSON Schema (for IDE autocomplete)

**Type Safety:**
```typescript
import { type VibeValidateConfig } from '@vibe-validate/config';
import { validateConfig } from '@vibe-validate/config';

const config: VibeValidateConfig = validateConfig(rawConfig); // Type-safe!
```

**No Manual Sync:**
- Update Zod schema → rebuild → JSON Schema updated automatically
- Tests enforce schema accuracy

## Programmatic Access

### TypeScript Imports

All schemas are available as TypeScript types:

```typescript
// Config type
import { type VibeValidateConfig } from '@vibe-validate/config';

// Result types
import { type ValidationResult } from '@vibe-validate/core';
import { type RunResult } from '@vibe-validate/cli';
import { type WatchPrResult } from '@vibe-validate/cli';
import { type ErrorExtractorResult } from '@vibe-validate/extractors';
```

### Runtime Validation

```typescript
import { validateConfig } from '@vibe-validate/config';

const config = validateConfig(rawYaml); // Throws on invalid
```

### JSON Schema Files

Access JSON Schema files directly from installed packages:

```typescript
import configSchema from '@vibe-validate/config/config.schema.json';
import validateResultSchema from '@vibe-validate/core/validate-result.schema.json';
import runResultSchema from '@vibe-validate/cli/run-result.schema.json';
```

## Versioning Strategy

### Version-Pinned vs Latest

| Use Case | URL Type | Example |
|----------|----------|---------|
| User config files | Version-pinned | `@vibe-validate/config@0.15.0/config.schema.json` |
| CI/CD workflows | Version-pinned | Match installed package version |
| Documentation | Latest | `@vibe-validate/config/config.schema.json` |
| Quick prototyping | Latest | Auto-updates to newest schema |

### Migration Between Versions

When upgrading vibe-validate:

1. **Update package versions:**
   ```bash
   npm install -D vibe-validate@0.15.0
   ```

2. **Update schema URLs** (if using version-pinned):
   ```yaml
   # Old
   $schema: https://unpkg.com/@vibe-validate/config@0.14.0/config.schema.json

   # New
   $schema: https://unpkg.com/@vibe-validate/config@0.15.0/config.schema.json
   ```

3. **Or re-run init** (regenerates with correct version):
   ```bash
   npx vibe-validate init --template typescript-nodejs
   ```

**Note:** If using latest URLs, no migration needed (auto-updates).

## Breaking Changes in v0.15.0

### Schema Renames

| Old Name | New Name | Reason |
|----------|----------|--------|
| `vibe-validate.schema.json` | `config.schema.json` | More descriptive |
| `validation-result.schema.json` | `validate-result.schema.json` | Matches `validate` command |

**Migration:**
```yaml
# Old (v0.14.x)
$schema: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json

# New (v0.15.0+)
$schema: https://unpkg.com/@vibe-validate/config@0.15.0/config.schema.json
```

### URL Changes

**Old (GitHub raw URLs):**
- ❌ Tied to Git branch (breaks when main changes)
- ❌ No version stability
- ❌ Can't match installed package version

**New (npm CDN URLs):**
- ✅ Tied to npm package versions
- ✅ Stable URLs
- ✅ Matches installed package API

## Troubleshooting

### IDE not showing autocomplete

**Problem:** VS Code not providing autocomplete for config file.

**Solution:**
1. Ensure YAML extension installed: [redhat.vscode-yaml](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)
2. Verify `$schema` URL is correct and accessible
3. Reload VS Code window (Cmd+Shift+P → "Reload Window")

### Schema validation errors on valid config

**Problem:** IDE shows errors on valid configuration.

**Solution:**
1. Check schema version matches installed package:
   ```bash
   npm list vibe-validate
   # Update $schema URL to match version
   ```
2. Clear schema cache:
   - VS Code: Delete `~/.vscode/extensions/.schemas/`
   - JetBrains: File → Invalidate Caches → Restart

### unpkg URL not resolving

**Problem:** 404 error on unpkg schema URL.

**Solution:**
1. Verify package is published: https://www.npmjs.com/package/@vibe-validate/config
2. Wait 1-2 minutes after publish (unpkg cache delay)
3. Try forcing unpkg refresh: Add `?cache=false` query param

### Version mismatch between package and schema

**Problem:** IDE autocomplete suggests properties that don't exist in installed version.

**Solution:**
Use version-pinned URL matching your package version:
```bash
npm list @vibe-validate/config
# Shows: @vibe-validate/config@0.15.0

# Update schema URL
$schema: https://unpkg.com/@vibe-validate/config@0.15.0/config.schema.json
```

## See Also

- [Configuration Reference](configuration-reference.md) - Complete config documentation
- [Getting Started](getting-started.md) - Initial setup guide
- [CLI Reference](cli-reference.md) - Command-line options
