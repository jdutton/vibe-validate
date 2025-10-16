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

## License

MIT © Jeff Dutton
