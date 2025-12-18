# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the vibe-validate codebase.

## Project Overview

**vibe-validate** is a git-aware validation orchestration tool designed for LLM-assisted development (vibe coding). It caches validation state using git tree hashes, runs steps in parallel, and formats errors for LLM consumption.

**Target Users**: Developers using AI assistants (Claude Code, Cursor, Aider, Continue)

## Repository Structure

```
vibe-validate/
├── packages/
│   ├── utils/          # Common utilities (command execution, path helpers)
│   │   ├── safe-exec   # Security-critical command execution
│   │   ├── path-helpers# Cross-platform path normalization
│   ├── config/         # Configuration system (depends on: none)
│   ├── extractors/     # Error extraction & LLM optimization (depends on: config)
│   ├── git/            # Git workflow utilities (depends on: utils)
│   ├── core/           # Validation orchestration engine (depends on: config, git, extractors, utils)
│   ├── history/        # History tracking (depends on: core, git, utils)
│   ├── cli/            # Command-line interface (depends on: ALL)
│   └── vibe-validate/  # Umbrella package
├── docs/              # Comprehensive documentation
└── package.json       # Monorepo root
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests (LLM-optimized by default)
pnpm test              # Uses vibe-validate run (YAML + rawOutput)
pnpm test:watch        # Interactive watch mode (use npx vitest for raw output)

# Development mode (watch)
pnpm dev

# Code quality (LLM-optimized by default)
pnpm lint              # Uses vibe-validate run
pnpm typecheck         # Uses vibe-validate run

# Validation (MUST pass before commit)
pnpm validate --yaml   # Full validation with LLM-friendly output

# Check cached validation without re-running
pnpm exec vibe-validate validate --check --yaml

# Pre-commit workflow
pnpm pre-commit        # Branch sync + validation

# Health checks
pnpm exec vibe-validate doctor  # Diagnose setup issues (run after upgrade!)
```

## LLM-Optimized Testing (Use This!)

**CRITICAL for AI agents**: Use `vv run` to wrap test/validation commands. Saves 90-95% of context window by extracting only errors.

### Quick Pattern
```bash
vv run <any-command>
```

### Common Examples
```bash
# Test single file (instead of: npx vitest <file>)
vv run npx vitest packages/cli/test/commands/run.test.ts

# Test specific case (instead of: npx vitest -t "...")
vv run npx vitest -t 'should extract errors'

# Package tests (instead of: pnpm --filter @pkg test)
vv run pnpm --filter @vibe-validate/core test

# Type checking (instead of: pnpm typecheck)
vv run pnpm typecheck

# Linting (instead of: pnpm lint)
vv run pnpm lint

# Standard scripts are LLM-optimized by default
pnpm test        # Wraps vitest with run
pnpm test:system # Wraps system tests with run
pnpm lint        # Wraps eslint with run
pnpm typecheck   # Wraps tsc with run

# Ad-hoc commands (use the run script!)
pnpm run "npx vitest path/to/test.ts"
pnpm run "pnpm --filter @pkg test"
```

### Dogfooding During Development (CRITICAL!)

**AI agents and developers MUST use `vv run` while working on vibe-validate itself.**

**Why this matters:**
- You're building a tool to save context window for AI agents
- You ARE an AI agent working on this codebase
- Using the tool validates it works AND saves YOUR context window
- If you instinctively reach for raw commands, users will too

**Anti-pattern (what NOT to do):**
```bash
# ❌ Don't do this during development
npx vitest packages/cli/test/packaging.test.ts
pnpm --filter @vibe-validate/cli test
vitest run test/packaging.system.test.ts
```

