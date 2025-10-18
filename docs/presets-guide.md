# Presets Guide

Learn how to use and customize vibe-validate framework presets for optimal configuration.

## Table of Contents

- [What are Presets?](#what-are-presets)
- [Available Presets](#available-presets)
- [Using Presets](#using-presets)
- [Customizing Presets](#customizing-presets)
- [Creating Custom Presets](#creating-custom-presets)
- [Preset Best Practices](#preset-best-practices)

## What are Presets?

Presets are pre-configured validation setups optimized for specific frameworks and project types. They provide:

- **Sensible defaults** - Pre-configured validation phases and steps
- **Performance optimization** - Parallel execution where possible
- **Fail-fast ordering** - Fast checks run first
- **Framework-specific tools** - TypeScript, ESLint, test runners, etc.
- **Easy customization** - Override individual settings as needed

**Benefits:**
- ⚡ **Fast setup** - Get started in seconds
- 🎯 **Best practices** - Based on real-world usage patterns
- 🔧 **Customizable** - Override anything you need
- 📚 **Documented** - Clear examples and explanations

## Available Presets

vibe-validate includes three official presets:

### `typescript-library`

**Optimized for:** TypeScript libraries and npm packages

**Validation phases:**
1. **Pre-Qualification** (parallel):
   - TypeScript compilation (`tsc --noEmit`)
   - ESLint code checking (`eslint .`)
2. **Build & Test**:
   - Unit tests (`npm test`)
   - Build library (`npm run build`)

**Best for:**
- npm packages
- Shared libraries
- Reusable components
- TypeScript projects without specific framework

**Default settings:**
```typescript
{
  validation: {
    phases: [
      {
        name: 'Pre-Qualification',
        parallel: true,
        steps: [
          { name: 'TypeScript', command: 'tsc --noEmit' },
          { name: 'ESLint', command: 'eslint .' },
        ],
      },
      {
        name: 'Build & Test',
        parallel: false,
        steps: [
          { name: 'Unit Tests', command: 'npm test' },
          { name: 'Build', command: 'npm run build' },
        ],
      },
    ],
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },
  },
  git: {
    mainBranch: 'main',
    autoSync: false,
  },
  output: {
    format: 'auto',
  },
}
```

---

### `typescript-nodejs`

**Optimized for:** Node.js applications and backend services

**Validation phases:**
1. **Pre-Qualification** (parallel):
   - TypeScript compilation (`tsc --noEmit`)
   - ESLint code checking (`eslint src/`)
2. **Testing** (parallel):
   - Unit tests (`npm run test:unit`)
   - Integration tests (`npm run test:integration`)
3. **Build**:
   - Build application (`npm run build`)

**Best for:**
- Node.js REST APIs
- Express/Fastify applications
- Backend microservices
- CLI tools
- Serverless functions

**Default settings:**
```typescript
{
  validation: {
    phases: [
      {
        name: 'Pre-Qualification',
        parallel: true,
        steps: [
          { name: 'TypeScript', command: 'tsc --noEmit' },
          { name: 'ESLint', command: 'eslint src/' },
        ],
      },
      {
        name: 'Testing',
        parallel: true,
        steps: [
          { name: 'Unit Tests', command: 'npm run test:unit' },
          { name: 'Integration Tests', command: 'npm run test:integration' },
        ],
      },
      {
        name: 'Build',
        parallel: false,
        steps: [
          { name: 'Build', command: 'npm run build' },
        ],
      },
    ],
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },
  },
  git: {
    mainBranch: 'main',
    autoSync: false,
  },
  output: {
    format: 'auto',
  },
}
```

---

### `typescript-react`

**Optimized for:** React applications and frontends

**Validation phases:**
1. **Pre-Qualification** (parallel):
   - TypeScript compilation (`tsc --noEmit`)
   - ESLint code checking (`eslint src/`)
2. **Testing** (parallel):
   - Unit tests (`npm run test:unit`)
   - Component tests (`npm run test:component`)
3. **Build**:
   - Build application (`npm run build`)

**Best for:**
- React SPAs
- Next.js applications
- React Native apps
- Frontend applications with build step

**Default settings:**
```typescript
{
  validation: {
    phases: [
      {
        name: 'Pre-Qualification',
        parallel: true,
        steps: [
          { name: 'TypeScript', command: 'tsc --noEmit' },
          { name: 'ESLint', command: 'eslint src/' },
        ],
      },
      {
        name: 'Testing',
        parallel: true,
        steps: [
          { name: 'Unit Tests', command: 'npm run test:unit' },
          { name: 'Component Tests', command: 'npm run test:component' },
        ],
      },
      {
        name: 'Build',
        parallel: false,
        steps: [
          { name: 'Build', command: 'npm run build' },
        ],
      },
    ],
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },
  },
  git: {
    mainBranch: 'main',
    autoSync: false,
  },
  output: {
    format: 'auto',
  },
}
```

---

## Using Presets

### Quick Start

Use the `init` command to select a preset interactively:

```bash
vibe-validate init
```

Output:
```
? Select a preset: (Use arrow keys)
  ❯ typescript-library (Default TypeScript library)
    typescript-nodejs (Node.js application)
    typescript-react (React application)
    custom (Start from scratch)
```

### Manual Configuration

Create `vibe-validate.config.ts` with your chosen preset:

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  preset: 'typescript-nodejs',
});
```

That's it! The preset provides all necessary configuration.

### Verify Configuration

Check that your preset loaded correctly:

```bash
vibe-validate config
```

Output:
```
⚙️  Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Config file: vibe-validate.config.ts
Preset:      typescript-nodejs

Validation Phases (3):
  Phase 1: Pre-Qualification (parallel)
    - TypeScript: tsc --noEmit
    - ESLint: eslint src/
  ...
```

---

## Customizing Presets

Presets provide defaults, but you can override anything you need.

### Override Individual Steps

**Example**: Change ESLint command to check specific directories:

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  preset: 'typescript-nodejs',
  validation: {
    phases: [
      {
        name: 'Pre-Qualification',
        parallel: true,
        steps: [
          { name: 'TypeScript', command: 'tsc --noEmit' },
          { name: 'ESLint', command: 'eslint src/ test/' }, // ← customized
        ],
      },
    ],
  },
});
```

### Add Additional Steps

**Example**: Add OpenAPI validation to preset:

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  preset: 'typescript-nodejs',
  validation: {
    phases: [
      {
        name: 'Pre-Qualification',
        parallel: true,
        steps: [
          { name: 'TypeScript', command: 'tsc --noEmit' },
          { name: 'ESLint', command: 'eslint src/' },
          { name: 'OpenAPI', command: 'npm run docs:validate' }, // ← added
        ],
      },
    ],
  },
});
```

### Add New Phases

**Example**: Add end-to-end tests phase:

```typescript
import { defineConfig, mergeConfig } from '@vibe-validate/config';
import { presets } from '@vibe-validate/config';

const baseConfig = presets['typescript-react'];

export default defineConfig(
  mergeConfig(baseConfig, {
    validation: {
      phases: [
        // Keep existing phases from preset
        ...baseConfig.validation.phases,
        // Add new phase
        {
          name: 'E2E Tests',
          parallel: false,
          steps: [
            { name: 'Playwright', command: 'npm run test:e2e' },
          ],
        },
      ],
    },
  })
);
```

### Override Caching Strategy

**Example**: Disable caching for debugging:

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  preset: 'typescript-nodejs',
  validation: {
    caching: {
      enabled: false, // ← disable caching
    },
  },
});
```

### Change Git Settings

**Example**: Use 'master' as main branch:

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  preset: 'typescript-nodejs',
  git: {
    mainBranch: 'master', // ← changed from 'main'
  },
});
```

### Change Output Format

**Example**: Force YAML output for CI/CD:

```typescript
import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  preset: 'typescript-nodejs',
  output: {
    format: 'yaml', // ← always use YAML
  },
});
```

---

## Creating Custom Presets

You can create your own reusable presets for sharing across projects.

### Step 1: Define Your Preset

Create `my-preset.ts`:

```typescript
import { type ValidationConfig } from '@vibe-validate/config';

