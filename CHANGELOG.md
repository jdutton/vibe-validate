# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.4] - 2025-10-19

### 🐛 Bug Fixes

- **CRITICAL: Fixed `doctor` command check display logic**
  - **Non-verbose mode with all checks passing**: Now shows summary only (was showing all 15 checks)
  - **Verbose mode with failures**: Now shows all 15 checks including passing ones (was showing only failing checks)
  - Fixed `--verbose` flag not working due to Commander.js option conflict
  - Message now correctly says "(Use --verbose to see all checks)" when checks are hidden

- **Shows specific validation errors when config is invalid**
  - Doctor now displays actual Zod validation errors (e.g., "validation.phases.0.name: Required")
  - Added `loadConfigWithErrors()` function to extract detailed error messages
  - Shows up to 5 validation errors in doctor output
  - Includes helpful links to documentation, JSON Schema, and examples

- **Fixed false `.mjs` deprecation warning**
  - Warning now only appears when `.mjs` file actually exists
  - Fixes confusing output during initial setup when YAML config is incomplete

### ✅ Testing

- **5 New Tests Added**
  - Test for non-verbose mode showing summary only when all pass
  - Test for non-verbose mode showing only failing checks
  - Test for verbose mode showing all checks when failures exist
  - Integration test verifying CLI `--verbose` flag parsing
  - Integration test verifying check filtering in all scenarios
  - Total tests: **492 passing** (up from 487)

## [0.10.3] - 2025-10-19

### ✨ Features

