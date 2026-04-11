# vibe-validate

> Git-aware validation orchestration with 312x faster cached runs

[![npm version](https://img.shields.io/npm/v/vibe-validate.svg)](https://www.npmjs.com/package/vibe-validate)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Umbrella Package

This is a convenience package that installs the **vibe-validate CLI**.

When you install `vibe-validate`, you're actually installing `@vibe-validate/cli` and getting access to the `vibe-validate` command-line tool.

## Quick Install

```bash
npm install -D vibe-validate
```

This installs:
- `@vibe-validate/cli` - The main CLI tool
- All its dependencies (`@vibe-validate/core`, `@vibe-validate/config`, etc.)

## Usage

After installation, use the `vibe-validate` command:

```bash
# Initialize configuration
npx vibe-validate init

# Run validation
npx vibe-validate validate

# Check configuration diagnostics
npx vibe-validate doctor
```

## Full Documentation

For complete documentation, examples, and guides, visit:

**https://github.com/jdutton/vibe-validate**

## Packages

The vibe-validate ecosystem consists of:

- **vibe-validate** (this package) - Umbrella package for easy installation
- **[@vibe-validate/cli](https://www.npmjs.com/package/@vibe-validate/cli)** - Command-line interface
- **[@vibe-validate/core](https://www.npmjs.com/package/@vibe-validate/core)** - Validation orchestration engine
- **[@vibe-validate/config](https://www.npmjs.com/package/@vibe-validate/config)** - Configuration system
- **[@vibe-validate/extractors](https://www.npmjs.com/package/@vibe-validate/extractors)** - Error formatting
- **[@vibe-validate/git](https://www.npmjs.com/package/@vibe-validate/git)** - Git utilities

## Why vibe-validate?

Built for **agentic coding workflows** with AI assistants like [Claude Code](https://claude.ai/code):

- **312x faster cached validation** (288ms vs 90s when code unchanged)
- **Git tree hash caching** - Content-based, deterministic
- **Parallel execution** - Run checks simultaneously
- **Agent-optimized output** - Auto-detects Claude Code, Cursor, Aider, Continue
- **Branch sync enforcement** - Pre-commit hook ensures branches stay current

## License

MIT © Jeff Dutton
