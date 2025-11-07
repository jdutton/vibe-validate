# run Command Reference

> Run a command and extract LLM-friendly errors

## Overview

The `run` command executes any shell command and extracts errors using vibe-validate's smart extractors. This provides concise, structured error information to save AI agent context windows.

## How It Works

1. **Executes command** in a shell subprocess
2. **Captures output** (stdout + stderr)
3. **Auto-detects format** (vitest, jest, tsc, eslint, etc.)
4. **Extracts errors** using appropriate extractor
5. **Outputs YAML** with structured error information
6. **Passes through exit code** from original command

## Use Cases

### Python Testing
```bash
# Run pytest with coverage
vv run pytest tests/ --cov=src

# Run specific test
vv run pytest -k test_authentication --verbose

# Run unittest discovery
vv run python -m unittest discover
```

### Rust Testing
```bash
# Run all cargo tests
vv run cargo test

# Run with all features
vv run cargo test --all-features

# Run clippy for linting
vv run cargo clippy -- -D warnings
```

### Go Testing
```bash
# Run all tests
vv run go test ./...

# Run with race detection
vv run go test -v -race ./pkg/...

# Run go vet
vv run go vet ./...
```

### Node.js/TypeScript
```bash
# Run tests
vv run npm test
vv run npx vitest packages/cli/test/commands/run.test.ts

# Type checking
vv run npx tsc --noEmit

# Linting
vv run pnpm lint
```

## Output Format

YAML structure:
```yaml
---
command: "npx vitest test.ts"
exitCode: 1
extraction:
  errors:
    - file: "test.ts"
      line: 42
      message: "expected 5 to equal 3"
  summary: "1 test failed"
  guidance: "Review test assertions and expected values"
  cleanOutput: |
    test.ts:42 - expected 5 to equal 3
rawOutput: "... (truncated)"
```

## Stream Output Behavior

**IMPORTANT**: The `run` command separates structured data from context noise:

- **stdout**: Pure YAML (clean, parseable, pipeable)
- **stderr**: Package manager preamble + warnings (human context)

### Examples

**Terminal usage (both streams visible):**
```bash
$ vv run pnpm test
---                           # ← stdout (YAML)
command: pnpm test
exitCode: 0
extraction: {...}

> pkg@1.0.0 test             # ← stderr (preamble)
> vitest run
```

**Piped usage (only YAML):**
```bash
$ vv run pnpm test > results.yaml
# results.yaml contains ONLY pure YAML (no preamble)
```

**Suppress context:**
```bash
$ vv run pnpm test 2>/dev/null
# Shows only YAML (stderr suppressed)
```

## Package Manager Support

The `run` command automatically detects and handles package manager preambles:

- **pnpm**: `> package@1.0.0 script` → routed to stderr
- **npm**: `> package@1.0.0 script` → routed to stderr
- **yarn**: `$ command` → routed to stderr

This means you can safely use:
```bash
vv run pnpm validate --yaml  # Works!
vv run npm test              # Works!
vv run yarn build            # Works!
```

The YAML output on stdout remains clean and parseable, while the preamble is preserved on stderr for debugging.

## Nested Run Detection

When `run` wraps another vibe-validate command that outputs YAML, it automatically unwraps to show the actual command:

```bash
# 2-level nesting
$ vv run vv run npm test
---
command: npm test  # ← Automatically unwrapped!
exitCode: 0
extraction: {...}
```

The `command` field shows the innermost command that actually executed, helping you avoid unnecessary nesting.

## Caching (v0.15.0+)

The `run` command automatically caches successful command executions to avoid re-running expensive operations:

### How It Works

1. **First run**: Command executes, result stored in git notes
2. **Subsequent runs**: If code unchanged (same tree hash), returns cached result instantly

### Cache Hit Example

```bash
# First run - executes command
$ vv run pnpm lint
---
exitCode: 0
durationSecs: 5.42    # ← Actual execution time

# Second run - cache hit!
$ vv run pnpm lint
---
exitCode: 0
durationSecs: 0       # ← Instant (cached)
isCachedResult: true  # ← Cache indicator
```

### Cache Invalidation

Cache automatically invalidates when:
- **Code changes**: Different tree hash = different cache key
- **Command changes**: Different command = different cache key
- **Working directory changes**: Different workdir = different cache key

### Force Re-execution

Bypass cache with `--force` flag:
```bash
vv run --force npm test
```

### Implementation Details

For technical details on cache key generation and storage structure, see:
- [Git-Based Validation Tracking: Run Command Caching](../git-validation-tracking.md#4-run-command-caching-v0150)

## Exit Codes

The `run` command passes through the exit code from the executed command:
- `0` - Command succeeded
- `1+` - Command failed (same code as original command)

## Examples

### Python Testing
```bash
vv run pytest tests/ --cov=src
vv run pytest -k test_auth --verbose
vv run python -m unittest discover
```

### Rust Testing
```bash
vv run cargo test
vv run cargo test --all-features
vv run cargo clippy -- -D warnings
```

### Go Testing
```bash
vv run go test ./...
vv run go test -v -race ./pkg/...
vv run go vet ./...
```

### Node.js/TypeScript
```bash
vv run npm test
vv run npx vitest packages/cli/test/commands/run.test.ts
vv run npx tsc --noEmit
vv run pnpm lint
```

## Supported Extractors

The command auto-detects and uses appropriate extractors:
- **TypeScript** (tsc) - Type errors with file/line/message
- **ESLint** - Lint errors with rules and suggestions
- **Vitest** - Test failures with assertion details
- **Jest** - Test failures with stack traces
- **Mocha** - Test failures with hooks
- **Jasmine** - Test failures with specs
- **JUnit XML** - CI test results
- **Generic** - Fallback for unknown formats

## Integration with AI Agents

This command is designed specifically for AI agents (Claude Code, Cursor, etc.):

1. **Context Window Savings**: Extracts only essential error info (90% reduction)
2. **Structured Output**: YAML format is easily parseable
3. **Actionable Guidance**: Provides fix suggestions
4. **Exit Code Handling**: Proper error propagation

## Comparison

### Without `run` command:
```bash
$ npx vitest test.ts
[200+ lines of verbose output with stack traces, timing info, etc.]
```

### With `run` command:
```bash
$ vv run npx vitest test.ts
---
command: npx vitest test.ts
exitCode: 1
extraction:
  errors:
    - file: "test.ts"
      line: 42
      message: "expected 5 to equal 3"
  summary: "1 test failed"
```

**Result**: Same information, 90% smaller!

