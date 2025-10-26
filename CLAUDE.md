# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the vibe-validate codebase.

## Project Overview

**vibe-validate** is a git-aware validation orchestration tool designed for LLM-assisted development (vibe coding). It caches validation state using git tree hashes, runs steps in parallel, and formats errors for LLM consumption.

**Target Users**: Developers using AI assistants (Claude Code, Cursor, Aider, Continue)

## Repository Structure

```
vibe-validate/
├── packages/
│   ├── core/          # Validation orchestration engine
│   ├── git/           # Git workflow utilities
│   ├── extractors/    # Error extraction & LLM optimization
│   ├── config/        # Configuration system with schema validation
│   └── cli/           # Command-line interface
├── config-templates/  # YAML configuration templates
├── docs/              # Comprehensive documentation
└── package.json       # Monorepo root
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Development mode (watch)
pnpm dev

# Code quality
pnpm lint              # ESLint checking
pnpm typecheck         # TypeScript type checking

# Validation (MUST pass before commit)
pnpm validate --yaml   # Full validation with LLM-friendly output

# Check cached validation without re-running
pnpm exec vibe-validate validate --check --yaml

# Pre-commit workflow
pnpm pre-commit        # Branch sync + validation

# Health checks
pnpm exec vibe-validate doctor  # Diagnose setup issues (run after upgrade!)
```

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

## Key Design Principles

### 1. Language-Agnostic Core
- Core engine executes ANY commands (not just npm scripts)
- TypeScript/JavaScript templates are just example configurations
- Works with Python, Rust, Go, etc.

### 2. LLM-First Output
- Detect agent context (Claude Code, Cursor, etc.)
- Strip ANSI codes and noise from errors
- Provide actionable guidance in structured format (YAML/JSON)
- Embed errors directly in state file (no log hunting)

### 3. Git Tree Hash Caching
- Uses deterministic `git write-tree` approach for content-based hashing
- Same code content always produces same hash (no timestamps)
- Provides 312x speedup on unchanged code (validated in production)

### 4. Fail-Safe Philosophy
- Validation always proceeds (never block the user)
- Lock creation failure → proceed without lock
- Git command failure → use timestamp fallback
- Corrupted state file → proceed with validation

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

### Testing
- **Vitest** for all tests (fast, TypeScript-native)
- Unit tests for all public APIs
- Integration tests for workflows
- Mock git commands (don't require real git repo)
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

### Documentation
- JSDoc comments for all exported functions
- Include examples in comments
- Document edge cases and limitations
- Keep docs up-to-date with code

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
   - ✅ Good: Complete error details in state file, not in terminal
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