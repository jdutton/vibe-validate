# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the vibe-validate codebase.

## **CRITICAL: DO NOT MODIFY vibe-validate.config.yaml WITHOUT EXPLICIT PERMISSION**

**NEVER, EVER modify `vibe-validate.config.yaml` without asking the user first.**

- ❌ **DO NOT** remove validation steps
- ❌ **DO NOT** change commands
- ❌ **DO NOT** "fix" the config because validation is failing
- ❌ **DO NOT** assume you know better than the existing configuration

**If validation fails:**
1. **ASK the user** what to do about the failure
2. Investigate the root cause (wrong directory? missing dependency? actual test failure?)
3. **DO NOT modify the config** to make validation "pass"

**The config defines what success means for this project. You do NOT get to redefine success without permission.**

## Project Overview

**vibe-validate** is a git-aware validation orchestration tool designed for LLM-assisted development (vibe coding). It caches validation state using git tree hashes, runs steps in parallel, and formats errors for LLM consumption.

**Target Users**: Developers using AI assistants (Claude Code, Cursor, Aider, Continue)

## Repository Structure

```
vibe-validate/
├── packages/
│   ├── utils/          # Common utilities (command execution, path helpers)
│   ├── config/         # Configuration system
│   ├── extractors/     # Error extraction & LLM optimization
│   ├── git/            # Git workflow utilities
│   ├── core/           # Validation orchestration engine
│   ├── history/        # History tracking
│   ├── cli/            # Command-line interface
│   └── vibe-validate/  # Umbrella package
├── docs/              # Comprehensive documentation
└── package.json       # Monorepo root
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages (79x faster with Turbo caching)
pnpm build              # turbo run build

# Run tests
pnpm test               # turbo run test (per-package, parallel)
pnpm test:coverage      # vitest run --coverage (root-level)
pnpm test:watch         # vitest (interactive watch mode)

# Code quality
pnpm lint               # eslint (monorepo-wide, cached ~1.8s, cold ~18s)
pnpm typecheck          # turbo run typecheck (per-package, parallel)

# Development
pnpm dev                # turbo run dev (watch mode)

# Validation (MUST pass before commit)
pnpm validate           # Full validation
vibe-validate state     # Check validation state (YAML output)
vibe-validate history   # View validation history

# Pre-commit workflow
pnpm pre-commit         # Branch sync + validation + secret scanning
```

**State Management**: Validation state tracked via git notes. See `docs/git-validation-tracking.md` for architecture.

## Turborepo Integration

This project uses **Turborepo v2.7.3** for **79x faster cached builds** (5.3s → 67ms).

**Turbo commands** (cached, parallel execution):
- `pnpm build` → `turbo run build`
- `pnpm typecheck` → `turbo run typecheck`
- `pnpm test` → `turbo run test`
- `pnpm dev` → `turbo run dev` (persistent)

