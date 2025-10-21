# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### ✨ New Features

- **Pre-commit Secret Scanning** (Issue #24)
  - **Problem**: Developers accidentally commit API keys, tokens, and passwords to git
  - **Solution**: Configurable pre-commit secret scanning blocks commits containing secrets
  - **Impact**: Prevents credential leaks before they enter git history
  - Tool-agnostic design via `scanCommand` configuration
  - Gitleaks recommended (fast, free, 160+ secret types)
  - Advisory doctor check ensures scanner is installed
  - Comprehensive false positive management (baseline, .gitleaksignore, inline comments)
  - All config templates include secret scanning by default
  - Pre-commit only (GitHub already scans repos after push)

## [0.11.0] - 2025-10-20

### ✨ New Features

- **Real-time CI Monitoring with `watch-pr` Command** (Issue #21)
  - Monitor GitHub Actions PR checks in real-time
  - Auto-detects PR from current branch or accepts PR number
  - Extracts vibe-validate state files from failed CI runs
  - Provides actionable recovery commands
  - Supports fail-fast mode and configurable timeout
  - Human-friendly live display OR structured YAML output

- **YAML-Only Output Standardization** (BREAKING CHANGE)
  - Removed confusing `--format` and `--json` options from all commands
  - Single `--yaml` flag across all commands for structured output
  - Clear semantics: `--yaml` means exactly what it says
  - Affected commands: `doctor`, `sync-check`, `cleanup`, `watch-pr`

- **Windows Compatibility** (Issue #4)
  - Cross-platform shell execution (`shell: true`)
  - Platform-specific process termination (taskkill on Windows, signals on Unix)
  - Windows CI testing (Ubuntu + macOS + Windows × Node 20 + 22 + 24)
  - Fixed ESLint glob patterns for Windows
  - Comprehensive line ending normalization

### 🐛 Bug Fixes

- **Fixed Incomplete Schema** (discovered during strict validation implementation)
  - Added missing `validation.failFast` field to schema (was used by code but not in schema)
  - Added missing `description` field to ValidationStepSchema (for documenting what steps do)
  - These fields were being used in configs but silently ignored - now properly validated
  - Updated all config templates to include these fields with helpful comments

- **Cross-Platform Compatibility Fixes**
  - Fixed stdout/stderr capture on Windows (disabled detached mode)
  - Fixed line ending differences (CRLF vs LF) across all file operations
  - Fixed platform-specific test failures (permission bits, signals)
  - Added `.gitattributes` and `.editorconfig` for consistent line endings

### 🚨 BREAKING CHANGES

- **Output Flag Standardization**
  - Old: `doctor --json`, `sync-check --format yaml`, `cleanup --format json`
  - New: All commands use `--yaml` for structured output
  - Migration: Replace `--json` or `--format` with `--yaml` in scripts/workflows

- **Removed TypeScript Preset System**
  - `preset:` property no longer supported in configs
  - Migration: Copy YAML templates from `config-templates/` directory instead
  - See [Config Templates Guide](./config-templates/README.md) for migration instructions

- **Strict Schema Validation Enabled**
  - Unknown properties in configs now cause validation errors (previously ignored silently)
  - Example: `output.format` field no longer exists - remove it from your config
  - Run `vibe-validate doctor` to check your config for issues
  - Benefits: Catches typos, prevents configuration drift

### ✨ Features

- **Config Templates Replace Presets**
  - Four YAML templates available in `config-templates/` directory
  - Templates are transparent (everything visible, no hidden defaults)
  - Anyone can contribute templates (no TypeScript knowledge needed)
  - Browse on GitHub: https://github.com/jdutton/vibe-validate/tree/main/config-templates
  - Copy template → customize → done

- **Strict Validation Prevents Configuration Drift**
  - Unknown properties immediately rejected with clear error messages
  - Catches removed/renamed fields (like `output.format`)
  - Catches typos in configuration field names
  - Fail fast with helpful errors instead of silent failures

### 📝 Documentation

- **New**: [Config Templates Guide](./config-templates/README.md)
  - Explains how to use YAML templates
  - Migration guide from old `preset:` system
  - Best practices for customizing templates
  - Examples for all project types

- **Updated**: All documentation now references config templates instead of presets
  - getting-started.md
  - configuration-reference.md
  - agent-integration-guide.md
  - error-formatters-guide.md

### 🗑️ Removed

- **Removed unused configuration fields** (YAGNI principle - "You Aren't Gonna Need It"):
  - `preset:` field - Use config templates from `config-templates/` directory instead
  - `extends:` field - Zero usage detected, templates are simpler
  - `output:` section - Was never implemented

- **Impact**: Cleaner, more focused configuration schema with only actively-used features

### 🎯 Migration Guide

**Before (v0.10.x and earlier):**
```yaml
preset: typescript-nodejs
git:
  mainBranch: develop
```

**After (v0.11.0+):**
```bash
# Copy template
curl -o vibe-validate.config.yaml \
  https://raw.githubusercontent.com/jdutton/vibe-validate/main/config-templates/typescript-nodejs.yaml

# Edit to customize (e.g., change mainBranch to 'develop')
```

**Strict validation fix:**
```yaml
# Remove unknown properties
output:
  format: auto  # ❌ Remove this - field doesn't exist
```

Run `vibe-validate doctor` to check your config for issues.

### 📊 Impact

- **Transparent configs**: Everything visible in YAML (no hidden defaults)
- **Better errors**: Unknown properties caught immediately with helpful guidance
- **Easier contributions**: Anyone can submit template PRs (no TypeScript knowledge needed)
- **Faster onboarding**: Copy template → customize → done

## [0.10.4] - 2025-10-19

### ✨ Features

- **Added YAML Configuration Templates**
  - Four ready-to-use YAML configuration templates in `config-templates/` directory:
    - `typescript-library.yaml` - For npm packages and shared libraries
    - `typescript-nodejs.yaml` - For Node.js apps, APIs, and backend services
    - `typescript-react.yaml` - For React SPAs and Next.js applications
    - `minimal.yaml` - Bare-bones template for custom projects
  - Each template includes descriptive comments and JSON Schema URL for IDE autocomplete
  - Browse templates on GitHub: https://github.com/jdutton/vibe-validate/tree/main/config-templates

### 🐛 Bug Fixes

- **Fixed broken example link in `doctor` error messages**
  - Doctor previously pointed to non-existent `examples/` directory (404 error)
  - Now correctly links to `config-templates/` directory with real working examples

- **CRITICAL: Fixed `doctor` command output**
  - Non-verbose mode now shows summary only when all checks pass (was showing all 15 checks)
  - Verbose mode now shows all checks when failures exist (was showing only failing checks)
  - Fixed `--verbose` flag not working due to option conflict
  - Clearer messaging about when checks are hidden

- **Better validation error messages**
  - Doctor now shows specific Zod validation errors (e.g., "validation.phases.0.name: Required")
  - Displays up to 5 validation errors with helpful links to documentation and examples

  - No more confusing warnings during initial setup

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
- Clarified that YAML is the only supported format (`.ts`, `.js`, `.json` are not supported)

## [0.10.0] - 2025-10-19

### 🎉 Major Features

- **YAML Configuration Support** (Issue #6)
  - Primary format: `vibe-validate.config.yaml` (modern, maintainable)
  - JSON Schema generation for IDE validation and autocomplete
  - Better IDE support, more readable, industry-standard format

- **Focused Init Modes - Idempotent Setup Operations** (Issue #6)
  - `init --setup-hooks`: Install pre-commit hook only
  - `init --setup-workflow`: Create GitHub Actions workflow only
  - `init --fix-gitignore`: Add state file to .gitignore only
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
