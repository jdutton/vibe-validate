# vibe-validate-run

**Universal skill for wrapping test/validation commands with LLM-friendly output extraction.**

## Purpose

Automatically wrap test, lint, typecheck, and other validation commands with `vibe-validate run` to:
- Extract only relevant errors (90-95% context window savings)
- Provide structured YAML output for easy parsing
- Cache results based on git tree hash
- Save time on unchanged code

## When to Use

**Auto-trigger on these commands** (if not already wrapped):
- Test commands: `pytest`, `vitest`, `jest`, `mocha`, `go test`, `cargo test`, `npm test`, `pnpm test`
- Linters: `eslint`, `pylint`, `rubocop`, `cargo clippy`
- Type checkers: `tsc`, `mypy`, `flow`
- Formatters: `prettier --check`, `black --check`
- Build commands (when checking for errors): `npm run build`, `cargo build`, `go build`

**Do NOT wrap**:
- Watch modes (`vitest --watch`, `jest --watch`)
- Interactive commands (`git log`, `npm init`)
- Commands that already use vibe-validate internally
- Commands that stream output to the user

## Context Detection & Usage

### Context 1: Project with vibe-validate script (Node.js projects with setup)
**Detection**: `package.json` exists with `"vibe-validate"` script

**Usage**:
```bash
pnpm vibe-validate run "<command>"
# or
npm run vibe-validate -- run "<command>"
```

**Example**:
```bash
# Instead of: npx vitest
pnpm vibe-validate run "npx vitest"
```

### Context 2: Node.js project without vibe-validate script
**Detection**: `package.json` exists but no `vibe-validate` script

**Usage**:
```bash
npx vibe-validate run "<command>"
# or if pnpm is available
pnpm exec vibe-validate run "<command>"
```

**Example**:
```bash
# Instead of: npm test
npx vibe-validate run "npm test"
```

### Context 3: Non-Node.js project
**Detection**: No `package.json` in project root

**Usage**:
```bash
npx vibe-validate run "<command>"
```

**Example**:
```bash
# Python project - instead of: pytest
npx vibe-validate run "pytest"

# Rust project - instead of: cargo test
npx vibe-validate run "cargo test"

# Go project - instead of: go test ./...
npx vibe-validate run "go test ./..."
```

## Autonomous Behavior

When you (Claude Code) see a test/validation command that would benefit from extraction:

1. **Detect context** (which of the 3 contexts above)
2. **Wrap the command automatically** without asking permission
3. **Explain briefly** what you're doing and why

### Example Conversation Flow

**User**: "Run the tests"

**You**:
```
I'll run the tests through vibe-validate to extract only errors and save context window:

<uses Bash tool to run: pnpm vibe-validate run "vitest run">

The tests completed with 2 failures. Here's the concise output:
- packages/core/test/runner.test.ts:42 - Assertion failed: expected true, got false
- packages/cli/test/commands/run.test.ts:150 - TypeError: Cannot read property 'exitCode' of undefined

Let me fix these issues...
```

## Decision Tree

```
Is user running a test/validation command?
├─ Yes
│  └─ Is it already wrapped with vibe-validate?
│     ├─ Yes → Run as-is
│     └─ No → Check context
│        ├─ Has vibe-validate script? → Use pnpm vibe-validate run
│        ├─ Is Node.js project? → Use npx vibe-validate run
│        └─ Non-Node.js? → Use npx vibe-validate run
└─ No → Run command normally
```

## Benefits You Provide

When using this skill, you:
1. **Save your own context window** - only see relevant errors
2. **Get structured output** - YAML format with file paths, line numbers, error messages
3. **Speed up iteration** - cached results when code hasn't changed
4. **Provide better help** - concise error summaries make it easier to suggest fixes

## Output Format

When wrapped, commands return YAML like this:
```yaml
command: vitest run
exitCode: 1
timestamp: 2025-11-02T10:30:45.123Z
extraction:
  errors:
    - file: packages/core/test/runner.test.ts
      line: 42
      message: "Assertion failed: expected true, got false"
  summary: "1 test failure"
  totalCount: 1
  guidance: "Fix the assertion at line 42"
metadata:
  confidence: 95
  completeness: 100
```

## Installation Context

Users don't need vibe-validate installed if using `npx`:
- `npx vibe-validate` temporarily installs and runs
- Best practice: recommend users add to devDependencies for faster execution
- For non-Node.js projects: npx is the easiest path

## Notes

- This skill is **project-agnostic** - works with any language/framework
- Always prefer using the project's vibe-validate script if available (fastest)
- Don't wrap commands that are already in watch mode or interactive
- Cache is automatically invalidated when code changes (git tree hash)