**Direct commands** (not through Turbo):
- `pnpm lint` → `eslint` (monorepo-wide command, uses ESLint's `--cache` for 10x speedup)
- `pnpm test:coverage` → `vitest run --coverage` (root-level)
- All `vv` commands (validate, state, history, etc.)

**Architecture**: `vibe-validate → turbo → tool`
- vibe-validate: Workflow orchestration + error extraction
- Turbo: Task caching + parallel execution
- Error extraction works automatically through Turbo output

## LLM-Optimized Commands

**For ad-hoc testing/debugging**, use `vv run` to extract errors (95% token reduction):

```bash
# Test single file
vv run npx vitest packages/cli/test/commands/run.test.ts

# Test with filter
vv run npx vitest -t "should extract errors"

# Package-specific command
vv run pnpm --filter @vibe-validate/core test
```

**Standard scripts are already optimized** - just use `pnpm test`, `pnpm validate`, etc.

## Package Management

**pnpm monorepo**. Each package independently versioned.

```bash
# Add dependency to specific package
pnpm --filter @vibe-validate/core add <package>

# Add to workspace root (devDependencies)
pnpm add -Dw <package>
```

## Version Management

**CRITICAL**: Always use `bump-version` script:

```bash
pnpm bump-version 0.15.0-rc.5  # Explicit version
pnpm bump-version patch         # 0.15.0 → 0.15.1
```

Updates all package.json files + Claude Code plugin manifest.

## Publishing

**Automated via GitHub Actions**. DO NOT use `pnpm publish:all` manually unless automation fails.

### Full Release (e.g., v0.19.0)
1. `pnpm bump-version 0.19.0` (validates CHANGELOG, auto-stamps `[Unreleased]` → `[0.19.0] - YYYY-MM-DD`)
2. `git commit -m "chore: Release v0.19.0"`
3. Merge to main, then run: `pnpm pre-release` (validates tag doesn't exist, CHANGELOG section non-empty)
4. Only after pre-release passes: `git tag v0.19.0`
5. `git push origin main v0.19.0`
6. Monitor: https://github.com/jdutton/vibe-validate/actions

**Do NOT tag until `pnpm pre-release` passes. Tags trigger CI publish.**

### Pre-Release (e.g., v0.19.0-rc.2)
1. **DO NOT update CHANGELOG.md** - keep changes under `[Unreleased]`
2. `pnpm bump-version 0.19.0-rc.2` (skips CHANGELOG stamp for pre-releases)
3. `git commit -m "chore: Prepare v0.19.0-rc.2"`
4. `git tag v0.19.0-rc.2 && git push origin main v0.19.0-rc.2`
5. Monitor: https://github.com/jdutton/vibe-validate/actions

**IMPORTANT**: CHANGELOG `[Unreleased]` → `[X.Y.Z]` updates are ONLY for full releases, NEVER for pre-releases (rc, beta, alpha). The `bump-version` script enforces this automatically.

See `docs/automated-publishing.md` for RC vs stable behavior, troubleshooting.

## Security Requirements

### Command Execution Policy (MANDATORY)

**NEVER use `execSync()` anywhere**. Always use secure functions from `@vibe-validate/utils`:

- `safeExecSync(cmd, args, opts)` - Shell-free execution (prevents injection)
- `safeExecResult(cmd, args, opts)` - Returns result object (no throw)
- `isToolAvailable(tool)` - Check if command exists

**Path utilities** (Windows compatibility):
- `normalizedTmpdir()` - Use instead of `os.tmpdir()`
- `mkdirSyncReal(path, opts)` - Use instead of `fs.mkdirSync()`

### Domain-Specific Utilities

**MANDATORY**: All `git`/`gh` commands MUST use functions from `@vibe-validate/git`:
- Examples: `getTreeHash()`, `addNote()`, `fetchPRDetails()`, `getCurrentBranch()`
- **Never** call `safeExecSync('git', ...)` directly from other packages
- **Exception**: Test setup only (`.test.ts` files)

## Key Design Principles

1. **Language-Agnostic Core** - Works with Python, Rust, Go, etc.
2. **LLM-First Output** - Structured YAML, stripped ANSI codes
3. **Git Tree Hash Caching** - Deterministic, 312x speedup
4. **Fail-Safe Philosophy** - Never block the user
5. **Flexible Configuration** - YAML-driven, customizable

## Coding Standards

### TypeScript
- Strict mode, Node 20+, ESM modules
- **Type definitions**: Use Zod schemas for YAML-serializable types

### Testing
- **Vitest** for all tests
- **TDD REQUIRED**: Write failing test first, then implement
- **DRY enforcement**: < 3% duplication (monitored by `jscpd`)
  - Create helpers: `create*()`, `setup*()`, `expect*()` patterns
  - Module scope only (never inside describe blocks)
  - See `docs/testing-patterns.md` for details
- **Cross-platform**: Use `spawn('node', [command, ...])` pattern for CLI tests (Windows compatibility)
- **ESLint enforcement**: Custom rules enforce security (safeExec*) and architecture (git/gh via @vibe-validate/git)

### CLI User Experience
Use `getCommandName()` in error messages to match user's invocation (`vv` or `vibe-validate`).

### Documentation
- JSDoc for public APIs
- Auto-generate CLI docs: `pnpm generate-cli-docs`
- **Never manually edit** `docs/cli-reference.md`

## Development Workflow

### MANDATORY Steps for ANY Code Change

**CRITICAL**: After fixing errors, ALWAYS run `pnpm validate` again before asking to commit (cache makes it instant if correct, catches side effects if wrong).

1. **Create feature branch** (never work on main)
2. **Make changes**
3. **Run `pnpm validate`** → Fix errors → **Run `pnpm validate` again** → Repeat until passes
4. **Ask user permission** → Only after final validation passes
5. **Commit with proper format**
6. **Push to remote**

### Commit Workflow

**Step 1: Validate**
Run `pnpm validate`, fix errors, **run full validate again** (cached if no side effects).

**Step 2: Ask Permission**
Ask: "Ready to commit these changes?"

**Step 3: Commit**
```bash
git commit -m "type: description

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

**Step 3: Update CHANGELOG.md (for full releases only)**
- **Pre-releases (rc, beta, alpha)**: Keep changes under `[Unreleased]`, do NOT create version section
- **Full releases only**: Change `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD`
- Write for users, not developers
- Focus on user impact, not implementation details

## Contributing Guidelines

**CRITICAL**: Follow CONTRIBUTING.md:
- All changes via PRs (no direct main commits)
- Run `pnpm validate` before creating PR
- Conventional commits (feat:, fix:, docs:, test:, refactor:, chore:)
- TDD: Write test first, then implement

## Dogfooding

**You ARE the target user** - an AI agent helping developers. Use vibe-validate while building it:

- Use `vv run` for ad-hoc commands during development
- Use `vv watch-pr` instead of raw `gh` commands
- Validate constantly with `pnpm validate`
- **NEVER use `git commit --no-verify`** - fix issues instead

Every friction point you encounter is a bug to fix!

## Questions?

1. Refer to comprehensive documentation in `docs/` directory
2. Check existing test files for examples
3. Follow the design principles above
4. Ask the user if unclear

**Never ask to commit partially completed work with failing tests** - all tests and validation must pass to commit.
