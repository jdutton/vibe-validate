# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.18.0] - 2025-12-26

### Features

- **`watch-pr` complete redesign with error extraction** (PR #92) - **BREAKING CHANGES**
  - **Problem**: CI failures showed "check failed" with no details - had to click through GitHub UI to find what broke
  - **What's new**:
    - Extracts test failures with file:line:message from GitHub Actions logs (Vitest, Jest, ESLint, TypeScript, Playwright)
    - Shows flaky test patterns and success rates from PR history
    - View all runs with `--history` to discover run IDs
    - Inspect specific failures with `--run-id <id>` (useful for testing extractors)
    - Monitor any repo with `--repo owner/repo`
    - 24x faster with local caching
    - Auto-polls until CI completes
  - **Breaking changes**:
    - Removed `--provider` option (GitHub Actions only, no GitLab support)
    - Changed timeout default from 60 minutes to 30 minutes
    - Different output format (LLM-optimized YAML structure)
  - **Impact**: Get actionable errors immediately without leaving terminal

- **`cleanup` redesigned for safe LLM-guided branch deletion** (Issue #93, PR #95) - **BREAKING CHANGES**
  - **Problem**: Old cleanup was unsafe (could delete current branch) and lacked context about why branches exist
  - **What's new**:
    - Safe to run - auto-switches off current branch, never deletes it
    - Fetches PR metadata from GitHub (open/closed/merged, merge method, who merged it)
    - Explains why squash/rebase merged branches show as "not merged" in git
    - Clear assessment for each branch with context (safe to delete, needs review, has unpushed work)
    - 6.4x faster (parallel GitHub API fetching)
    - LLM-optimized YAML output with actionable guidance
  - **Breaking changes**:
    - Requires `gh` CLI
    - Removed `--main-branch`, `--dry-run`, `--yaml` flags (auto-detects main, always previews, always YAML output)
    - Always outputs structured YAML (no human-friendly text mode)
  - **Impact**: Safe for LLMs to run with clear contextual guidance for decision-making

### Bug Fixes

- **Windows compatibility** (Issue #86, PR #94) - vibe-validate now works correctly on Windows (path handling, process spawning)
- **Vitest extractor** (Issue #84, PR #98) - Fixed unhandled promise rejections causing silent failures

### Internal

- Reduced code duplication 70% (4.73% → 1.43%)
- Eliminated SonarQube security blockers and code quality violations

### Documentation

- Added comprehensive `watch-pr` command guide (650+ lines)
- Updated README with latest features

## [0.17.6] - 2025-12-15

### Bug Fixes

- **Fixed secret scanning failure with default secretlint command** (Issue #88, regression from v0.17.5)
  - **Problem**: Users with secret scanning enabled but no gitleaks installed and no custom `scanCommand` got "Not found target files" error
  - **Solution**: Default command no longer uses shell syntax that was being misinterpreted
  - **Impact**: Affects ~5% of users (scanning enabled, no gitleaks binary, no custom config)

### Features

- Automated npm publishing via GitHub Actions (push tags to publish, RC→@next, stable→@latest+release)
- Converted all tools/ scripts to TypeScript with direct execution via tsx

## [0.17.5] - 2025-12-15

### Bug Fixes

- **CRITICAL: Fixed CI workflow validation check** (Issue #85) - Workflow was incorrectly passing even when tests failed because grep matched nested `passed: true` fields instead of top-level validation result (simplified to use exit codes)
- Fixed Windows CI test failures, which were masked by the CI workflow bug
- Pre-commit hook no longer falsely flags the local branch as stale during merge commits

### Security

- **CRITICAL: Eliminated command injection vulnerability in history recorder**
  - **Problem**: `packages/history/src/recorder.ts` used `execSync` with string interpolation for git notes operations, creating command injection risk
  - **Solution**: Replaced with secure `addNote()` API from `@vibe-validate/git` package that uses stdin for content passing
  - **Impact**: No more shell interpreter risks in validation history recording
- **NEW: Secure command execution wrapper**
  - Created `packages/cli/src/utils/safe-exec.ts` with `safeExecSync()`, `isToolAvailable()`, and `getToolVersion()` functions
  - Uses `spawnSync` with `shell: false` and `which` package for absolute path resolution
  - Comprehensive unit tests covering security scenarios (command injection, PATH manipulation, special characters)
  - Replaced 4 tool detection calls (gh, gitleaks, node, npm/pnpm) with secure wrapper
  - **Benefits**:
    - No shell interpreter = no command injection attack surface
    - Absolute paths prevent runtime PATH manipulation
    - SonarQube compliant
    - DRY - centralizes execution logic
    - Self-documenting security intent
- Fixed HIGH severity vulnerability in glob package (command injection)
- Fixed MODERATE severity vulnerability in js-yaml package (prototype pollution)
- Updated to TypeScript ES2024 target (backward compatible)

### Features

- `vv doctor` now detects stale builds and dependencies

### Documentation

- Added SonarCloud Quality Gate and Codecov coverage badges to README.md
- Improved README.md to clarify the benefits of the project, and reduced verbosity
- Cleaned up repository root (moved files to `.github/`, removed unnecessary files)

### New Package

- **@vibe-validate/utils** - Common utilities package (command execution, cross-platform path helpers)

## [0.17.4] - 2025-12-07

### Bug Fixes

- **Commands now work correctly from any subdirectory** (Issue #76)
  - **Problem**: Running commands from subdirectories (like `packages/cli/`) caused failures or incorrect behavior
  - **What was broken**:
    - `vv doctor` reported "workflow file not found" even when the workflow existed at project root
    - `vv generate-workflow` created workflow files in the wrong location
    - Confusing error messages depending on where you ran commands
  - **What's fixed**: All commands now work correctly regardless of which directory you run them from
  - **Commands verified**: validate, state, config, snapshot, history, cleanup, pre-commit, watch-pr, init, run, doctor, generate-workflow

## [0.17.3] - 2025-12-06

### Bug Fixes

- **CRITICAL: `vv run` caching completely broken** (Issue #73, Regression in v0.17.0-rc.7, stable releases v0.17.0-v0.17.2)
  - **Problem**: Cache was not working at all - every command executed fully instead of returning cached results
  - **Root Cause**: Security refactoring (commit 778cede, PR #58) passed string literal `'HEAD'` to git notes functions that require hexadecimal tree hashes, causing silent validation failures
  - **Impact**: 312x speedup unavailable for 12 days (Nov 24 - Dec 6, 2025)
  - **Solution**: Changed to use actual tree hash variable instead of `'HEAD'` literal
  - **Affected versions**: v0.17.0, v0.17.1, v0.17.2, and prereleases v0.17.0-rc.7 through rc.13

- **Improved nested `vv run` command caching efficiency** (Issue #73 expanded scope)
  - **Previous Behavior**: After the critical cache fix above, nested `vv run` commands worked but created unnecessary duplicate cache entries
    - Running `vv run "vv run 'echo test'"` would store TWO cache entries for the same result
    - Both outer and inner commands would cache independently with different keys
    - Cache worked correctly but accumulated redundant entries over time
  - **Improvement**: Outer `vv run` now skips caching when nested command is detected - only innermost command caches its result
    - **Cleaner cache**: One cache entry per unique command instead of duplicates
    - **Bidirectional caching**: Nested and direct invocations now explicitly share the same single cache entry
    - **Cache hit propagation**: `isCachedResult: true` properly flows from inner to outer results
    - **Transparency**: Added optional `requestedCommand` field showing original wrapped command when it differs from executed command
  - **Technical Details**:
    - Modified `storeCacheResult()` to skip caching when `result.command !== commandString` (indicates nested YAML detected)
    - Added `requestedCommand` optional field to `RunResult` schema (v0.17.3+)
    - Enhanced `mergeNestedYaml()` to preserve transparency about command wrapping

- **Fixed `--force` flag not propagating to nested `vv run` commands** (Issue #73 side effect)
  - **Problem**: When running `vv validate --force` or nested `vv run --force` commands, the inner commands still used cached results instead of forcing fresh execution
  - **Root Cause**: The nested caching efficiency fix correctly prevented outer caching, but the `--force` flag wasn't being passed to child processes
  - **Impact**: Users expecting `--force` to bypass ALL caching only saw outer layer bypass - inner commands still used stale cache
  - **Solution**: Added `VV_FORCE_EXECUTION=1` environment variable that propagates naturally through nested commands
    - When `--force` flag is present, set `VV_FORCE_EXECUTION=1` in environment
    - Cache lookup checks for this env var and skips cache when detected
    - Works for both direct `vv run --force` and nested `vv validate --force` scenarios
  - **Verification**: Running `vv validate --force --yaml` now correctly shows `isCachedResult: false` for all validation steps

### Features

- **Custom Workflow Support**: Added `ci.disableWorkflowCheck` config option for projects requiring manual workflow customization
  - Set to `true` to suppress "workflow out of sync" warnings from `doctor` command
  - Useful for multi-language projects or custom CI setups that can't use auto-generated workflows
  - See troubleshooting docs at `docs/heterogeneous-projects.md`

### Documentation

- Improved `doctor` command error messages with troubleshooting links and workflow regeneration guidance
- Added comprehensive troubleshooting section for workflow sync issues
- Claude Code SKILL.md now includes version field that tracks vibe-validate package version

## [0.17.2] - 2025-12-06

### Bug Fixes

- **Pre-commit Work Protection Timing**: Fixed execution order in `pre-commit` command to create worktree snapshot BEFORE branch sync checks
  - Previously suggested `git pull`/`git merge` before snapshotting, risking work loss on merge conflicts
  - Snapshot now created immediately after config loading
  - All subsequent git operations are now protected
  - Fixes Issue #69

### Features

- **New `snapshot` command**: View current worktree snapshot state and recovery instructions
  - Shows validation status with clarified "Validation Status:" label
  - Provides step-by-step recovery instructions for different scenarios
  - Uses correct program name (vv vs vibe-validate) in suggestions
  - Suggests running `state` command for failed validations

### Internal Improvements

- Refactored test helpers to reduce code duplication (51.3% → minimal)
- Improved process.exit mock handling in snapshot command tests

## [0.17.1] - 2025-12-05

### Features

- **Automatic Work Protection**: Every validation creates recoverable snapshots of all files
  - Automatic - no user action required
  - Zero storage overhead - git deduplicates unchanged files
  - Recover work using standard git commands and tree hashes

### Documentation

- Added comprehensive Work Protection Guide with recovery scenarios and command cookbook
- Updated all READMEs and guides to document work protection feature
- Reorganized Claude Code skill structure for better maintainability
- Consolidated skill resources to single source of truth in `docs/skill/resources/`

### Known Limitations

- **Claude Code Skill**: Auto-installs on `npm install -g` but not on `npm uninstall -g`
  - Upgrading automatically cleans and reinstalls
  - Manual cleanup: `rm -rf ~/.claude/skills/vibe-validate`
  - Only affects global installations

## [0.17.0] - 2025-11-30

### 🚨 BREAKING CHANGES

**Default Working Directory Changed to Git Root**
- Commands now run from git root by default (not `process.cwd()`)
- Steps with `cwd` field interpret paths relative to git root
- Improves cache hit rates by 30-50% in monorepos
- If you relied on running from subdirectories, add explicit `cwd` field to config
- See "Heterogeneous Project Support" feature below for migration details

### ✨ Features

**Smart Version-Aware CLI Wrapper**
- Automatically detects execution context (dev/local/global)
- Shows `-dev` suffix for development builds (`vv --version` in workspace)
- Enhanced `vv doctor` with context labels and semver-aware version checks
- Debug mode (`VV_DEBUG=1`) shows resolution details
- Impact: Clear understanding of which vibe-validate version is running

**Heterogeneous Project Support (Multi-Language Monorepos)**
- New `cwd` field runs validation steps from specific directories
- Paths interpreted relative to git root for consistency
- Perfect for Java + TypeScript + Python monorepos
- 30-50% better cache hit rates through path normalization
- Security: Path traversal prevention built-in
- GitHub Actions workflow generation includes `working-directory`
- New documentation: `docs/heterogeneous-projects.md`
- New template: `config-templates/multi-language.yaml`

**Plugin Architecture for Error Extractors**
- Migrated all 14 extractors to plugin structure with co-located tests/docs
- Eliminated ~400 lines of duplicated detection logic
- Extractor registry pattern for easy extension
- Each plugin includes: detection logic, extraction, samples, tests, docs
- Impact: Easier to add new test framework support

**Secure Git Command Execution**
- Eliminated all command injection vulnerabilities in git operations
- New secure execution layer with input validation
- High-level API functions (`addNote()`, `readNote()`, `removeNote()`)
- Comprehensive security test suite
- Impact: Safe git operations, no shell injection risks

**Maven Compiler Extractor**
- Extracts compilation errors from Maven builds
- Supports file/line/column parsing
- Impact: Better error extraction for Java projects

**Pre-commit Now Detects and Blocks Partially Staged Files**
- Pre-commit now detects when files have both staged and unstaged changes
- Prevents validation mismatch where validated code differs from committed code
- Provides clear remediation steps when detected
- Impact: Ensures committed code always matches validated code

**Pre-commit Now Detects If Current Branch Is Behind Remote**
- Pre-commit now checks if current branch is behind its remote tracking branch
- Prevents conflicts from committing while teammates have pushed to the same branch
- Works for any branch with remote tracking (feature branches, main, etc.)
- Impact: Prevents merge conflicts and lost work

**Meta-Package Delegation to CLI**
- Fixed `vibe-validate` wrapper scripts to delegate to `@vibe-validate/cli` at runtime
- Ensures single source of truth for wrapper logic
- Fixes version detection when installed globally via npm
- Impact: `vv --version` now correctly shows `-dev` suffix in workspace

**Automatic Secret Scanning Tool Detection**
- Secret scanning now automatically detects available tools (gitleaks, secretlint)
- Can run multiple scanners simultaneously (defense in depth)
- Works in containerized environments (Claude Code on the web)
- Graceful fallback when preferred tool unavailable
- Impact: Better secret detection across different environments

**Auto-Output YAML on Validation Failure**
- `vv validate` and `vv pre-commit` now automatically output structured YAML on failure
- Eliminates need for separate `vv state` command
- Impact: Immediate actionable feedback for both humans and AI agents

**Config File Discovery from Subdirectories**
- Config loader now walks up directory tree to find `vibe-validate.config.yaml`
- Impact: Run `vv validate` from any subdirectory within your project

### 🐛 Bug Fixes

**Suppressed Alarming Schema Validation Warnings for Legacy History**
- Silently skip corrupted legacy entries from rc.9 (0/0 line/column values)
- Clean validation output without repeated warnings
- Users can cleanup with: `vv history prune --all`

**Fixed Misleading "0 test failure(s)" for Killed Processes**
- Killed processes (from fail-fast) now show meaningful extraction
- Summary: "Process stopped (fail-fast)"
- Impact: Clear understanding of fail-fast behavior

**Fixed Broken Validation History in Jest-Based Projects**
- Jest extractor now sets line/column to `undefined` when location unavailable
- Prevents schema validation warnings and corrupted history
- Impact: Jest projects no longer produce corrupted validation history

**Fixed Incorrect Extractor Selection in Multi-Language Projects**
- Maven test output no longer misdetected as Jasmine tests
- Increased Maven Surefire priority above Jasmine
- Impact: Maven projects now correctly extract test failures

**Fixed Doctor Command Legacy History Detection**
- No longer reports false positives for "Legacy validation history detected"
- Only warns when actual legacy `.vibe-validate-state.yaml` entries exist
- Impact: Accurate diagnosis for fresh installations

**Fixed `vv run` Cache Regression**
- Restored v0.16.1 behavior - cache keys include invocation directory
- Prevents false cache hits from different directories
- Impact: Reliable caching for subdirectory workflows

**Fixed Extractor Schema Compliance**
- Jest extractor now properly sets `line`/`column` to `undefined` when unavailable
- Prevents "line: Number must be greater than 0" schema violations
- Impact: No more corrupted validation history in Jest projects

### 🔒 Security

**Eliminated Git Command Injection Vulnerabilities**
- Fixed shell piping vulnerability in git notes cleanup
- Fixed heredoc injection in git notes operations
- All git commands now use secure spawn with array arguments
- Comprehensive input validation for refs, hashes, and paths
- Impact: Protection against command injection attacks

## [0.16.1] - 2025-11-21

### 🐛 Bug Fixes

**Config Error Reporting**
- `vibe-validate validate` now shows specific validation errors when config file exists but is invalid
- Previously showed generic "No configuration found" message for both missing files and invalid configs
- Now matches `vibe-validate doctor` behavior with clear error messages and fix suggestions

## [0.16.0] - 2025-11-15

### 🚨 BREAKING CHANGES

**Regenerate GitHub Actions Workflows**
- Run `vibe-validate generate-workflow` to regenerate `.github/workflows/validate.yml`
- New phase-based job grouping reduces GitHub Actions runner usage by 40-70%
- Commit and push the updated workflow file

**`parallel` Flag Now Works**
- The `parallel` flag was defined in config but never implemented - it was silently ignored
- Now properly controls CI job grouping:
  - `parallel: false` - Steps run in ONE job (cost-effective, recommended default)
  - `parallel: true` - Each step runs in separate job (faster for slow steps)
- Local validation unchanged, only affects CI workflows

### ✨ New Features

**Phase-Based CI Job Grouping**
- Reduces GitHub Actions runner usage by 40-70% for most projects
- Example: TypeScript project goes from 3 runners → 1 runner (67% reduction)
- When to use:
  - `parallel: false` - Fast steps (< 30s), minimize runner startup overhead
  - `parallel: true` - Slow steps (1+ min), need true parallelism

**Example Config**:
```yaml
validation:
  phases:
    - name: Pre-Qualification
      parallel: false  # All steps in 1 job
      steps:
        - name: TypeScript
          command: pnpm typecheck
        - name: ESLint
          command: pnpm lint
    - name: Testing
      parallel: true  # Each step separate job (if multiple)
      steps:
        - name: Tests
          command: pnpm test
```

### 🐛 Bug Fixes

- **CRITICAL**: Fixed unimplemented `parallel` flag - now actually controls CI job grouping as documented

### 🎯 Migration Guide

1. Check your config: `grep "parallel:" vibe-validate.config.yaml`
2. Decide strategy: `parallel: false` (recommended) or `parallel: true` (for slow steps)
3. Regenerate: `vibe-validate generate-workflow`
4. Review: `git diff .github/workflows/validate.yml`
5. Commit and push

## [0.15.0] - 2025-11-12

Major update bringing run command caching, code quality enforcement, smart defaults, and enhanced AI agent integration.

### 🚨 BREAKING CHANGES

**Schema Changes**
- Validate results, validate steps, and run results now share common schema elements for consistency
- Extensive changes to the schema to reduce redundancy that can consume LLM tokens and to support enhancements, e.g. with outputFiles visibility

**Git Notes Paths Changed**
- Validation history: `runs/{hash}` → `validate/{hash}`
- Added new run cache location for `vv run` command caching
- Old v0.14.x history won't display (still exists, just hidden)
- Run `vibe-validate history prune --all` to clean up old entries (optional)

**Run Command Behavior**
- `vv run` now returns cached results by default when code unchanged
- Use `--force` flag to bypass cache and always re-execute
- Use `--check` flag to query cache status without running

### ✨ New Features

**Smart Command Wrapper with `vv` Alias**
- New `vv` binary provides shortest invocation for all commands
- Context-aware execution: automatically detects dev mode, local install, or global install
- Works seamlessly in both git and non-git directories
- Example: `vv run pytest tests/` instead of `npx vibe-validate run "pytest tests/"`
- Global installs now correctly expose both `vv` and `vibe-validate` commands

**Run Command Caching**
- Smart caching by git tree hash - instant results (<200ms) for unchanged code
- Works in ANY language (Python, Rust, Go, etc.) - no config required
- Flags: `--force` (bypass cache), `--check` (query cache status), `--debug` (show outputFiles)
- 90-95% context window reduction for AI agents when extracting supported formats
- YAML frontmatter detection enables nested `vv run` command composition

**Smart outputFiles Visibility**
- New `--debug` flag for validate and run commands controls output verbosity
- Step-level outputFiles: Only shown for failed steps or with `--debug`
- Top-level outputFiles: Only shown with `--debug` flag
- Commands wrapped with `vv run` always show outputFiles for downstream processing
- Significantly reduces token usage for AI agents (only show logs when needed)

**Enhanced History and State Commands**
- `history show` now defaults to current tree hash (no argument needed)
- `state` command intelligently shows run cache when no validation config exists
- Added `--runs` flag to state: show only run cache entries
- Added `--all` flag to state: show both validation history and run cache
- `history show <hash> --all` - View validation runs + all cached run results
- `history list --run` - List all run cache entries with newest first
- `history prune --run` - Clean up run cache entries

**Schema Type Safety & IDE Support**
- 5 JSON Schema files published to npm and available via unpkg CDN
- All result schemas use `.strict()` mode (prevents typos/unknown fields)
- `vibe-validate init` generates version-pinned schema URLs for IDE autocomplete
- Example: `$schema: https://unpkg.com/@vibe-validate/config@0.15.0/config.schema.json`
- Stable URLs with version matching prevent breakage

**TreeHash Deduplication**
- Removed duplicate treeHash from nested results in history/state output
- TreeHash now only appears at root level to save tokens
- Created shared `tree-hash-output.ts` utility for consistent formatting

### 🎨 Improvements

**Natural Command-Line Syntax for `run`**
- `vv run echo test` now works naturally without quotes
- Options pass through correctly: `vv run eslint --max-warnings 0 src/`
- Old quoted syntax still works for backwards compatibility: `vv run "npm test"`

**Cleaner Help Output**
- Replaced `---` section separators with `***` to avoid YAML front matter confusion
- YAML document start markers (`---`) remain in code examples where appropriate

**Simplified History Commands**
- Removed redundant `--all` flag from `history list --run`
- More intuitive interface with sensible defaults

**YAML Output Format**
- Always include trailing `---` separator in `vv run` output (RFC 4627 compliant)
- Provides deterministic parsing boundaries for LLMs and YAML parsers
- Improves extraction accuracy and standards compliance

**TypeScript Bin Wrapper Refactor**
- Converted shell script wrappers to TypeScript for type safety
- Eliminated 132 lines of duplication between `vibe-validate` and `vv` binaries
- Single source of truth with full type safety and JSDoc comments
- Cleaner build process and git history

**Reduced Code Duplication**
- Created shared utilities for common patterns:
  - `test-framework-utils.ts` - Shared test extraction logic
  - `yaml-output.ts` - Consistent YAML formatting
  - `fs-utils.ts` - Reusable filesystem operations
- Refactored CLI commands to use shared utilities
- Lowered jscpd detection thresholds (min-lines: 5, min-tokens: 50)

### 🐛 Bug Fixes

**YAML Separator Consistency**
- Fixed inconsistent trailing separator behavior in `vv run` output
- Now always includes both opening and closing `---` separators
- Updated all test mocks and parsing helpers to handle consistent format

**Process Management**
- Fixed critical timeout bug preventing hung child processes (581s → 87s validation)
- Added timeout safeguards with proper cleanup
- Fixed stdin hanging issues with centralized spawn utility

**Generic Extractor**
- Fixed totalCount bug in error counting

**Test Infrastructure**
- Removed noisy "Failed to parse nested YAML" warning (expected for nested `vv run`)
- Extracted Commander test setup helper (refactored 10 test files)
- Created integration test helpers (3 new modules, 296 lines of reusable code)

### 📚 Documentation

**New Documentation**
- `docs/schemas.md` - Complete JSON Schema reference
- `docs/ci-debugging.md` - Comprehensive `--debug` flag usage guide (82 lines)
- Migration guide for upgrading from v0.14.x
- Version management workflow in CLAUDE.md

**Updated Documentation**
- Updated CLI reference with natural syntax examples
- Added `--debug` flag documentation with CI debugging examples
- Updated VALIDATION-STATE-EXAMPLES.md with new output format
- Claude Code plugin docs with v0.15.0 caching behavior

## [0.14.3] - 2025-10-30

### 🐛 Bug Fixes

- **CRITICAL: Fixed Jest detection failures with real-world output** (Issue #43)
  - **Problem**: Large Jest output (1.7 MB, 28k lines) from facebook/jest monorepo was misdetected as Mocha or Vitest due to bullet spacing and detection order bugs
  - **Solution**: Removed space requirement from bullet marker detection and moved Jest detection before Mocha (more distinctive patterns checked first). Added regression tests with real-world samples.
  - **Impact**: Jest output now correctly detected (confidence 90) with all errors extracted

## [0.14.2] - 2025-10-27

### 🐛 Bug Fixes

- **CRITICAL: Fixed broken `init` command** (Issue #36 - complete fix)
  - **Problem**: `vibe-validate init` still failed with "template not found" despite v0.14.1 fix
  - **Solution**: Moved templates permanently to `packages/cli/config-templates/` and fixed path resolution in both `init.ts` and `template-discovery.ts`
  - **Impact**: `vibe-validate init` now works reliably for all users

### ✨ Improvements

- **Enhanced `config` command error reporting**
  - Config command now shows detailed validation errors with field names, expected types, and helpful suggestions
  - Consistent error messages across `config` and `doctor` commands

### 🧪 Testing

- Added 23 comprehensive regression tests covering `init`, `config`, and `doctor` commands
- Added end-to-end packaging test that validates template discovery at runtime

## [0.14.1] - 2025-10-27

### 🐛 Bug Fixes

- **CRITICAL: Fixed broken `init` command** (Issue #36)
  - **Problem**: `vibe-validate init` was completely broken for new users installing from npm
    - Error: "template 'minimal' not found"
    - Available templates: empty list
  - **Solution**: Config templates are now properly packaged with the CLI. Added comprehensive packaging tests (unit + system) to prevent regression.
  - **Impact**: `vibe-validate init` now works correctly for all users

## [0.14.0] - 2025-10-27

### ✨ New Features

- **NEW: `run` Command for AI Agents** (Issue #32)
  - **Problem**: AI agents (Claude Code, Cursor, Aider) were overwhelmed by verbose test output, wasting 90-95% of their context window on noise
  - **Solution**: New `vibe-validate run "<command>"` wraps any command and extracts only the errors in clean YAML format
  - **Impact**:
    - Saves 90-95% of AI agent context window (1500 tokens → 75 tokens)
    - Works with ANY command, not just validation steps
    - Automatic tool detection (Jest, Vitest, Playwright, TypeScript, ESLint, etc.)
    - Detects nested `vibe-validate run` calls and merges YAML output (2-10+ levels deep)
    - Routes package manager noise (pnpm/npm/yarn) to stderr, keeps stdout pure YAML
  - **Example**:
    ```bash
    # Instead of overwhelming output:
    npx vitest failing-test.ts
    # 200+ lines of verbose output...

    # Get clean, LLM-friendly errors:
    vibe-validate run "npx vitest failing-test.ts"
    # Output: 4-5 lines showing what failed and next steps
    ```
  - **Use cases**:
    - Test single file: `vibe-validate run "npx vitest <file>"`
    - Type checking: `vibe-validate run "pnpm typecheck"`
    - Linting: `vibe-validate run "pnpm lint"`
    - Any command that outputs errors
  - See `vibe-validate run --help` for details

### 🐛 Bug Fixes

- **CRITICAL: Fixed Jest, Vitest, and Playwright Error Extraction**
  - **Problem**: Test failure extraction was broken for three major test frameworks
    - Jest: Only extracting 1 error when 27 failures present
    - Vitest: Extracting 0 errors due to missing ANSI stripping
    - Playwright: Detection completely missing from smart-extractor
  - **Root causes**:
    - ANSI color codes (e.g., `\x1b[31m`) were breaking regex pattern matching
    - Wrong Unicode symbols used (× vs ✕) causing misrouting between Jest/Vitest
    - Test framework detection was missing or using incorrect patterns
    - Source code in stack traces triggered false positive detections
  - **Solution**: Complete extractor detection overhaul
    - **Central ANSI stripping**: All extractors now receive clean, parseable input (DRY, fail-safe)
    - **Pattern-based detection**: Tool detection based on actual output patterns, not step names
    - **Correct symbol detection**: Vitest uses × (U+00D7), Jest uses ✕ (U+2715)
    - **Detection order matters**: More specific patterns checked first (Playwright `.spec.ts` before Jest/Vitest `.test.ts`)
    - **Multi-pattern requirement**: Requires multiple patterns together to prevent false positives
  - **Impact**:
    - ✅ Jest: Now correctly extracts all 27 errors
    - ✅ Vitest: Now correctly extracts all 14 errors
    - ✅ Playwright: Now correctly extracts all 11 errors
    - ✅ Extraction works reliably with real command output (not just clean test fixtures)

- **Detection Metadata for Transparency**
  - **Problem**: No way to verify which error extractor was actually used
  - **Solution**: Every extraction now includes metadata showing:
    - Which extractor was chosen (jest, vitest, playwright, etc.)
    - Detection confidence level (0-100)
    - Patterns that matched
    - Reason for detection
  - **Impact**: Makes debugging extraction issues much easier

### ♻️ Refactoring

- **Function rename**: `extractByStepName` → `autoDetectAndExtract`
  - **Problem**: Old name suggested step names controlled routing (they don't - detection is 100% pattern-based)
  - **Solution**: Renamed to accurately reflect auto-detection from output patterns
  - **Impact**: Clearer API, better documentation

### 🔒 Security

- **SonarCloud Security Hotspots Resolved**
  - **Problem**: Shell command execution in file operations flagged as security risk
  - **Solution**:
    - Replaced `execSync('cp ...')` with `fs.copyFileSync()` in tree-hash calculation
    - Replaced `execSync('rm -f ...')` with `fs.unlinkSync()`
    - Added comprehensive NOSONAR justifications documenting threat model
    - Enhanced SECURITY.md with command execution security model
  - **Impact**:
    - Prevents potential command injection in file paths
    - All security hotspots reviewed and resolved
    - Clear documentation of security design decisions

- **SonarCloud Configuration Added**
  - **Problem**: Test files flagged for code duplication (28.4%)
  - **Solution**: Created `sonar-project.properties` to exclude test files from duplication checks
  - **Rationale**: Test code duplication is acceptable and often necessary for test clarity and independence
  - **Impact**: Quality gate focuses on production code quality, not test patterns

### 🧪 Testing

- **System Test Infrastructure** (3-tier strategy)
  - **Problem**: Unit tests passed but extractors failed with real command output
  - **Solution**: Added system test layer that runs actual commands (Jest, Vitest, Playwright, TypeScript)
  - **Impact**: Catches real-world extraction bugs that unit tests miss
  - **Test tiers**:
    - **Unit tests** (pnpm test): Fast (10s), mocked, pre-commit
    - **Integration tests** (included): Medium (30s), fast real commands
    - **System tests** (pnpm test:system): Slow (3-5min), full real commands, pre-release
  - **Coverage**: 211 unit tests + 15 system tests + 7 sample tests (all passing)

## [0.13.0] - 2025-10-26

### ✨ New Features

- **Smart Locking System for Concurrency Control**
  - **Problem**: Multiple validation runs (different terminals, worktrees) could conflict with shared resources like ports or databases
  - **Solution**: Configurable locking system with wait-for-completion mode
  - **Impact**: Prevents duplicate validation runs and resource conflicts
  - **Key capabilities**:
    - Enabled by default - only one validation runs at a time
    - Wait mode (default): New runs wait for existing validation to complete
    - Project-scoped locking: Share locks across worktrees when using fixed ports/databases
    - Directory-scoped locking (default): Each directory has its own lock for parallel worktrees
    - Auto-detection of project ID from git remote or package.json
    - CLI flags: `--no-lock`, `--no-wait`, `--wait-timeout <seconds>`
  - **Configuration**:
    ```yaml
    locking:
      enabled: true  # Default: true
      concurrencyScope: directory  # "directory" (default) or "project"
      projectId: my-app  # Optional: auto-detected
    ```
  - **Use cases**:
    - Directory scope: No shared resources, parallel worktrees OK
    - Project scope: Tests use fixed ports (3000, 8080) or shared databases
    - Disable: CI environments with isolated containers
  - See [Locking Configuration Guide](./docs/locking-configuration.md) for details

### ♻️ Refactoring

- **Cross-platform pre-publish script** (Windows compatibility)
  - **Change**: Converted `tools/pre-publish-check.sh` (bash) to `tools/pre-publish-check.js` (Node.js)
  - **Impact**: Pre-publish checks now work on Windows without WSL/Git Bash
  - **Benefits**: Consistent behavior across Windows, macOS, and Linux

- **Cleaned up legacy state file references**
  - Removed deprecated `validate:force` script from package.json
  - Updated bug report template to request `vibe-validate state --yaml` output
  - Added Claude Code Stop hook for automatic validation
  - Remaining references are intentional (migration support, tests, documentation)

## [0.12.2] - 2025-10-25

### ✨ New Features

- **Comprehensive Test Framework Support** (Issue #28)
  - **Jest**: Full error extraction for Jest test framework
    - Supports all error types (assertions, timeouts, file errors, type errors)
    - 107% extraction rate on comprehensive test suite
  - **JUnit XML**: Universal test format support
    - Auto-detection via XML format markers
    - HTML entity decoding for clean error messages
    - 100% extraction on comprehensive samples
  - **Mocha**: Native Mocha test output support
    - Distinctive format detection (X passing/failing)
    - Stack trace parsing for file locations
    - 100% extraction (17/17 tests)
  - **Jasmine**: Angular ecosystem support (1.51M weekly downloads)
    - Message:/Stack: section parsing
    - Distinctive "Failures:" header detection
    - 100% extraction (15/15 tests)
  - **TAP (Test Anything Protocol)**: Industry standard format
    - Covers Tape, node-tap, and TAP-compatible frameworks
    - YAML diagnostics block parsing
    - 100% extraction (21/21 tests)
  - **Ava**: Node.js community favorite (272K weekly downloads)
    - Two-pass parsing for reliable extraction
    - Unicode symbol detection (✘ [fail]:)
    - Quality metadata integration
  - **Playwright**: Modern E2E testing framework
    - Numbered failure block parsing
    - Stack trace extraction for file locations
    - Error type detection (assertions, timeouts, element not found, navigation)
    - 100% extraction (22/22 tests)

- **Extraction Quality Metadata System**
  - Self-reporting quality metrics for all extractors
  - Confidence scores (0-100) based on pattern match quality
  - Completeness tracking (% of failures with complete info)
  - Issue reporting for debugging extraction problems
  - Enables continuous improvement of extractors

- **Test Framework Documentation**
  - `packages/extractors/FORMATS.md` - Complete format reference
  - Format examples for all extractors
  - Regex patterns and edge cases documented
  - Testing guidelines for contributors
  - Sample format requirements

- **Smart Extraction Performance**
  - Extractors only run on FAILED validation steps (not on success)
  - Minimal performance impact: ~10ms per failed step
  - Success paths remain fast (<100ms with caching)

### 🐛 Bug Fixes

- **CRITICAL: Fixed Vitest Format 2 extraction** (was getting 0% extraction)
  - **Problem**: Vitest extractor only supported legacy Format 1 (file path in failure line)
  - **Solution**: Added Format 2 support (file path in header line from `vitest run`)
  - **Impact**: Extractor now works with current Vitest output format
  - Prevents duplicate extraction when both formats present
  - `watch-pr` command now correctly extracts CI validation failures

- **CRITICAL: Fixed flaky test** (`validate.test.ts`)
  - **Problem**: Test would randomly fail due to mock state pollution across test runs
  - **Root Cause**: Cross-file test pollution - `pre-commit.test.ts` missing `vi.clearAllMocks()` in `beforeEach`
  - **Solution**: Added proper mock cleanup in both test files
  - **Impact**: All 865 tests now pass consistently with zero flakiness

- **Fixed Jest project name parsing in FAIL line**
  - Now correctly handles Jest project prefixes in failure output
  - Improves extraction accuracy for monorepo projects

### 📦 Internal Changes

- Adjusted coverage threshold (85% → 84%) to accommodate new extractor code
- Added comprehensive test-bed infrastructure for all frameworks
- Created real-world failure samples for regression testing
- Updated smart extractor with auto-detection for all new frameworks

## [0.12.1] - 2025-10-24

### 🐛 Bug Fixes

- **CRITICAL: Fixed npm publish process** - v0.12.0 publishing issue
  - **Problem**: Packages published with `npm publish` didn't resolve `workspace:*` dependencies, making them uninstallable
  - **Solution**: Re-published using `pnpm publish -r` which correctly resolves workspace dependencies to versioned dependencies
  - **Impact**: Packages are now installable via `npm install @vibe-validate/cli@0.12.1`
  - **v0.12.0 deprecated**: Do not use v0.12.0 - it has broken dependencies

## [0.12.0] - 2025-10-23 [DEPRECATED - Use 0.12.1]

### 🚨 BREAKING CHANGES

- **State File Deprecated - Git Notes-Based Caching**
  - **Problem**: `.vibe-validate-state.yaml` file only cached one tree hash, limiting cache effectiveness
  - **Solution**: Git notes provide content-based caching across branches
  - **Impact**: Run `vibe-validate doctor` after upgrade to detect and remove deprecated files
  - **Migration**: Delete `.vibe-validate-state.yaml` and remove from `.gitignore`
  - Better cache hits across branch switches, reverts, and multiple branches
  - No more cache misses from branch changes when code is identical

- **Formatters Package Replaced by Extractors Package**
  - **Problem**: Old `@vibe-validate/formatters` package had unclear naming and limited extraction capabilities
  - **Solution**: New `@vibe-validate/extractors` package with improved error parsing and LLM optimization
  - **Impact**: Internal architecture change - no user action required (automatic with upgrade)
  - **Benefits**:
    - Smarter extraction (only runs on failed tests)
    - Better test framework support (Vitest, Jest, ESLint, TypeScript)
    - Quality metrics for contributors
    - 90% smaller output storage

### ✨ New Features

- **Validation History Tracking** (Issue #23)
  - `vibe-validate history list` - View validation timeline across all tree hashes
  - `vibe-validate history show <hash>` - Inspect specific validation results
  - `vibe-validate history prune` - Cleanup old history (by age or all)
  - `vibe-validate history health` - Check git notes storage health
  - Multi-run support per tree hash (tracks every validation run)
  - Worktree stability checks (before/after validation)
  - Output truncation (10KB max per step)

- **Enhanced `vibe-validate state` Command**
  - Now reads from git notes instead of state file
  - Same command, same output format, better caching
  - Displays most recent validation for current tree hash
  - Compatible YAML output format maintained

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

- **Developer Feedback Mode** (`developerFeedback: true`)
  - **Problem**: Error extraction ran on all tests and exposed quality metrics to end users
  - **Solution**: Smart extraction that only runs when needed and reports quality when helpful
  - **How it works**:
    - Extractors only run on failed tests (skip passing tests entirely)
    - Extraction quality metrics only included when `developerFeedback: true`
    - Alert "vibe-validate improvement opportunity" when extraction quality < 50%
  - **Impact**:
    - Faster validation (skip ~10ms extraction per passing test)
    - Cleaner YAML output for end users (no extraction noise)
    - Reduced LLM context window usage (only actionable failures)
    - Clear separation: end-user mode vs contributor mode
  - **For contributors**: Set `developerFeedback: true` to help improve vibe-validate extractors

- **YAML Output Separator for LLM-Friendly Parsing** (RFC 4627 compliant)
  - **Problem**: When using `--yaml` flag, progress messages on stderr mix with YAML on stdout in terminal view
  - **Solution**: Added standard `---` separator before YAML output to mark boundary
  - **Impact**:
    - Clear visual separation between progress and data
    - Easy extraction: `sed -n '/^---$/,$p'` gets pure YAML
    - Standards-compliant (YAML document separator)
    - LLMs can deterministically parse output
  - **Recommendation**: Use `pnpm validate --yaml` for LLM workflows (see CLAUDE.md)

- **3 New Doctor Health Checks** (15 total checks now):
  - Detects deprecated `.vibe-validate-state.yaml` file
  - Warns if state file still in `.gitignore`
  - Checks validation history health (git notes)
  - Suggests cleanup when needed

### 🐛 Bug Fixes

- **CRITICAL: Fixed Git Tree Hash Calculation** (Improved cache reliability and security)
  - **Problem**: Unstaged file changes weren't included in tree hash, causing false cache hits
  - **Solution**: Removed `--intent-to-add` flag that prevented content from being staged
  - **Impact**: Cache now correctly invalidates when files change, preventing stale validation results

- **SECURITY: Fixed .gitignore Handling in Tree Hash**
  - **Problem**: `--force` flag included ignored files (secrets, credentials) in tree hash
  - **Solution**: Removed `--force` flag to respect .gitignore rules
  - **Impact**: Secrets no longer checksummed, cache sharing works reliably across developers

- **Fixed Git Tree Hash Error Handling**
  - Git stderr now properly captured (was being ignored)
  - Non-git repositories now handled gracefully
  - Proper fallback to timestamp-based hash
  - `vibe-validate state` exits 0 in non-git repos

- **CRITICAL: Fixed Pre-Commit Caching Bug** (v0.11.0 regression)
  - **Problem**: Pre-commit hook bypassed git tree hash caching, always running full validation (30+ seconds) even when code unchanged
  - **Root Cause**: `pre-commit.ts` called `runValidation()` directly instead of reusing `validate.ts` workflow with caching logic
  - **Solution**: Extracted shared `validate-workflow.ts` used by both commands - true code reuse with all caching/history features
  - **Impact**:
    - Pre-commit now gets instant cache hits (same as `validate` command)
    - 30+ seconds reduced to <100ms when validation already passed
    - All future validate improvements automatically apply to pre-commit
    - Reduced code duplication (validate.ts: 276 → 60 lines)
  - **If you experienced slow pre-commit in v0.11.0, this is now fixed**

### ⚡ Performance Improvements

- **90% Reduction in Git Notes Storage Size**
  - **Problem**: Failed validation output stored raw (100+ lines of environment variables, verbose test output)
  - **Solution**: Extract actionable failures before storing (5-10 lines of clean, structured errors)
  - **Impact**:
    - Git notes operations are faster
    - `vibe-validate state` shows clean, LLM-friendly errors immediately
    - Less disk space used for validation history
    - Critical metadata (pass/fail, recovery commands) always available even if output truncated

- **Truncation-Safe YAML Output**
  - **Problem**: If YAML output was truncated, critical recovery information could be lost
  - **Solution**: Verbose fields (error output) placed at end of YAML structure
  - **Impact**: YAML remains parseable and actionable even if truncated by logs or display tools

### 📝 Documentation

- **LLM-Optimized Workflow Guide** (CLAUDE.md)
  - New section explaining best practices for AI assistants
  - `validate --yaml` recommended over two-step `validate` + `state`
  - Examples of parsing YAML from mixed stderr/stdout
  - Benefits: context-efficient, machine-parseable, human-readable progress

- **"Run Doctor After Upgrade" Pattern** - Documented for AI agents
  - CLAUDE.md: Prominent upgrade workflow section
  - README.md: Added doctor to Quick Start (4 steps)
  - Pattern: `upgrade → doctor → fix → verify → commit`

- **Updated Agent Integration Guide**
  - All examples use `vibe-validate state` command
  - Python and Node.js examples updated
  - Added note: "Validation state stored in git notes (not files)"

- **Auto-Synced CLI Reference**
  - Updated with new `history` commands
  - Perfect sync with `--help --verbose` output

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
  - See [Config Templates Guide](./packages/cli/config-templates/README.md) for migration instructions

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
  - Browse on GitHub: https://github.com/jdutton/vibe-validate/tree/main/packages/cli/config-templates
  - Copy template → customize → done

- **Strict Validation Prevents Configuration Drift**
  - Unknown properties immediately rejected with clear error messages
  - Catches removed/renamed fields (like `output.format`)
  - Catches typos in configuration field names
  - Fail fast with helpful errors instead of silent failures

### 📝 Documentation

- **New**: [Config Templates Guide](./packages/cli/config-templates/README.md)
  - Explains how to use YAML templates
  - Migration guide from old `preset:` system
  - Best practices for customizing templates
  - Examples for all project types

- **Updated**: All documentation now references config templates instead of presets
  - getting-started.md
  - configuration-reference.md
  - agent-integration-guide.md
  - error-extractors-guide.md

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
  - Browse templates on GitHub: https://github.com/jdutton/vibe-validate/tree/main/packages/cli/config-templates

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
  - Auto-generate `docs/skill/resources/cli-reference.md` from `--help --verbose`
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
  - Corrected schema URL in README examples: Now uses `config.schema.json` (was: `schema.json`)
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
  - Fixes broken caching mechanism that defeated the 300x+ speedup feature
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

- **300x+ faster cached validation** (sub-second vs ~90s when code unchanged)
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
- **@vibe-validate/extractors** - Error parsing & LLM optimization
- **@vibe-validate/config** - Configuration system with presets

### 🚀 Performance

Real-world TypeScript Node.js app:
- Full validation: 90.5s (parallel execution)
- Cached validation: Sub-second
- Speedup: 300x+

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

- **v0.17.0** (2025-11-30) - Heterogeneous project support, smart version detection, plugin architecture, security hardening, pre-commit enhancements
- **v0.16.1** (2025-11-21) - Fixed config error reporting
- **v0.16.0** (2025-11-15) - Phase-based CI job grouping, parallel flag implementation
- **v0.15.0** (2025-11-12) - Run command caching, code quality enforcement, smart defaults, enhanced AI integration
- **v0.14.3** (2025-10-30) - Fixed Jest detection with real-world output
- **v0.14.2** (2025-10-27) - Fixed broken init command
- **v0.14.1** (2025-10-27) - Fixed broken init command (template packaging)
- **v0.14.0** (2025-10-27) - Run command for AI agents, critical extractor fixes
- **v0.13.0** (2025-10-26) - Smart locking system for concurrency control
- **v0.12.2** (2025-10-25) - Comprehensive test framework support (8 extractors)
- **v0.12.1** (2025-10-24) - Fixed npm publish process
- **v0.12.0** (2025-10-23) - Git notes-based caching and validation history
- **v0.11.0** (2025-10-20) - Real-time CI monitoring with watch-pr command
- **v0.10.0** (2025-10-19) - YAML config support, focused init modes, enhanced doctor
- **v0.9.11** (2025-10-18) - Critical bug fix for tree hash consistency
- **v0.9.8** (2025-10-18) - Initial public release

[Unreleased]: https://github.com/jdutton/vibe-validate/compare/v0.17.5...HEAD
[0.17.5]: https://github.com/jdutton/vibe-validate/compare/v0.17.4...v0.17.5
[0.17.4]: https://github.com/jdutton/vibe-validate/compare/v0.17.0...v0.17.4
[0.17.0]: https://github.com/jdutton/vibe-validate/compare/v0.16.1...v0.17.0
[0.16.1]: https://github.com/jdutton/vibe-validate/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/jdutton/vibe-validate/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/jdutton/vibe-validate/compare/v0.14.3...v0.15.0
[0.14.3]: https://github.com/jdutton/vibe-validate/compare/v0.14.2...v0.14.3
[0.14.2]: https://github.com/jdutton/vibe-validate/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/jdutton/vibe-validate/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/jdutton/vibe-validate/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/jdutton/vibe-validate/compare/v0.12.2...v0.13.0
[0.12.2]: https://github.com/jdutton/vibe-validate/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/jdutton/vibe-validate/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/jdutton/vibe-validate/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/jdutton/vibe-validate/compare/v0.10.4...v0.11.0
[0.10.4]: https://github.com/jdutton/vibe-validate/compare/v0.10.3...v0.10.4
[0.10.3]: https://github.com/jdutton/vibe-validate/compare/v0.10.2...v0.10.3
[0.10.2]: https://github.com/jdutton/vibe-validate/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/jdutton/vibe-validate/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/jdutton/vibe-validate/compare/v0.9.11...v0.10.0
[0.9.11]: https://github.com/jdutton/vibe-validate/compare/v0.9.10...v0.9.11
[0.9.8]: https://github.com/jdutton/vibe-validate/releases/tag/v0.9.8
