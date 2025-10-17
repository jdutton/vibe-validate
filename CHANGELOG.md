# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.6] - 2025-10-17

### ✨ Added

- **@vibe-validate/cli**: New `doctor` command for diagnosing setup issues
  - **7 comprehensive health checks**: Node.js version, Git installation, Git repository, configuration file, configuration validity, package manager availability, GitHub Actions workflow sync
  - **Actionable suggestions** - Each failing check includes a specific suggestion for fixing the issue
  - **Smart output modes**:
    - `--verbose` flag: Shows all checks including passing ones (useful for debugging and verifying setup)
    - Normal mode: Shows only failing checks when issues exist, or summary when all pass
    - `--json` flag: Machine-readable output for programmatic use
  - **Progressive disclosure**: Hints users to use `--verbose` to see full details
  - **Exit codes**: Returns 0 if all checks pass, 1 if any fail (CI-friendly)
  - Example usage:
    - `npx vibe-validate doctor` - Quick health check (shows only problems)
    - `npx vibe-validate doctor --verbose` - Show all checks
    - `npx vibe-validate doctor --json` - JSON output for automation

### 🐛 Fixed

- **@vibe-validate/cli**: Improved `generate-workflow` command stability and determinism
  - **Removed timestamp from workflow header** - Eliminates unnecessary workflow regeneration
  - **Improved package manager detection** - Now checks `package.json` `packageManager` field first (official spec)
  - **Conservative npm default** - Prefers npm when both lockfiles exist (more conservative)
  - **Priority-based detection**: packageManager field → single lockfile → npm default
  - Fixes issue where projects with both lockfiles incorrectly detected as pnpm

### 🧪 Testing

- **Enforced Test-Driven Development (TDD)** - All features and bug fixes now require TDD
  - Updated CLAUDE.md with mandatory TDD requirements
  - Added 14 comprehensive tests for doctor command (including verbose flag scenarios)
  - Added 8 regression tests for generate-workflow improvements
  - 356 tests total (353 passing, 99.2% pass rate)

### 📚 Documentation

- Updated CLAUDE.md to enforce TDD for all future development
- Removed V1.0 caveats - TDD is now mandatory from v0.9.6 onwards
- Added doctor command documentation with usage examples

## [0.9.5] - 2025-10-17

### ✨ Added

- **@vibe-validate/cli**: New `generate-workflow` command for GitHub Actions workflow generation
  - Generates `.github/workflows/validate.yml` from `vibe-validate.config.mjs`
  - Auto-detects Node.js version from `package.json` engines field
  - Supports matrix strategies (multi-OS, multi-Node versions) via CLI flags
  - Non-matrix mode by default for single Node version (individual jobs per step)
  - Matrix mode automatically enabled when multiple versions/OSes specified
  - CLI flags: `--node-versions`, `--os`, `--fail-fast`, `--coverage`, `--dry-run`, `--check`
  - Ensures perfect sync between local validation and CI validation
  - Includes validation state artifact upload on failure
  - Package manager auto-detection (npm/pnpm)

### 📚 Documentation

- Updated README.md with comprehensive `generate-workflow` command documentation
- Updated CLI README with detailed examples and options
- Updated CLAUDE.md to reflect current development status
- Updated PUBLISHING.md with version information

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
- **v0.9.1** (2025-10-16) - Fixed workspace dependencies
- **v0.9.5** (2025-10-17) - Added generate-workflow command
- **v0.9.6** (2025-10-17) - Fixed generate-workflow stability and enforced TDD
- **v1.0.0** (TBD) - Stable release with API freeze

[Unreleased]: https://github.com/jdutton/vibe-validate/compare/v0.9.6...HEAD
[0.9.6]: https://github.com/jdutton/vibe-validate/releases/tag/v0.9.6
[0.9.5]: https://github.com/jdutton/vibe-validate/releases/tag/v0.9.5
[0.9.1]: https://github.com/jdutton/vibe-validate/releases/tag/v0.9.1
[0.9.0]: https://github.com/jdutton/vibe-validate/releases/tag/v0.9.0
