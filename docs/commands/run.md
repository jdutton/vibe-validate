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

### During Development (AI Agents)
Instead of parsing verbose test output:
```bash
# Verbose (wastes context window)
npx vitest packages/extractors/test/vitest-extractor.test.ts

# Concise (LLM-friendly)
vibe-validate run "npx vitest packages/extractors/test/vitest-extractor.test.ts"
```

### Debugging Specific Tests
```bash
# Run single test file with extraction
vibe-validate run "npx vitest -t 'should extract failed tests'"

# Run package tests with extraction
vibe-validate run "pnpm --filter @vibe-validate/extractors test"
```

### Type Checking
```bash
# Extract TypeScript errors
vibe-validate run "npx tsc --noEmit"
```

### Linting
```bash
# Extract ESLint errors
vibe-validate run "pnpm lint"
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
$ vibe-validate run "pnpm test"
---                           # ← stdout (YAML)
command: pnpm test
exitCode: 0
extraction: {...}

> pkg@1.0.0 test             # ← stderr (preamble)
> vitest run
```

**Piped usage (only YAML):**
```bash
$ vibe-validate run "pnpm test" > results.yaml
# results.yaml contains ONLY pure YAML (no preamble)
```

**Suppress context:**
```bash
$ vibe-validate run "pnpm test" 2>/dev/null
# Shows only YAML (stderr suppressed)
```

## Package Manager Support

The `run` command automatically detects and handles package manager preambles:

- **pnpm**: `> package@1.0.0 script` → routed to stderr
- **npm**: `> package@1.0.0 script` → routed to stderr
- **yarn**: `$ command` → routed to stderr

This means you can safely use:
```bash
vibe-validate run "pnpm validate --yaml"  # Works!
vibe-validate run "npm test"              # Works!
vibe-validate run "yarn build"            # Works!
```

The YAML output on stdout remains clean and parseable, while the preamble is preserved on stderr for debugging.

## Nested Run Detection

When `run` wraps another vibe-validate command that outputs YAML, it intelligently merges the results:

```bash
# 2-level nesting
$ vibe-validate run "vibe-validate run 'npm test'"
---
command: vibe-validate run "npm test"
exitCode: 0
extraction: {...}
suggestedDirectCommand: npm test  # ← Unwrapped!
```

The `suggestedDirectCommand` field shows the innermost command, helping you avoid unnecessary nesting.

## Exit Codes

The `run` command passes through the exit code from the executed command:
- `0` - Command succeeded
- `1+` - Command failed (same code as original command)

## Examples

### Run Single Test File
```bash
vibe-validate run "npx vitest packages/cli/test/commands/run.test.ts"
```

### Run Specific Test Case
```bash
vibe-validate run "npx vitest -t 'should extract errors'"
```

### Run Package Tests
```bash
vibe-validate run "pnpm --filter @vibe-validate/core test"
```

### Type Check
```bash
vibe-validate run "npx tsc --noEmit"
```

### Lint
```bash
vibe-validate run "pnpm lint"
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
$ vibe-validate run "npx vitest test.ts"
---
command: "npx vitest test.ts"
exitCode: 1
extraction:
  errors:
    - file: "test.ts"
      line: 42
      message: "expected 5 to equal 3"
  summary: "1 test failed"
```

**Result**: Same information, 90% smaller!

