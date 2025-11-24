# Run Capability: Immediate Caching + Extraction

## Overview

The `vv run` capability provides **immediate benefits without any project configuration**. Just wrap any command to get:
- **312x speedup** via git tree hash caching
- **95% token reduction** via smart error extraction
- **Zero configuration** required

## Quick Start

```bash
# No installation needed
npx vibe-validate run <any-command>

# Examples
npx vibe-validate run npm test
npx vibe-validate run pytest
npx vibe-validate run gradle build
```

## After Installing

Once installed (`npm install vibe-validate` or `npm install -g vibe-validate`):

```bash
vv run <command>                # Shorthand
vibe-validate run <command>     # Full name

# Examples
vv run npm test
vv run pnpm typecheck
vv run ./gradlew build
```

## How It Works

### 1. Git Tree Hash Caching

```bash
# First run: executes command
vv run npm test

# Second run (no code changes): uses cache
vv run npm test  # Instant! (312x faster)

# After code change: re-runs automatically
vv run npm test  # Executes again
```

**Cache key:** Git tree hash of your code (deterministic, content-based)

**Force re-run:**
```bash
vv run --force npm test  # Skip cache
```

### 2. Error Extraction

**Without vibe-validate:**
```
# 1500+ lines of verbose test output
Running tests...
  ✓ test 1
  ✓ test 2
  ...
  ✗ test 42
    Expected: 5
    Received: 4
    at foo.test.ts:42:10
  ...
# (1400 more lines)
```

**With vibe-validate:**
```yaml
exitCode: 1
extraction:
  totalErrors: 1
  errors:
    - file: foo.test.ts
      line: 42
      column: 10
      message: "Expected: 5, Received: 4"
  summary: "1 test failure"
  guidance: "Fix assertion at foo.test.ts:42"
```

**Result:** 1500 tokens → 75 tokens (95% reduction)

## Supported Tools (Built-in Extractors)

vibe-validate automatically detects and extracts errors from:

- **TypeScript**: `tsc --noEmit`
- **ESLint**: All output formats
- **Vitest/Jest**: Test failures
- **Prettier**: Formatting issues
- **OpenAPI**: Validation errors
- **Maven**: Compilation errors, test failures
- **Generic**: Fallback for unknown tools

## YAML Output Format

```yaml
passed: false
command: npm test
exitCode: 1
durationSecs: 2.5
extraction:
  totalErrors: 3
  errors:
    - file: src/index.ts
      line: 42
      column: 5
      message: "error TS2322: Type 'string' is not assignable to type 'number'"
    - file: src/auth.ts
      line: 128
      column: 10
      message: "error TS2345: Argument of type 'null' is not assignable"
    - file: tests/foo.test.ts
      line: 15
      message: "Expected: 5, Received: 4"
  summary: "3 errors found"
  guidance: "Fix type errors in src/index.ts and src/auth.ts"
  metadata:
    detection:
      extractor: typescript
      confidence: 95
```

## When to Use

### ✅ Use `vv run` when:
- Running repetitive commands (tests, lint, build)
- Want immediate caching without configuration
- Need concise error output (LLM-friendly)
- Testing in any project (Node.js, Python, Java, etc.)

### ❌ Don't use `vv run` for:
- Interactive commands (`git log`, `npm init`)
- Watch modes (`npm run dev`, `vitest --watch`)
- Commands that already cache well
- One-time commands

## Common Patterns

### Pattern 1: Test-Driven Development
```bash
# Edit code
vim src/index.ts

# Run tests (fast if code unchanged, extracts errors)
vv run npm test

# Fix errors, re-run (fast due to cache)
vv run npm test
```

### Pattern 2: Pre-Commit Checks
```bash
# Run multiple checks
vv run npm test
vv run pnpm lint
vv run pnpm typecheck

# All cached if code unchanged!
```

### Pattern 3: Monorepo Testing
```bash
# Test all packages (caching per-package)
vv run pnpm -r test

# Only changed packages re-run
```

## Checking Cache Status

```bash
# Run command
vv run npm test

# Check if result is cached
vv run --check npm test

# Output:
# ✓ Cached (tree: a1b2c3d4...)
# Last run: 2 minutes ago
# exitCode: 0
```

## Advanced: Debugging Extraction

If errors aren't being extracted properly:

```bash
# 1. Check what extractor was used
vv run npm test  # Look for metadata.detection.extractor

# 2. If "generic" extractor used, may need custom extractor
# See: resources/extending-extraction.md

# 3. Force verbose output temporarily
npm test  # Run without vibe-validate to see raw output
```

## Transition to Full Adoption

Once you see the benefits with `vv run`, consider configuring the project:

```bash
# Install in project
npm install vibe-validate

# Initialize configuration
vv init

# Now `vv validate` runs full validation suite with caching
```

See: **resources/configure-project.md** for full adoption workflow.

## Related Documentation

- **Main docs:** `docs/error-extractors-guide.md` (comprehensive extractor documentation)
- **CLI reference:** `docs/cli-reference.md`
- **Extending extraction:** `resources/extending-extraction.md` (if errors not captured)
- **Project configuration:** `resources/configure-project.md` (adopt for team)