- **Comprehensive LLM-Friendly Help Output** (Issue #14, Issue #16)
  - Enhanced `--help --verbose` with complete CLI reference in single output
  - **Exit codes** documented for all commands (what each code means)
  - **"What it does"** explanations (step-by-step command behavior)
  - **File locations** (what gets created/modified by each command)
  - **Examples** for every command (real-world usage)
  - **Error recovery guidance** (what to do when commands fail)
  - **"When to use"** guidance (appropriate contexts for each command)
  - **Common workflows** section (first-time setup, before commits, after PR merge)
  - **Caching explanation** (how validation caching works)
  - **FILES section** (all files used by vibe-validate)
  - **EXIT CODES section** (global exit code meanings)
  - Output grew from 76 to 298 lines - 4x more comprehensive

### ✅ Testing

- **13 New Comprehensive Help Tests** (Issue #14)
  - Validates all sections present (exit codes, examples, workflows, etc.)
  - Ensures help is significantly longer than regular help (3x minimum)
  - Verifies all commands documented with examples
  - Total tests: 484 passing (up from 471)

### 📝 Documentation

- **Created Issue #16** for next iteration:
  - DRY exit codes (single source of truth)
  - Auto-generate `docs/cli-reference.md` from `--help --verbose`
  - Test to enforce documentation sync
  - Improves SEO and LLM training data discoverability

## [0.10.2] - 2025-10-19

### ✨ Features

- **AI Assistant Support: Get All Help at Once** (Issue #14)
  - Use `vibe-validate --help --verbose` to see all command options in one output
  - Perfect for AI assistants (Claude Code, Cursor, Aider, Continue) to get complete CLI reference
  - Regular `--help` remains concise for human users
  - Eliminates need to run 9 separate `<command> --help` calls

### 🐛 Bug Fixes

- **Fixed IDE Autocomplete in Documentation** (Issue #14)
  - Corrected schema URL in README examples: Now uses `vibe-validate.schema.json` (was: `schema.json`)
  - Users following documentation will now get proper IDE autocomplete and validation

### 📝 Documentation

- **Added Package Installation Clarity** (Issue #14)
  - New FAQ: "Should I install `vibe-validate` or `@vibe-validate/cli`?"
  - Both packages work identically - use whichever name you prefer
  - Eliminates confusion from seeing two different package names

- **Improved AI Assistant Guidance**
  - Added prominent "For AI Assistants" callout in README
  - Documents `--help --verbose` for comprehensive help output

- **Cleaned Up Format References**
  - Focused documentation on YAML configuration (the current standard)
  - Removed outdated format references from user-facing docs
  - Simplified troubleshooting and getting-started guides

## [0.10.1] - 2025-10-19

### 🐛 Bug Fixes

- **CRITICAL: Fixed broken `init` command** (Issue #12)
  - **Problem**: `vibe-validate init` was creating `.ts` config files that couldn't be loaded, breaking the initialization workflow for new users in v0.10.0
  - **Solution**: Now correctly generates `vibe-validate.config.yaml` files
  - **Impact**: New users can now successfully initialize and use vibe-validate

- **Fixed IDE autocomplete for YAML configs**
  - Corrected JSON Schema URL in generated configs
  - IDEs (VS Code, WebStorm, etc.) now properly provide autocomplete and validation

### 📝 Documentation

- Updated all examples to use YAML configuration format
- Added migration guide for users with legacy `.mjs` configs: `npx vibe-validate init --migrate`
- Clarified that YAML is the only supported format (`.ts`, `.js`, `.json` are not supported)

## [0.10.0] - 2025-10-19

### 🎉 Major Features

- **YAML Configuration Support** (Issue #6)
  - Primary format: `vibe-validate.config.yaml` (modern, maintainable)
  - JSON Schema generation for IDE validation and autocomplete
  - Legacy `.mjs` support with deprecation warnings
  - Migration command: `vibe-validate init --migrate` to convert .mjs → YAML
  - Better IDE support, more readable, industry-standard format

- **Focused Init Modes - Idempotent Setup Operations** (Issue #6)
  - `init --setup-hooks`: Install pre-commit hook only
  - `init --setup-workflow`: Create GitHub Actions workflow only
  - `init --fix-gitignore`: Add state file to .gitignore only
  - `init --migrate`: Convert .mjs config to YAML format
  - `init --dry-run`: Preview changes without writing files
  - All operations are idempotent (safe to run multiple times)
  - 50+ comprehensive tests for setup operations

- **Enhanced Doctor Diagnostics** (Issue #6)
  - Version check with upgrade guidance
  - .gitignore validation for state file
  - Config format migration warnings with actionable steps
  - Educational suggestions (manual instructions + CLI commands)
  - Performance optimization: Load config once (reduced duplicate warnings 7→1)

- **Setup Engine Architecture** (Issue #6)
  - New `SetupCheck` interface for standardized operations
  - Reusable check/preview/fix pattern
  - Idempotent operations with preview mode
  - Comprehensive test coverage (50 tests)

### 🐛 Bug Fixes

- **Fixed ESLint Errors** (Issue #6)
  - Prefixed unused interface parameters with underscore
  - Removed unused imports
  - Clean lint: 0 errors, 0 warnings

- **Replaced TypeScript `any` Types** (Issue #6)
  - Created `InitOptions` interface for init command options
  - Created `SetupOperation` interface for setup operations
  - Added comprehensive JSDoc to all functions
  - Full type safety restored

- **Fixed npm Warnings** (Issue #10)
  - Separated pnpm-specific configs to `.pnpmrc`
  - Cleaned up `.npmrc` for npm-only settings
  - No more `@pnpm/types` warnings during npm operations

- **Reduced Duplicate .mjs Warnings in Doctor Command**
  - Refactored `runDoctor()` to load config once
  - Reduced duplicate deprecation warnings from 7 to 1
  - Updated 7 function signatures to accept config parameter
  - Better performance and cleaner output

### 🔧 Changed

- **Duration Format Improvement**
  - Changed validation state file from milliseconds to seconds
  - Field renamed: `duration` → `durationSecs` (camelCase)
  - More human-readable output (e.g., `1.1` instead of `1100`)

### ♻️ Refactoring

- **Git Detection (DRY)** (Issue #6)
  - Extracted shared `git-detection.ts` module
  - Removed 82 lines of duplication from `init.ts`
  - 11 comprehensive tests for git detection
  - Reusable across commands

### 📝 Documentation

- **CLI Reference Updates** (Issue #6)
  - Complete `init` command documentation
  - Doctor command usage guide
  - All focused modes with examples
  - Migration workflow guide

### ✅ Testing

- **Test-Driven Development (TDD)**
  - All features written with TDD approach
  - 460/460 tests passing (100% pass rate)
  - 17 new test files added
  - Coverage maintained at 80%+

### 🎯 Migration Demonstration

- **Dogfooding**: This project itself migrated from .mjs to YAML
  - Demonstrates the `init --migrate` workflow
  - Doctor now shows 15/15 checks passing (was 14/15)
  - No deprecation warnings

## [0.9.11] - 2025-10-18

### 🐛 Bug Fixes

- **CRITICAL: Fix tree hash consistency between validate and validate --check** (Issue #8)
  - Replaced non-deterministic `getWorkingTreeHash()` (using `git stash create` with timestamps) with deterministic `getGitTreeHash()` (using `git write-tree`, content-based only)
  - **CRITICAL FIX**: Use temporary GIT_INDEX_FILE to prevent corrupting git index during pre-commit hooks
  - Added `@vibe-validate/git` as dependency to `@vibe-validate/core` package
  - Ensures `validate` and `validate --check` calculate identical tree hashes for unchanged working tree
  - Fixes broken caching mechanism that defeated the 312x speedup feature
  - `--check` flag now accurately detects when validation is needed vs already passed
  - Added TDD test to verify deterministic hash calculation (Issue #8)
  - Removed deprecated non-deterministic `getWorkingTreeHash()` function from core package
  - Pre-commit hook now works correctly without corrupting staged files

### 📝 Documentation

- **Improved README clarity** (Issue #1)
  - Quick Start section: Clarified that `validate` is an ongoing command (run before every commit), not one-time
  - Timing labels: Changed "First run/Cached run" to "When code changes/When code unchanged"
  - Try It Out section: Focused on 3 key prerequisites (Node.js, Git, package manager) instead of listing all doctor checks
  - Added note that `doctor` provides additional setup guidance beyond prerequisites
  - Better positioning for AI agents evaluating project suitability

- **Added CHANGELOG.md update requirement to CLAUDE.md**
  - Documented mandatory CHANGELOG update before any release
  - Added example CHANGELOG entry format with Issue #8 as demonstration

### 🔧 Changed

- **Removed `config.output.format` field** - State files are now always written as YAML (not JSON)
  - Removed `OutputFormatSchema` and `OutputFormat` type from config package
  - State files (`.vibe-validate-state.yaml`) are now written in YAML format for both human and machine readability
  - JSON is valid YAML, so existing JSON state files will still be parsed correctly
  - Removed implicit format auto-detection - explicit and simple is better
  - Updated all presets, init command, and config command to remove format references
  - All 374 tests passing

## [0.9.8] - 2025-10-18

### 🎉 Initial Public Release

**vibe-validate** is a git-aware validation orchestration tool built specifically for **agentic coding workflows** with AI assistants like [Claude Code](https://claude.ai/code).

### Core Design Goals (Why This Exists)

1. **Enforce SDLC best practices with AI agents**
   - Validate before pushing (prevent broken PRs)
   - Synchronize PR/local validation (guarantee CI passes)
   - Parallel + cached validation (speed up iteration)
   - Agent-optimized error output (minimize context window usage)
   - Branch sync enforcement (keep branches current with main)

2. **Built for Claude Code** - Primarily tested with Anthropic's AI coding assistant

### ✨ Features

- **312x faster cached validation** (288ms vs 90s when code unchanged)
- **Git tree hash caching** - Content-based, deterministic
- **Parallel phase execution** - Run independent checks simultaneously
- **Agent-optimized output** - Auto-detects Claude Code, Cursor, Aider, Continue
- **Branch sync enforcement** - Pre-commit hook ensures branches stay current
- **GitHub Actions generator** - CI/CD workflow auto-generated from config
- **Configuration diagnostics** - `doctor` command checks setup (7 health checks)

### 📦 Packages

- **@vibe-validate/cli** - Command-line interface
- **@vibe-validate/core** - Validation orchestration engine
- **@vibe-validate/git** - Git workflow utilities
- **@vibe-validate/formatters** - Error parsing & LLM optimization
- **@vibe-validate/config** - Configuration system with presets

### 🚀 Performance

Real-world TypeScript Node.js app:
- Full validation: 90.5s (parallel execution)
- Cached validation: 0.288s
- Speedup: 312x

### 📊 Test Coverage

- **371 tests** passing (100% pass rate)
- **75.76% coverage**
- **Self-hosting** - vibe-validate validates itself

### 🎯 Primary Use Case

**Agentic coding with Claude Code**:
- Prevent broken PRs before they reach CI
- Guarantee local/CI validation sync
- Speed up debugging with filtered test output
- Enforce branch synchronization with main
- Minimize AI context window usage

### 🤖 AI Assistant Support

- **Claude Code** (primary) - Anthropic's AI coding assistant
- **Cursor** - Compatible with agent context detection
- **Aider** - Supported output formatting
- **Continue** - Agent-friendly error reporting

---

## Version History

- **v0.10.0** (2025-10-19) - YAML config support, focused init modes, enhanced doctor
- **v0.9.11** (2025-10-18) - Critical bug fix for tree hash consistency
- **v0.9.8** (2025-10-18) - Initial public release

[Unreleased]: https://github.com/jdutton/vibe-validate/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/jdutton/vibe-validate/compare/v0.9.11...v0.10.0
[0.9.11]: https://github.com/jdutton/vibe-validate/compare/v0.9.10...v0.9.11
[0.9.8]: https://github.com/jdutton/vibe-validate/releases/tag/v0.9.8