export const myPreset: ValidationConfig = {
  validation: {
    phases: [
      {
        name: 'Code Quality',
        parallel: true,
        steps: [
          { name: 'TypeScript', command: 'tsc --noEmit' },
          { name: 'ESLint', command: 'eslint .' },
          { name: 'Prettier', command: 'prettier --check .' },
        ],
      },
      {
        name: 'Security',
        parallel: false,
        steps: [
          { name: 'Audit', command: 'npm audit --production' },
          { name: 'License Check', command: 'npm run license-check' },
        ],
      },
      {
        name: 'Testing',
        parallel: true,
        steps: [
          { name: 'Unit Tests', command: 'npm run test:unit' },
          { name: 'Integration Tests', command: 'npm run test:integration' },
        ],
      },
      {
        name: 'Build',
        parallel: false,
        steps: [
          { name: 'Build', command: 'npm run build' },
          { name: 'Type Declarations', command: 'tsc --emitDeclarationOnly' },
        ],
      },
    ],
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },
  },
  git: {
    mainBranch: 'main',
    autoSync: false,
  },
  output: {
    format: 'auto',
  },
};
```

### Step 2: Use Your Custom Preset

**Option A: Import directly**
```typescript
// vibe-validate.config.ts
import { defineConfig } from '@vibe-validate/config';
import { myPreset } from './my-preset';

