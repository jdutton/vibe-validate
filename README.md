# vibe-validate

**Git-aware validation orchestration for vibe coding** (LLM-assisted development)

## What is this?

`vibe-validate` is a validation orchestration tool designed for developers using AI assistants like Claude Code, Cursor, Aider, and Continue. It caches validation state using git tree hashes, runs steps in parallel, and formats errors for LLM consumption.

## Key Features

- ✅ **Git tree hash caching** - Skip validation when code unchanged
- ✅ **LLM-optimized output** - Strip noise, extract actionable errors
- ✅ **Agent context detection** - Adapts output for Claude Code, Cursor, etc.
- ✅ **Parallel execution** - Run multiple validation steps simultaneously
- ✅ **Language-agnostic** - Works with any commands (TypeScript/JavaScript presets included)
- ✅ **Pre-commit workflow** - Branch sync + validation + cleanup

## Quick Start

```bash
# Install
npm install -D @vibe-validate/cli

# Initialize configuration
npx vibe-validate init --preset=typescript-library

# Run validation
npx vibe-validate validate

# Pre-commit checks
npx vibe-validate pre-commit
```

## Packages

This is a monorepo containing:

- **[@vibe-validate/core](packages/core)** - Validation orchestration engine
- **[@vibe-validate/git](packages/git)** - Git workflow utilities
- **[@vibe-validate/formatters](packages/formatters)** - Error parsing & LLM optimization
- **[@vibe-validate/config](packages/config)** - Configuration system with presets
- **[@vibe-validate/cli](packages/cli)** - Command-line interface

## Requirements

- Node.js 20+
- pnpm 9+
- Git

## Documentation

See the [docs](docs/) directory for comprehensive documentation.

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Development mode
pnpm dev
```

## License

MIT © Jeff Dutton