**Correct pattern (use the tool you're building):**
```bash
# ✅ Always wrap with vv run during development
vv run npx vitest packages/cli/test/packaging.test.ts
vv run pnpm --filter @vibe-validate/cli test
pnpm test:system  # Already wrapped!
```

**When you catch yourself typing raw vitest/npm/pnpm commands, STOP and use vv run instead.**

### Output Format (YAML)
- `exitCode`: 0 (pass) or 1+ (fail)
- `errors[]`: File/line/message for each failure
- `summary`: "2 test failures"
- `guidance`: "Fix assertion at line 42"

**Token savings**: 1500 tokens → 75 tokens (95% reduction)

### When NOT to Use
- Watch modes (`pnpm test:watch`, `pnpm dev`)
- Already-extracted output (`pnpm validate`, `pnpm state`)
- Interactive commands (`git log`, `npm init`)

## Package Management

This is a **pnpm monorepo**. Each package in `packages/` is independently versioned and publishable.

### Adding Dependencies
```bash
# To a specific package
pnpm --filter @vibe-validate/core add <package>

# To workspace root (devDependencies)
pnpm add -Dw <package>
```

### Working on a Package
```bash
cd packages/core
pnpm test
pnpm build
```

### Version Management

**CRITICAL**: Always use the `bump-version` script to update versions across the monorepo. This ensures consistency across all packages and plugin files.

```bash
# Bump to explicit version
pnpm bump-version 0.15.0-rc.5

# Increment versions automatically
pnpm bump-version patch    # 0.15.0 → 0.15.1
pnpm bump-version minor    # 0.15.0 → 0.16.0
pnpm bump-version major    # 0.15.0 → 1.0.0
```

The script automatically updates:
- All workspace package.json files (cli, config, core, extractors, git, history, vibe-validate)
- Claude Code plugin manifest and marketplace config
- Preserves formatting and skips private packages

**After bumping**:
1. Rebuild: `pnpm -r build`
2. Commit: `git add -A && git commit -m "chore: Release vX.Y.Z"`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push origin main && git push origin vX.Y.Z`
5. Publish: See "Publishing" section below

## Publishing

### Automated Publishing (Primary Method)

**CRITICAL**: Publishing is now automated via GitHub Actions. **DO NOT use `pnpm publish:all` manually** unless automation fails.

**Normal Release Workflow:**

1. **Update CHANGELOG.md** (MANDATORY before release)
   - Add changes to appropriate version section
   - Format: `## [X.Y.Z] - YYYY-MM-DD`
   - Follow [Keep a Changelog](https://keepachangelog.com/) format

2. **Bump version**:
   ```bash
   pnpm bump-version 0.17.6-rc.1  # For RC
   pnpm bump-version 0.17.6       # For stable
   ```

3. **Commit and tag**:
   ```bash
   git add -A && git commit -m "chore: Release vX.Y.Z"
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

4. **Monitor GitHub Actions**:
   - Visit: https://github.com/jdutton/vibe-validate/actions
   - Workflow automatically publishes to npm and creates GitHub release

**Publishing Behavior:**
- **RC versions** (e.g., `v0.17.6-rc.1`): Publish to `@next` tag, NO GitHub release
- **Stable versions** (e.g., `v0.17.6`): Publish to `@latest`, update `@next` if newer, create GitHub release

### Manual Publishing (Fallback Only)

**Use only if automated publishing fails:**

```bash
# Ensure versions are correct
pnpm bump-version <version>

# Build all packages
pnpm -r build

# Run pre-publish checks
node tools/pre-publish-check.js

# Publish all packages (determines tag from version)
pnpm publish:all
```

**NEVER publish individual packages** - use `pnpm publish:all` or let automation handle it.

See [Automated Publishing Guide](docs/automated-publishing.md) for setup and troubleshooting.
See [Publishing Guide](docs/publishing.md) for manual recovery procedures.

## Code Quality Monitoring

### SonarCloud

- **Dashboard**: https://sonarcloud.io/project/issues?id=jdutton_vibe-validate
- **API**: https://sonarcloud.io/api/issues/search?componentKeys=jdutton_vibe-validate&types=BUG,VULNERABILITY,CODE_SMELL&resolved=false

Many issues are intentional (test fixtures) or false positives. Use `// NOSONAR` comments with explanations to suppress invalid warnings.

## Security Requirements

### Command Execution Policy (MANDATORY)

**NEVER use `execSync()` anywhere in the codebase.** Always use secure execution functions from `@vibe-validate/utils`.

**Security benefits:**
- No shell interpreter (eliminates command injection risk)
- Commands resolved via `which` (no PATH searching during execution)
- Arguments passed as arrays (no string interpolation)

**Available functions:**
- `safeExecSync(command, args, options)` - Execute and return output (throws on error)
- `safeExecResult(command, args, options)` - Execute and return result object (no throw)
- `safeExecFromString(commandString, options)` - Parse simple command strings
- `isToolAvailable(toolName)` - Check if command exists
- `getToolVersion(toolName)` - Get version string

**Implementation details:** See `packages/utils/src/safe-exec.ts` for usage patterns and `packages/utils/test/safe-exec.test.ts` for command injection test cases.

## Where to Put Utilities

### Production Utilities (@vibe-validate/utils)
Use `@vibe-validate/utils` for generic, non-domain-specific utilities:
- Command execution (safeExec*)
- File system helpers (path normalization, cross-platform)
- String utilities (if generic, not domain-specific)
- **Rule:** NO dependencies on other vibe-validate packages

#### Preferred Utilities (ALWAYS use these instead of built-ins)

**Command Execution (Security):**
- `safeExecSync(cmd, args, opts)` - Use instead of `execSync()`. Prevents command injection via shell-free execution.
- `safeExecResult(cmd, args, opts)` - Like safeExecSync but returns result object instead of throwing on error.
- `safeExecFromString(cmdString, opts)` - Parses simple command strings safely (no shell injection).
- `isToolAvailable(tool)` - Check if command exists. Better than catching exec errors.
- `getToolVersion(tool)` - Get version string safely.
- `hasShellSyntax(cmd)` - Detect shell syntax (pipes, redirects). Prevents accidental unsafe execution.

**Path Handling (Windows Compatibility):**
- `normalizedTmpdir()` - Use instead of `os.tmpdir()`. Resolves Windows 8.3 short names (RUNNER~1 → runneradmin).
- `mkdirSyncReal(path, opts)` - Use instead of `fs.mkdirSync()`. Creates directory and returns normalized path.
- `normalizePath(path)` - Resolves path to real (long) name. Prevents Windows path mismatch bugs.

**Why these matter:**
- Command utils prevent security vulnerabilities (command injection, PATH attacks)
- Path utils prevent "works on Mac, fails on Windows CI" bugs from 8.3 short name mismatches

### Domain-Specific Utilities
Place utilities in the appropriate domain package:
- **Git/GitHub utilities** → `@vibe-validate/git`
  - **MANDATORY**: All `git` command execution MUST use functions from `@vibe-validate/git`
  - **MANDATORY**: All `gh` (GitHub CLI) command execution MUST use functions from `@vibe-validate/git`
  - Examples: `getTreeHash()`, `addNote()`, `fetchPRDetails()`, `listPullRequests()`
  - **Benefits**: Centralized command execution, easy mocking in tests, architectural consistency
  - **Never**: Call `safeExecSync('git', ...)` or `safeExecSync('gh', ...)` directly from other packages
- Config utilities → `@vibe-validate/config`
- Extractor utilities → `@vibe-validate/extractors`
- Validation utilities → `@vibe-validate/core`

### Test Utilities
- Use production utilities from `@vibe-validate/utils` when possible
- Keep test-specific mocks/helpers in each package's `test/helpers/`
- **NO shared test utilities package** (use inline or duplicate if needed)

## Key Design Principles

### 1. Language-Agnostic Core
- Core engine executes ANY commands (not just npm scripts)
- TypeScript/JavaScript templates are just example configurations
- Works with Python, Rust, Go, etc.

### 2. LLM-First Output
- Detect agent context (Claude Code, Cursor, etc.)
- Strip ANSI codes and noise from errors
- Provide actionable guidance and concise extracted errors in structured YAML format

### 3. Git Tree Hash Caching
- Uses deterministic `git write-tree` approach for content-based hashing
- Same code content always produces same hash (no timestamps)
- Provides 312x speedup on unchanged code (validated in production)

### 4. Fail-Safe Philosophy
- Validation always proceeds (never block the user)
- Lock creation failure → proceed without lock
- Git command failure → use timestamp fallback

### 5. Flexible Configuration with Smart Defaults
- Works out-of-box with minimal template
- Templates for common project types (TypeScript library, Node.js, React)
- Fully customizable via YAML config

## Coding Standards

### TypeScript
- Strict mode enabled
- Node 20+ target (use modern features)
- ESM modules (not CommonJS)
- Explicit return types for public APIs
- **Type definitions**: All YAML-serializable types MUST be Zod schemas (never manual interfaces). Use `z.infer<>` to derive TypeScript types. Manual interfaces only for non-serializable data (callbacks, functions).

### Testing
- **Vitest** for all tests (fast, TypeScript-native)
- Unit tests for all public APIs
- Integration tests for workflows
- Mock git commands (don't require real git repo)
- **ALWAYS follow DRY and shift-left principles. Validate before committing.**
- **NO EXCUSES: If you find a problem during your work, fix it. Follow the "Boy Scout Rule" - leave code better than you found it.**
- **Test-Driven Development (TDD) REQUIRED**: All features and bug fixes MUST follow TDD:
  1. Write failing tests FIRST that demonstrate the desired behavior
  2. Run tests to confirm they fail for the right reason
  3. Implement the minimum code to make tests pass
  4. Refactor while keeping tests green
  - **Why TDD is critical**: Prevents regressions, validates requirements, enables confident refactoring
  - **No exceptions**: Features without tests will not be merged

### Error Handling
- Always provide context in error messages
- Never throw without explanation
- Log errors with structured data
- Provide recovery suggestions

### CLI User Experience
**CRITICAL**: All user-facing command names MUST use `getCommandName()` to reflect how the user invoked the CLI.

```typescript
import { getCommandName } from '../utils/command-name.js';

// In error messages, usage strings, and guidance
const cmd = getCommandName(); // Returns "vv" or "vibe-validate"
console.error(`Usage: ${cmd} watch-pr <pr-number>`);
console.log(`Run: ${cmd} validate`);
```

**When to use `getCommandName()`:**
- ✅ **Immediate user feedback**: Error messages, usage strings when user makes a mistake
- ✅ **Action suggestions**: "Run: ${cmd} validate", "Try: ${cmd} doctor"
- ✅ **Help output**: Command-specific help messages (e.g., `vv run --help`)
- ❌ **Verbose documentation**: Comprehensive `--help --verbose` output (use canonical "vibe-validate")
- ❌ **Example repo names**: `--repo jdutton/vibe-validate` (not a command)
- ❌ **Package.json scripts**: Keep as "vibe-validate" for clarity in scripts

**Why this matters**: Users might invoke via `vv` or `vibe-validate`. Error messages should match what they typed, not confuse them with a different command name.

**Implementation**: The smart wrapper (`bin/vibe-validate.ts`) sets `VV_COMMAND_NAME` environment variable. The utility checks this first, then falls back to `process.argv[1]` for direct invocations.

### Documentation
- JSDoc comments for all exported functions
- Include examples in comments
- Document edge cases and limitations
- Keep docs up-to-date with code

### CLI Documentation
**CRITICAL**: When modifying CLI commands or help text:

1. **Always use the doc generator tool**:
   ```bash
   node tools/generate-cli-docs.js
   # OR
   pnpm generate-cli-docs
   ```

2. **Never manually edit `docs/skill/resources/cli-reference.md`**
   - This file is auto-generated from `--help --verbose` output
   - Manual edits will be overwritten
   - A test enforces this (will fail if docs don't match CLI output)

3. **Update command-specific docs in `docs/commands/`**
   - These are generated from verbose help functions
   - Example: `run --help --verbose` → `docs/commands/run.md`

## Contributing Guidelines

**CRITICAL**: All contributors (humans and AI agents) MUST follow the guidelines in [CONTRIBUTING.md](CONTRIBUTING.md).

### Key Requirements from CONTRIBUTING.md

1. **Pull Request Process** (Section: Submitting Changes)
   - All changes via PRs (no direct main commits)
   - Run `pnpm validate` before creating PR
   - Update documentation for feature changes
   - Include testing approach in PR description

2. **Code Quality Standards** (Section: Pre-Commit Checklist)
   - ✅ All tests pass (`pnpm test`)
   - ✅ ESLint clean (0 errors, 0 warnings)
   - ✅ TypeScript compiles (`pnpm typecheck`)
   - ✅ Coverage maintained (80%+)
   - ✅ Builds successfully (`pnpm -r build`)
   - ✅ Validation passes (`pnpm validate`)

3. **Commit Message Format** (Section: Commit Message Format)
   - Follow conventional commits (feat:, fix:, docs:, test:, refactor:, chore:)
   - Include clear description of changes

4. **PR Template** (Section: Pull Request Process)
   - Summary of changes
   - Testing approach
   - Coverage verification
   - Breaking changes (if any)

5. **TDD Requirements** (Section: Writing Tests)
   - Write failing test first
   - Implement feature
   - Verify test passes
   - Refactor while keeping tests green

**Read CONTRIBUTING.md in full** before making any changes to ensure compliance.

## Source of Truth

### Configuration
All validation logic is data-driven:
- No hardcoded commands
- User provides validation phases via config
- Templates are just example configs to copy and customize

### State Management
Validation state tracked via **git notes** (content-based caching):
- Query current state: `vibe-validate state`
- View history timeline: `vibe-validate history list`
- Git notes storage (implementation detail - users don't touch directly)
- Provides agent-friendly YAML output
- See `docs/git-validation-tracking.md` for architecture details

## Common Tasks

### Add a New Package
1. Create `packages/<name>/` directory
2. Add `package.json` with proper name (@vibe-validate/<name>)
3. Add `tsconfig.json` extending root config
4. Create `src/` and `test/` directories
5. Update root `pnpm-workspace.yaml` if needed

### Test Locally
```bash
# Link for local testing
cd packages/cli
pnpm link --global

# Test in another project
cd ~/some-project
vibe-validate init
```

## Development Workflow

### **MANDATORY Steps for ANY Code Change**
**Every commit must follow this process - no exceptions:**

1. **Create feature branch** (never work on main)
2. **Make your changes**
3. **Run validation locally** (`pnpm validate`)
4. **Ask user permission before committing** (MANDATORY)
5. **Commit with proper message format**
6. **Push to remote**

**Tip**: Use `act` to debug CI environment differences locally before pushing (requires Docker)

### Branch Management Requirements
**CRITICAL**: All changes MUST be made on feature branches, never directly on `main`.

#### Creating Feature Branches
1. **Always branch from main**: `git checkout main && git pull origin main`
2. **Create descriptive branch name**:
   - `feature/add-new-extractor` - for new features
   - `fix/git-hash-determinism` - for bug fixes
   - `docs/update-api-reference` - for documentation
   - `refactor/simplify-config` - for refactoring
3. **If branch topic is unclear**: ASK the user for clarification before proceeding

#### Commit and Push Workflow

**Step 1: Ask Permission (MANDATORY)**
**CRITICAL**: Claude Code MUST ask user permission before committing:
- Ask: "Ready to commit these changes?"
- Only proceed if user explicitly grants permission
- NEVER auto-commit

**Step 2: Commit (Only After Permission)**
```bash
git commit -m "descriptive message

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

**Step 3: Push (Only After Commit Permission)**
```bash
git push origin <branch-name>
```

**Step 4: Update CHANGELOG.md (MANDATORY for releases)**
**CRITICAL**: Before releasing any version (patch, minor, or major), MUST update CHANGELOG.md:
- Add changes to the "Unreleased" section during development
- Move "Unreleased" to versioned section (e.g., "## [0.9.11] - 2025-10-18") when releasing
- Follow format: Bug Fixes, Features, Documentation, Breaking Changes
- Include issue/PR references where applicable
- **NEVER release without updating CHANGELOG**

**CHANGELOG Writing Guidelines - User Focus**:
- **Write for users, not developers**: Focus on user impact, not implementation details
- **Avoid internal details**: No function names, file paths, test counts, or code references
- **Structure entries as**: Problem → Solution → Impact
- **Use clear language**: Explain what was broken and what's fixed
- **Examples**:
  - ❌ Bad: "Updated `init.ts` to generate YAML configs using `generateYamlConfig()` function"
  - ✅ Good: "`vibe-validate init` now correctly generates YAML config files"
  - ❌ Bad: "Added 11 new tests for schema validation"
  - ✅ Good: "Fixed IDE autocomplete for YAML configs"

Example CHANGELOG entry:
```markdown
## [Unreleased]

### Bug Fixes
- **CRITICAL: Fixed broken `init` command** (Issue #12)
  - **Problem**: `vibe-validate init` was creating `.ts` config files that couldn't be loaded
  - **Solution**: Now correctly generates `vibe-validate.config.yaml` files
  - **Impact**: New users can now successfully initialize and use vibe-validate
```

### Git History Management
**Best Practices:**
- Review commit messages for clarity
- Squash related commits when appropriate
- Use conventional commit format (feat:, fix:, docs:, etc.)
- Keep commits focused and atomic

### Pull Request Workflow
- **Update CHANGELOG.md BEFORE creating PR** - Write for users of the project, NOT developers (1-2 lines, no internal details)
- **No direct pushes to main** - ALL changes must go through pull requests
- **Branch naming convention**: `type/brief-description`
- **All validation must pass** before merge approval

## Testing Philosophy

### Unit Tests
- Test each function in isolation
- Mock external dependencies (fs, child_process, etc.)
- Fast (< 100ms total for package)
- No real git operations

### Integration Tests
- Test package interactions
- May use real git commands (in temp dir)
- Test actual validation workflows
- Medium speed (< 5s total)

### Manual Testing
- Test with multiple projects
- Test agent context detection
- Test error formatting with real tools
- Verify caching behavior

## Documentation Standards

### Code Comments
- Explain WHY, not WHAT (code shows what)
- Document edge cases and gotchas
- Include examples for complex functions
- Keep comments up-to-date

### README Files
- Show current state only (not progress)
- Include quick start
- Show common use cases
- Link to detailed docs

### API Documentation
- TypeScript types are self-documenting
- Add JSDoc for public APIs
- Include parameter descriptions
- Show example usage

## Dogfooding: Testing vibe-validate While Building It

**CRITICAL FOR DEVELOPMENT**: You (Claude Code) are now **actively using vibe-validate** to validate this project. This is intentional dogfooding to test LLM-friendliness.

### What to Watch For

Every time you run tests, validation, or encounter errors, ask yourself:

1. **Is the error output concise?**
   - ✅ Good: 4-5 lines showing what failed and next steps
   - ❌ Bad: 200+ lines of verbose test output or stack traces

2. **Is the guidance actionable?**
   - ✅ Good: "Run `pnpm lint` to see details" or "Check state: `vibe-validate state`"
   - ❌ Bad: Generic errors with no recovery path

3. **Does it respect your context window?**
   - ✅ Good: Complete error details in YAML output, not in terminal
   - ❌ Bad: Spamming terminal with verbose logs

4. **Is the workflow deterministic?**
   - ✅ Good: Same input → same output, no flaky validation
   - ❌ Bad: Random cache invalidation or inconsistent results

5. **Is the caching transparent?**
   - ✅ Good: Clear when validation is skipped and why
   - ❌ Bad: Mysterious behavior or stale results

### How to Provide Feedback

**When you notice something that could be improved:**

1. **Capture the experience** - Note exactly what was confusing or verbose
2. **Identify the root cause** - Which package/command caused the issue?
3. **Suggest a fix** - How would you make it more LLM-friendly?
4. **Raise as improvement opportunity** - Create GitHub issue or discuss with user

### Think Like a Consumer While Developing

**CRITICAL MINDSET**: While developing vibe-validate, you ARE the target user - an AI agent helping developers. Always evaluate features from the consumer perspective:

1. **After implementing any feature, ask yourself:**
   - Would I find this helpful as an AI assistant using vibe-validate?
   - Is the output format optimized for my consumption?
   - Does this reduce context window usage?
   - Is the error message actionable without additional research?
   - Would a human developer understand this quickly?

2. **Proactively suggest improvements:**
   - **Don't wait to be asked** - if you see an opportunity to improve LLM-friendliness, propose it
   - Create GitHub issues for ideas (even if not implementing immediately)
   - Think about discoverability (docs, help output, error messages)
   - Consider both human and LLM workflows

3. **Test your own work like a user would:**
   - Run the commands you just implemented
   - Read the help output - is it complete?
   - Look at error messages - are they clear?
   - Check if docs match reality

4. **Examples of consumer-first thinking:**
   - ✅ "This error needs exit codes documented so agents know what success/failure means"
   - ✅ "The help output should include examples so agents see real usage patterns"
   - ✅ "This workflow section would help agents understand command sequencing"
   - ✅ "Auto-generating docs from --help ensures accuracy and discoverability"

**Remember**: Every time you use vibe-validate while developing it, you're gathering real-world feedback. Use it!

### NEVER Bypass Validation

**CRITICAL RULE**: If you find yourself needing `git commit --no-verify`, you have FAILED customers and the project.

- ✅ **Do**: Fix the issue causing validation to fail
- ✅ **Do**: Sync with origin/main using proper workflow (stash → merge → unstash)
- ❌ **Never**: Use `--no-verify` to skip pre-commit checks
- ❌ **Never**: Bypass validation "just this once"

**Why it matters**: Every `--no-verify` is a signal that vibe-validate is blocking legitimate work. If YOU can't use it properly while building it, customers won't either.

### ALWAYS Use watch-pr for CI Monitoring

**CRITICAL**: When monitoring CI checks for pull requests, ALWAYS use `vv watch-pr` commands. NEVER revert to raw `gh` commands.

**Why this matters:**
- `vv watch-pr` provides LLM-optimized output (concise, structured YAML)
- It includes error extraction and actionable guidance
- It demonstrates the tool's value while you develop it
- Using raw `gh` commands defeats the purpose of watch-pr and misses opportunities to improve it

**Correct usage:**
```bash
# ✅ Monitor PR status (auto-detect PR from branch)
vv watch-pr

# ✅ Monitor specific PR
vv watch-pr 92

# ✅ View PR history
vv watch-pr 92 --history

# ✅ Inspect specific run for extraction testing
vv watch-pr 92 --run-id 20328421613

# ✅ Get YAML output for parsing
vv watch-pr 92 --yaml
```

**NEVER do this:**
```bash
# ❌ Don't bypass watch-pr with raw gh commands
gh pr view 92
gh run list --branch feature/my-branch
gh run view 20328421613 --log
```

**If watch-pr is missing features you need:**
1. Use watch-pr anyway to understand the gap
2. Document what's missing
3. Implement the missing feature in watch-pr
4. Then use the improved watch-pr

**Remember**: You're both the developer AND the user. Every time you reach for `gh` commands instead of `vv watch-pr`, you're missing a chance to validate and improve the tool.

### Example Scenarios

**Good Experience:**
```bash
$ pnpm validate
✓ Pre-Qualification (2.1s)
✗ Testing (0.8s)
Failed: typecheck

📋 View error details: vibe-validate state
```
→ **Concise, actionable, respects context window**

**Bad Experience (hypothetical):**
```bash
$ pnpm validate
[verbose server startup logs]
[200 lines of test output]
[stack traces]
Error: Tests failed
```
→ **Opportunity**: Add better output filtering or improve agent context detection

### Constructive Improvement Process

When you identify an opportunity:

1. **Document it** - Write down the specific issue
2. **Propose solution** - How would you fix it?
3. **Estimate impact** - Is this CRITICAL, HIGH, MEDIUM, or LOW priority?
4. **Create issue or discuss** - Raise with user or create GitHub issue

**Remember**: Your experience as an AI agent IS the product validation. Every friction point you encounter is a bug to fix.

## Questions?

If Claude Code encounters ambiguity:
1. Refer to comprehensive documentation in `docs/` directory
2. Check existing test files for examples
3. Follow the design principles above
4. Ask the user if unclear
- Never ever ask to commit partially completed work with failing tests - all tests and validate must pass to commit