export default defineConfig(myPreset);
```

**Option B: Share as npm package**
```typescript
// 1. Publish preset as @mycompany/vibe-validate-preset
// 2. Install: npm install -D @mycompany/vibe-validate-preset

// vibe-validate.config.ts
import { defineConfig } from '@vibe-validate/config';
import { myPreset } from '@mycompany/vibe-validate-preset';

export default defineConfig(myPreset);
```

### Step 3: Allow Customization

Make your preset customizable with options:

```typescript
// my-preset.ts
import { type ValidationConfig } from '@vibe-validate/config';

export interface MyPresetOptions {
  includeSecurity?: boolean;
  includeE2E?: boolean;
  mainBranch?: string;
}

export function myPreset(options: MyPresetOptions = {}): ValidationConfig {
  const {
    includeSecurity = true,
    includeE2E = false,
    mainBranch = 'main',
  } = options;

  const phases: ValidationConfig['validation']['phases'] = [
    {
      name: 'Code Quality',
      parallel: true,
      steps: [
        { name: 'TypeScript', command: 'tsc --noEmit' },
        { name: 'ESLint', command: 'eslint .' },
      ],
    },
  ];

  if (includeSecurity) {
    phases.push({
      name: 'Security',
      parallel: false,
      steps: [
        { name: 'Audit', command: 'npm audit --production' },
      ],
    });
  }

  if (includeE2E) {
    phases.push({
      name: 'E2E Tests',
      parallel: false,
      steps: [
        { name: 'Playwright', command: 'npm run test:e2e' },
      ],
    });
  }

  return {
    validation: {
      phases,
      caching: {
        strategy: 'git-tree-hash',
        enabled: true,
      },
    },
    git: {
      mainBranch,
      autoSync: false,
    },
    output: {
      format: 'auto',
    },
  };
}
```

**Usage:**
```typescript
// vibe-validate.config.ts
import { defineConfig } from '@vibe-validate/config';
import { myPreset } from './my-preset';

export default defineConfig(
  myPreset({
    includeSecurity: true,
    includeE2E: true,
    mainBranch: 'develop',
  })
);
```

---

## Preset Best Practices

### 1. Start with a Preset

Always start with an official preset if one matches your project type. Presets provide:
- Optimized phase ordering
- Parallel execution where safe
- Framework-specific tool configuration
- Battle-tested defaults

### 2. Override Minimally

Only override what you need. The more you customize, the less benefit you get from preset updates.

**Good:**
```typescript
export default defineConfig({
  preset: 'typescript-nodejs',
  git: {
    mainBranch: 'develop', // Only override what's different
  },
});
```

**Less Good:**
```typescript
export default defineConfig({
  validation: {
    phases: [
      // Copying entire preset config loses preset benefits
      { ... },
    ],
  },
});
```

### 3. Use `mergeConfig` for Complex Overrides

When adding to preset configuration, use `mergeConfig`:

```typescript
import { defineConfig, mergeConfig } from '@vibe-validate/config';
import { presets } from '@vibe-validate/config';

const baseConfig = presets['typescript-nodejs'];

