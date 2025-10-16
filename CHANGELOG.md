# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.1] - 2025-10-16

### 🐛 Fixed

- **@vibe-validate/cli**: Fixed workspace protocol dependencies not being resolved during npm publish
  - Changed `workspace:*` to explicit `^0.9.0` version references for internal packages
  - Fixes installation error: "Unsupported URL Type 'workspace:'"
  - All internal dependencies now correctly point to published npm packages

### 📦 Published Packages

- **@vibe-validate/cli** v0.9.1 - Fixed dependencies (installable from npm)
- All other packages remain at v0.9.0

## [0.9.0] - 2025-10-16 ⚠️ DEPRECATED (use 0.9.1)

### 🎉 Initial Beta Release

This is the first beta release of vibe-validate, a git-aware validation orchestration tool optimized for AI-assisted development (vibe coding).

### 📦 Packages

This release includes 5 npm packages:

- **@vibe-validate/core** (v0.9.0) - Validation orchestration engine
- **@vibe-validate/git** (v0.9.0) - Git tree hash caching and branch management
- **@vibe-validate/config** (v0.9.0) - TypeScript-first configuration system with presets
- **@vibe-validate/formatters** (v0.9.0) - LLM-optimized error formatters
- **@vibe-validate/cli** (v0.9.0) - Command-line interface

### ✨ Features

#### Core Validation Engine (@vibe-validate/core)
- **Parallel validation phases** - Run independent validation steps simultaneously
- **Fail-fast mode** - Stop on first failure or run all steps
- **Git tree hash caching** - 312x speedup on unchanged code (288ms vs 90s)
- **Process cleanup** - Automatic cleanup of orphaned test processes
- **Signal handling** - Graceful shutdown on SIGINT/SIGTERM
- **Language-agnostic** - Works with any command (npm, cargo, go, python, etc.)

#### Git Integration (@vibe-validate/git)
- **Deterministic tree hashing** - Content-based hashing (no timestamps)
- **Branch sync checking** - Detect if branch is behind origin/main
- **Post-merge cleanup** - Automatic cleanup of merged branches
- **Safe by default** - Never auto-merges, always requires manual approval

#### Configuration System (@vibe-validate/config)
- **TypeScript-first design** - Full type safety with Zod validation
- **Framework presets** - typescript-library, typescript-nodejs, typescript-react
- **Preset extension** - Customize presets via mergeConfig()
- **Config auto-discovery** - Supports 6 file patterns (.ts, .mjs, .js, .json, .yaml, .yml)
- **Multiple output formats** - human, yaml, json, auto

#### Error Formatters (@vibe-validate/formatters)
- **LLM-optimized output** - Agent-friendly error reporting
- **Smart auto-detection** - Detects tool from step name
- **Tool-specific parsers** - TypeScript, ESLint, Vitest/Jest, OpenAPI
- **ANSI stripping** - Clean error output for structured consumption
- **Generic fallback** - Handles unknown tools gracefully

#### Command-Line Interface (@vibe-validate/cli)
- **7 commands** - init, validate, pre-commit, state, sync-check, cleanup, config
- **Agent detection** - Auto-adapts output for Claude Code, Cursor, Aider, Continue
- **Interactive setup** - Guided configuration with preset selection
- **Multiple output formats** - Colorful human output or structured YAML/JSON
- **Pre-commit workflow** - Branch sync + cached validation

### 🚀 Performance

- **312x speedup** with git tree hash caching (validated on real projects)
- **Parallel phase execution** - Run independent steps simultaneously
- **Incremental validation** - Only re-validate when code changes
- **Sub-second cache hits** - 288ms for cached validation state

### 📊 Test Coverage

- **243 tests** across 5 packages
- **92.6% overall coverage** (exceeds 80% target)
- **Self-hosting** - vibe-validate validates itself
- **Real-world validation** - Successfully tested on mcp-typescript-simple project

### 📚 Documentation

- **Comprehensive README.md** - Installation, usage, examples
- **CLI Reference** (docs/cli-reference.md) - All commands documented
- **Configuration Reference** (docs/configuration-reference.md) - Complete config API
- **Getting Started Guide** (docs/getting-started.md) - Quick setup walkthrough
- **Presets Guide** (docs/presets-guide.md) - Framework preset usage
- **Error Formatters Guide** (docs/error-formatters-guide.md) - Formatter customization
- **Agent Integration Guide** (docs/agent-integration-guide.md) - AI assistant integration
- **CONTRIBUTING.md** - Contributor guide with local development setup
- **Local Development Guide** (docs/local-development.md) - Multi-mode development workflow

### 🎯 Design Decisions

- **Git tree hash determinism** - Uses `git write-tree` for content-based hashing
- **Language-agnostic design** - Core engine executes ANY commands
- **Agent-first output** - Optimized for AI assistant consumption
- **YAML state format** - Human and agent-readable validation state
- **Safety-first** - Never auto-merges branches, always requires manual action

### 🔧 Technical Highlights

- **Node.js 20+ required** - Modern JavaScript features
- **pnpm workspace** - Monorepo with 5 packages
- **TypeScript-native** - Full type safety throughout
- **ESM-only** - Modern ES modules
- **Vitest testing** - Fast, TypeScript-native test runner
- **Zero-tolerance ESLint** - 0 errors, 0 warnings

### 🎓 Use Cases

- **Pre-commit validation** - Prevent committing broken code
- **CI/CD pipelines** - Fast validation with state caching
- **AI-assisted development** - Agent-friendly error output
- **Team workflows** - Consistent validation across team members
- **Monorepo validation** - Parallel validation of multiple packages

### 🤖 AI Assistant Support

- **Claude Code** - Official support with agent context detection
- **Cursor** - Integrated workflow support
- **Aider** - Compatible output formatting
- **Continue** - Agent-friendly error reporting

### ⚠️ Known Limitations (v0.9)

- **No remote caching** - Only local git tree hash caching (v2.0 planned)
- **CLI command tests incomplete** - Utils tested (90% coverage), commands deferred
- **No examples directory** - Will be added in v1.0
- **No documentation website** - Currently using GitHub (static site planned)

### 🔮 What's Next (v1.0.0)

- **API freeze** - Stable API with semantic versioning guarantees
- **Additional testing** - 2-3 more real-world project validations
- **Bug fixes** - Address any issues discovered in v0.9 beta
- **Documentation refinements** - Based on early adopter feedback
- **Example projects** - Reference implementations for common use cases

### 📝 Migration Notes

This is the first public release. No migration required.

### 🙏 Acknowledgments

- Extracted from mcp-typescript-simple validation tooling
- Built for AI-assisted development (vibe coding)
- Designed with feedback from Claude Code integration testing

---

## Version History

- **v0.9.0** (2025-10-16) - Initial beta release
- **v1.0.0** (TBD) - Stable release with API freeze

[Unreleased]: https://github.com/jdutton/vibe-validate/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/jdutton/vibe-validate/releases/tag/v0.9.0
