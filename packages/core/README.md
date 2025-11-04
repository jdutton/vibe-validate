# @vibe-validate/core

Core validation orchestration engine for vibe-validate.

## Features

- **Parallel Execution**: Run multiple validation steps simultaneously
- **Phase-Based Orchestration**: Define validation phases with dependencies
- **Git Tree Hash Caching**: Skip validation when code unchanged
- **Process Management**: Clean up child processes on interruption
- **LLM-Optimized Output**: Format errors for AI consumption

## Installation

```bash
npm install @vibe-validate/core
```

## Usage

```typescript
import { ValidationRunner } from '@vibe-validate/core';

const runner = new ValidationRunner({
  phases: [
    {
      name: 'Pre-Qualification',
      parallel: true,
      steps: [
        { name: 'TypeCheck', command: 'tsc --noEmit' },
        { name: 'Lint', command: 'eslint src/' },
      ],
    },
  ],
});

const result = await runner.run();
```

## API

See [TypeScript types](./src/index.ts) for complete API documentation.

## JSON Schema

This package publishes `validate-result.schema.json` for IDE autocomplete and validation of validation result files:

```yaml
# Version-pinned (recommended)
$schema: https://unpkg.com/@vibe-validate/core@0.15.0/validate-result.schema.json

# Latest version
$schema: https://unpkg.com/@vibe-validate/core/validate-result.schema.json
```

**Use for:**
- Validation state files stored in git notes
- History records (`vibe-validate history show`)
- Custom validation result processing

**Features:**
- ✅ IDE autocomplete for all ValidationResult properties
- ✅ Inline validation errors
- ✅ Type checking for YAML validation results

See [Schema Documentation](../../docs/schemas.md) for complete details.

## License

MIT © Jeff Dutton
