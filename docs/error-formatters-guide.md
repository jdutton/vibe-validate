# Error Formatters Guide

Learn how vibe-validate formats error output for optimal human and AI assistant readability.

## Table of Contents

- [What are Error Formatters?](#what-are-error-formatters)
- [Supported Tools](#supported-tools)
- [How Formatting Works](#how-formatting-works)
- [Formatter Details](#formatter-details)
- [Agent-Friendly Output](#agent-friendly-output)
- [Custom Formatters](#custom-formatters)
- [Troubleshooting](#troubleshooting)

## What are Error Formatters?

Error formatters parse validation output and extract actionable error information for humans and AI assistants.

**Purpose:**
- **Noise Reduction**: Extract only relevant error information
- **Actionability**: Provide clear next steps for fixing issues
- **Agent Optimization**: Format errors for AI assistant consumption
- **Consistency**: Uniform error format across all tools

**Benefits:**
- 📊 **Concise Output** - Only show what matters
- 🎯 **File:Line Context** - Jump directly to error locations
- 🤖 **AI-Friendly** - Optimized for Claude Code, Cursor, etc.
- 🔧 **Tool-Specific** - Understand each tool's error format

## Supported Tools

vibe-validate includes formatters for common development tools:

| Tool | Formatter | Detection |
|------|-----------|-----------|
| TypeScript (`tsc`) | `typescript-formatter` | Step name contains "TypeScript" or "tsc" |
| ESLint | `eslint-formatter` | Step name contains "ESLint" or "eslint" |
| Vitest | `vitest-formatter` | Step name contains "Vitest", "test", "Test" |
| Jest | `vitest-formatter` | Step name contains "Jest" or "jest" |
| OpenAPI | `openapi-formatter` | Step name contains "OpenAPI" or command contains "swagger" |
| Generic | `generic-formatter` | Fallback for unknown tools |

**Auto-Detection**: vibe-validate automatically selects the appropriate formatter based on step name or command.

## How Formatting Works

### 1. Command Execution

vibe-validate runs your validation command and captures stdout/stderr:

```bash
tsc --noEmit
```

**Raw Output (verbose):**
```
src/index.ts:42:5 - error TS2322: Type 'string' is not assignable to type 'number'.

42     count: "five",
       ~~~~~

  src/types.ts:12:3
    12   count: number;
         ~~~~~
    The expected type comes from property 'count' which is declared here on type 'Config'


Found 1 error in src/index.ts:42
```

### 2. Error Parsing

The TypeScript formatter extracts:
- File path: `src/index.ts`
- Line number: `42`
- Column: `5`
- Error code: `TS2322`
- Message: `Type 'string' is not assignable to type 'number'`

### 3. Formatted Output

**Human-readable:**
```
❌ TypeScript
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
src/index.ts:42:5 - error TS2322
  Type 'string' is not assignable to type 'number'
```

**Agent-friendly (YAML):**
<!-- validation-result:partial -->
```yaml
failedStep: TypeScript
failedStepOutput: |
  src/index.ts:42:5 - error TS2322
  Type 'string' is not assignable to type 'number'
```

## Formatter Details

### TypeScript Formatter

**Handles:** `tsc --noEmit` output

**Extracts:**
- File path and location (file:line:column)
- Error code (e.g., TS2322, TS2345)
- Error message
- Context from related locations

**Example:**
```
Input:
  src/index.ts:42:5 - error TS2322: Type 'string' is not assignable to type 'number'.

Output:
  src/index.ts:42:5 - error TS2322
  Type 'string' is not assignable to type 'number'
```

**Line Pattern:**
```regex
/^(.+?)\((\d+),(\d+)\): error TS(\d+):/
/^(.+?):(\d+):(\d+) - error TS(\d+):/
```

---

### ESLint Formatter

**Handles:** `eslint` output (all formats)

**Extracts:**
- File path and location (file:line:column)
- Rule name (e.g., no-unused-vars, @typescript-eslint/no-explicit-any)
- Error message
- Severity (error/warning)

**Example:**
```
Input:
  /path/to/src/index.ts
    42:5  error  'count' is defined but never used  no-unused-vars

Output:
  src/index.ts:42:5 - error no-unused-vars
  'count' is defined but never used
```

**Line Pattern:**
```regex
/^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+([\w\/-@]+)$/
```

---

### Vitest/Jest Formatter

**Handles:** Vitest and Jest test output

**Extracts:**
- Test file path
- Test name (suite + test description)
- Failure message
- Expected vs. received values
- Error location (file:line)

**Example:**
```
Input:
  ❯ src/index.test.ts > User validation > should reject invalid email
    AssertionError: expected 'invalid' to equal 'test@example.com'
     ❯ src/index.test.ts:42:5

Output:
  src/index.test.ts:42:5
  Test: User validation > should reject invalid email
  AssertionError: expected 'invalid' to equal 'test@example.com'
```

**Patterns:**
- Test failure: `❯ test/file.test.ts > Suite > Test Name`
- Assertion error: `AssertionError: ...`
- Location: `❯ file.ts:line:column`

---

### OpenAPI Formatter

**Handles:** OpenAPI/Swagger validation output

**Extracts:**
- Schema path
- Validation error
- Expected vs. actual values

**Example:**
```
Input:
  ✖  validation error in paths./api/users.get.responses.200
     expected object but got array

Output:
  paths./api/users.get.responses.200
  Expected object but got array
```

**Line Pattern:**
```regex
/validation error in (.+)/
```

---

### Generic Formatter

**Handles:** Unknown tools (fallback)

**Extracts:**
- Error and warning lines
- File paths with line numbers
- ANSI color code removal
- Noise filtering (progress bars, timestamps, etc.)

**Example:**
```
Input:
  [32m✔[0m Building...
  [31m✖[0m Error: Failed to compile
  src/index.ts:42:5: Syntax error

Output:
  Error: Failed to compile
  src/index.ts:42:5: Syntax error
```

**Features:**
- ANSI color removal
- Progress indicator filtering
- Timestamp removal
- Empty line collapsing

---

## Agent-Friendly Output

vibe-validate optimizes error output for AI assistants like Claude Code, Cursor, Aider, and Continue.

### Detection

Automatically detects agent context:

```typescript
if (process.env.CLAUDE_CODE === '1') {
  // Use YAML format
}
if (process.env.CURSOR === '1') {
  // Use YAML format
}
if (process.env.CI === 'true') {
  // Use YAML format
}
```

### YAML Output Format

**Structure:**
<!-- validation-result:example -->
```yaml
passed: false
timestamp: 2025-10-16T15:30:00.000Z
treeHash: a1b2c3d4e5f6789abc123def456
failedStep: TypeScript
rerunCommand: pnpm typecheck
failedStepOutput: |
  src/index.ts:42:5 - error TS2322
  Type 'string' is not assignable to type 'number'

  src/auth.ts:128:10 - error TS2345
  Argument of type 'null' is not assignable to parameter of type 'User'
```

### Why YAML?

**Benefits for AI assistants:**
- **Structured data** - Easy to parse programmatically
- **Embedded output** - Error details included in state file (no separate log files)
- **No ambiguity** - Clear field boundaries (no color codes)
- **Cacheable** - Stored in `.vibe-validate-state.yaml`

### Using State File in Agent Workflows

**Example usage in Claude Code:**
```bash
# Check validation status
vibe-validate validate --check

# View state file with formatted errors
vibe-validate state

# Claude Code reads failedStepOutput and suggests fixes
```

---

## Custom Formatters

You can create custom formatters for tools not supported by default.

### Step 1: Implement Formatter Interface

```typescript
// my-formatter.ts
import { type FormattedError } from '@vibe-validate/formatters';

export function formatMyTool(output: string): FormattedError {
  // Parse tool output
  const lines = output.split('\n');
  const errors: string[] = [];

  for (const line of lines) {
    // Extract error information
    const match = line.match(/ERROR: (.+)/);
    if (match) {
      errors.push(match[1]);
    }
  }

  return {
    summary: `Found ${errors.length} errors`,
    details: errors.join('\n'),
    errorCount: errors.length,
  };
}
```

### Step 2: Register Formatter

```typescript
// validation-runner.ts
import { runValidation } from '@vibe-validate/core';
import { formatMyTool } from './my-formatter';

const result = await runValidation({
  phases: [...],
  formatters: {
    'my-tool': formatMyTool, // ← Register custom formatter
  },
});
```

### Step 3: Use in Configuration

<!-- config:example -->
```yaml
# vibe-validate.config.yaml
# Reference: https://github.com/jdutton/vibe-validate/tree/main/config-templates
git:
  mainBranch: main
validation:
  phases:
    - name: Testing
      steps:
        - name: Unit Tests
          command: npm test
```

### Formatter Interface

```typescript
export interface FormattedError {
  summary: string;      // One-line summary
  details: string;      // Detailed error output
  errorCount: number;   // Number of errors found
  hints?: string[];     // Optional fix suggestions
}
```

### Example: Custom Formatter for Docker Build

```typescript
import { type FormattedError } from '@vibe-validate/formatters';

export function formatDockerBuild(output: string): FormattedError {
  const lines = output.split('\n');
  const errors: string[] = [];

  let inErrorSection = false;

  for (const line of lines) {
    if (line.includes('ERROR [')) {
      inErrorSection = true;
      errors.push(line);
    } else if (inErrorSection && line.trim()) {
      errors.push(line);
    } else if (line.startsWith('----')) {
      inErrorSection = false;
    }
  }

  return {
    summary: `Docker build failed with ${errors.length} errors`,
    details: errors.join('\n'),
    errorCount: errors.length,
    hints: [
      'Check Dockerfile syntax',
      'Verify base image exists',
      'Ensure dependencies are available',
    ],
  };
}
```

---

## Troubleshooting

### "Formatter not working for my tool"

**Cause**: Tool not detected or tool outputs non-standard format.

**Solution 1**: Rename step to include tool name:
```typescript
steps: [
  { name: 'TypeScript Check', command: 'tsc --noEmit' }, // ✅ Detected
  { name: 'Check Types', command: 'tsc --noEmit' },      // ❌ Not detected
]
```

**Solution 2**: Create custom formatter (see above).

### "Too much noise in error output"

**Cause**: Generic formatter doesn't filter tool-specific noise.

**Solution**: Use tool-specific formatter by naming step appropriately:
```typescript
steps: [
  { name: 'Tests', command: 'npm test' },        // ❌ Generic formatter
  { name: 'Vitest Tests', command: 'npm test' }, // ✅ Vitest formatter
]
```

### "Error output truncated"

**Cause**: Output exceeds maximum length (default: 5000 characters).

**Solution**: Errors are intentionally limited for readability. Fix the first few errors, then re-run validation.

**Best practice**: Fix errors incrementally:
```bash
# Run validation
vibe-validate validate

# Fix first 1-2 errors
vim src/index.ts

# Re-run validation (much faster with caching)
vibe-validate validate
```

### "ANSI color codes in output"

**Cause**: Tool outputs colors even in non-TTY mode.

**Solution**: Disable colors in tool configuration:
```typescript
steps: [
  { name: 'ESLint', command: 'eslint --no-color src/' },
  { name: 'Vitest', command: 'vitest run --reporter=basic' },
]
```

Or set `NO_COLOR` environment variable:
```bash
NO_COLOR=1 vibe-validate validate
```

### "Agent prompt not helpful"

**Cause**: Generic formatter or insufficient error context.

**Solution**: Use tool-specific formatter for better error extraction.

---

## Formatter Best Practices

### 1. Name Steps Clearly

Use descriptive names that match formatter detection:

**Good:**
```typescript
steps: [
  { name: 'TypeScript', command: 'tsc --noEmit' },
  { name: 'ESLint', command: 'eslint src/' },
  { name: 'Vitest Unit Tests', command: 'vitest run' },
]
```

**Less Good:**
```typescript
steps: [
  { name: 'Types', command: 'tsc --noEmit' },      // May not detect
  { name: 'Lint', command: 'eslint src/' },        // May not detect
  { name: 'Tests', command: 'vitest run' },        // May detect generically
]
```

### 2. Use Stable Output Formats

Configure tools for consistent, parseable output:

```typescript
steps: [
  { name: 'TypeScript', command: 'tsc --noEmit --pretty false' },
  { name: 'ESLint', command: 'eslint --format=stylish src/' },
  { name: 'Vitest', command: 'vitest run --reporter=verbose' },
]
```

### 3. Disable Progress Indicators

Progress bars and spinners add noise:

```typescript
steps: [
  { name: 'Build', command: 'npm run build --silent' },
  { name: 'Tests', command: 'vitest run --reporter=basic' },
]
```

### 4. Test Formatter Output

Verify formatter works as expected:

```bash
# Force validation to fail
vibe-validate validate --force

# Check formatted output
vibe-validate state
```

### 5. Contribute Formatters

If you create a useful formatter, consider contributing it to vibe-validate:

1. Fork the repository
2. Add formatter to `packages/formatters/src/`
3. Add tests to `packages/formatters/test/`
4. Update detection logic in `smart-formatter.ts`
5. Submit pull request

---

## Advanced Features

### Error Line Extraction

Formatters extract only error lines, removing:
- Progress bars and spinners
- Timestamps and metadata
- Success messages
- ANSI color codes
- Empty lines

**Example:**
```
Input:
  [32m✔[0m Building... (1234ms)
  [31m✖[0m TypeScript
  src/index.ts:42:5 - error TS2322
  [2K

Output:
  src/index.ts:42:5 - error TS2322
```

### Context Preservation

Some formatters preserve important context:

**TypeScript:**
```
src/index.ts:42:5 - error TS2322
Type 'string' is not assignable to type 'number'

src/types.ts:12:3
  The expected type comes from property 'count'
```

**Vitest:**
```
src/index.test.ts:42:5
Test: User validation > should reject invalid email
Expected: test@example.com
Received: invalid
```

### Multi-Error Aggregation

Formatters aggregate multiple errors:

```
TypeScript (3 errors):
  1. src/index.ts:42:5 - TS2322
  2. src/auth.ts:128:10 - TS2345
  3. src/utils.ts:56:12 - TS2339
```

---

## Related Documentation

- [Getting Started Guide](./getting-started.md)
- [Configuration Reference](./configuration-reference.md)
- [CLI Reference](./cli-reference.md)
- [Config Templates Guide](./../config-templates/README.md)
- [Agent Integration Guide](./agent-integration-guide.md)

---

## See Also

- [Formatter Source Code](https://github.com/yourusername/vibe-validate/tree/main/packages/formatters)
- [Formatter Tests](https://github.com/yourusername/vibe-validate/tree/main/packages/formatters/test)
- [Contributing Guide](https://github.com/yourusername/vibe-validate/blob/main/CONTRIBUTING.md)