export default defineConfig(
  mergeConfig(baseConfig, {
    validation: {
      phases: [
        ...baseConfig.validation.phases,
        // Add custom phase
        { name: 'Custom', steps: [...] },
      ],
    },
  })
);
```

### 4. Document Custom Presets

If creating a custom preset, document:
- **Purpose**: What project types is it for?
- **Phases**: What validation phases does it include?
- **Requirements**: What scripts must exist in package.json?
- **Options**: What customization options are available?

**Example:**
```typescript
/**
 * Full-Stack TypeScript Preset
 *
 * Optimized for: Full-stack TypeScript applications with frontend + backend
 *
 * Phases:
 *  1. Pre-Qualification (parallel): TypeScript, ESLint
 *  2. Backend Tests (parallel): Unit, Integration, E2E
 *  3. Frontend Tests (parallel): Unit, Component, E2E
 *  4. Build: Backend + Frontend
 *
 * Required package.json scripts:
 *  - test:unit
 *  - test:integration
 *  - test:e2e
 *  - test:component
 *  - build
 *
 * Options:
 *  - skipE2E: boolean - Skip end-to-end tests (default: false)
 *  - mainBranch: string - Git main branch (default: 'main')
 */
export function fullStackPreset(options: FullStackOptions = {}) {
  // ...
}
```

### 5. Test Your Preset

Always test your preset configuration:

```bash
# Validate configuration
vibe-validate config --validate

# Run full validation
vibe-validate validate --force

# Check performance
time vibe-validate validate
```

### 6. Share Presets Within Teams

Publish team presets as internal npm packages:

```json
{
  "name": "@mycompany/vibe-validate-preset",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "@vibe-validate/config": "^1.0.0"
  }
}
```

Team members can then use:
```typescript
import { defineConfig } from '@vibe-validate/config';
import { myCompanyPreset } from '@mycompany/vibe-validate-preset';

export default defineConfig(myCompanyPreset);
```

---

## Preset Migration Guide

### Upgrading from Custom Config to Preset

**Before (custom config):**
```typescript
export default defineConfig({
  validation: {
    phases: [
      {
        name: 'Checks',
        parallel: true,
        steps: [
          { name: 'TypeScript', command: 'tsc --noEmit' },
          { name: 'ESLint', command: 'eslint src/' },
        ],
      },
      {
        name: 'Tests',
        steps: [
          { name: 'Unit Tests', command: 'npm test' },
        ],
      },
      {
        name: 'Build',
        steps: [
          { name: 'Build', command: 'npm run build' },
        ],
      },
    ],
  },
});
```

**After (using preset):**
```typescript
export default defineConfig({
  preset: 'typescript-nodejs', // ← Much simpler!
});
```

**Benefits:**
- ✅ Less code to maintain
- ✅ Automatic updates when preset improves
- ✅ Consistent with team practices
- ✅ Better performance (preset is optimized)

---

## Troubleshooting

### "Unknown preset: my-preset"

**Cause**: Preset name doesn't match available presets.

**Solution**: Use one of the official presets:
- `typescript-library`
- `typescript-nodejs`
- `typescript-react`

Or import a custom preset directly:
```typescript
import { myPreset } from './my-preset';
export default defineConfig(myPreset);
```

### "Required script not found: test:unit"

**Cause**: Preset expects npm scripts that don't exist.

**Solution**: Add missing scripts to `package.json`:
```json
{
  "scripts": {
    "test:unit": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  }
}
```

Or customize the preset to use your existing scripts:
```typescript
export default defineConfig({
  preset: 'typescript-nodejs',
  validation: {
    phases: [
      {
        name: 'Testing',
        steps: [
          { name: 'Tests', command: 'npm test' }, // ← Use your script
        ],
      },
    ],
  },
});
```

### "Validation is slow"

**Cause**: Preset may not be optimized for your project.

**Solution**: Enable parallel execution where possible:
```typescript
export default defineConfig({
  preset: 'typescript-nodejs',
  validation: {
    phases: [
      {
        name: 'Pre-Qualification',
        parallel: true, // ← Enable parallel execution
        steps: [
          { name: 'TypeScript', command: 'tsc --noEmit' },
          { name: 'ESLint', command: 'eslint src/' },
        ],
      },
    ],
  },
});
```

---

## Related Documentation

- [Getting Started Guide](./getting-started.md)
- [Configuration Reference](./configuration-reference.md)
- [CLI Reference](./cli-reference.md)
- [Error Formatters Guide](./error-formatters-guide.md)
- [Agent Integration Guide](./agent-integration-guide.md)

---

## See Also

- [vibe-validate GitHub Repository](https://github.com/yourusername/vibe-validate)
- [npm Package](https://www.npmjs.com/package/@vibe-validate/cli)
- [Configuration Schema](https://github.com/yourusername/vibe-validate/blob/main/packages/config/src/schema.ts)
