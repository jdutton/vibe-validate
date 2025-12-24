# Test Helper Patterns and DRY Principles

Comprehensive guide to writing maintainable tests with minimal duplication.

## Overview

Code duplication in tests is actively monitored and enforced:
- **jscpd (CI enforced):** < 3% duplication target (current: 1.74%)
- **SonarQube:** Tracks additional duplication patterns beyond jscpd
- **Goal:** Maintain low duplication for both tools

Based on refactoring 14 test files and reducing duplication from 4.73% to 1.74%, this guide documents the established patterns.

## When to Create Helper Functions

Create helpers when you see:
- **3+ instances** of similar test setup code
- **Repeated mock configurations** across multiple tests
- **Common assertion patterns** used in many tests
- **Boilerplate code** that obscures test intent

**Don't over-abstract:**
- Unique test setup should stay inline
- Complex helpers can reduce readability
- Balance between DRY and clarity

## Four Standard Helper Patterns

### 1. Factory Functions - `create*()`

Create test objects with sensible defaults and optional overrides.

**Pattern:**
```typescript
/**
 * Create mock validation result with defaults
 * @param overrides - Partial result to override defaults
 * @returns Complete validation result
 */
function createValidationResult(overrides = {}) {
  return {
    passed: true,
    timestamp: '2025-01-01T00:00:00Z',
    treeHash: 'abc123',
    phases: [],
    ...overrides,
  };
}
```

**Usage:**
```typescript
const failedResult = createValidationResult({ passed: false });
const resultWithPhases = createValidationResult({
  phases: [{ name: 'Test', passed: true }]
});
```

**Real examples from codebase:**
- `createMockConfig()` - `packages/cli/test/commands/pre-commit.test.ts`
- `createValidationRun()` - `packages/cli/test/helpers/validation-test-helpers.ts`
- `createPRData()` - `packages/cli/test/services/github-fetcher.test.ts`

### 2. Setup Functions - `setup*()`

Configure mocks and test environment in one call.

**Pattern:**
```typescript
/**
 * Setup test environment with mocked dependencies
 * @param config - Optional configuration overrides
 * @returns Configured mocks and test objects
 */
function setupTestEnvironment(config = {}) {
  const mockConfig = createMockConfig(config);
  vi.mocked(loadConfig).mockResolvedValue(mockConfig);
  vi.mocked(getTreeHash).mockReturnValue('abc123');
  return { mockConfig };
}
```

**Usage:**
```typescript
const { mockConfig } = setupTestEnvironment();
const { mockConfig } = setupTestEnvironment({ phases: [] });
```

**Real examples from codebase:**
- `setupSuccessfulPreCommit()` - `packages/cli/test/commands/pre-commit.test.ts`
- `setupPostMergeTest()` - `packages/git/test/post-merge-cleanup.test.ts`
- `setupRunnerTest()` - `packages/cli/test/runner-adapter.test.ts`

### 3. Assertion Helpers - `expect*()`

Encapsulate common verification patterns.

**Pattern:**
```typescript
/**
 * Assert validation result matches expected values
 * @param result - Validation result to check
 * @param expected - Expected values
 */
function expectValidationResult(result, expected) {
  expect(result.passed).toBe(expected.passed);
  expect(result.treeHash).toBe(expected.treeHash);
  if (expected.errorCount !== undefined) {
    const errors = result.phases.flatMap(p => p.steps.filter(s => !s.passed));
    expect(errors).toHaveLength(expected.errorCount);
  }
}
```

**Usage:**
```typescript
expectValidationResult(result, { passed: true, treeHash: 'abc123' });
expectValidationResult(result, { passed: false, errorCount: 2 });
```

**Real examples from codebase:**
- `expectCleanupBehavior()` - `packages/git/test/post-merge-cleanup.test.ts`
- `expectConsoleOutput()` - `packages/cli/test/helpers/validation-test-helpers.ts`
- `expectSingleError()` - `packages/extractors/test/helpers/sandboxed-extractor-helpers.ts`

### 4. Execution Helpers - `run*()` / `execute*()`

Standardize command execution and result handling.

**Pattern:**
```typescript
/**
 * Execute command and return standardized result
 * @param command - Command to execute
 * @param args - Command arguments
 * @returns Execution result with exit code and output
 */
async function executeCommand(command, args = []) {
  const result = await safeExecResult('node', [command, ...args]);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
```

**Usage:**
```typescript
const { exitCode, stdout } = await executeCommand(cliPath, ['validate']);
```

**Real examples from codebase:**
- `runPreCommit()` - `packages/cli/test/commands/pre-commit.test.ts`
- `executeStateCommand()` - `packages/cli/test/commands/state.test.ts`
- `executeCommand()` - Multiple test files

## Helper Location Strategy

### Inline Helpers (Most Common)

Place at the top of `describe` block for file-specific helpers.

```typescript
describe('MyComponent', () => {
  /**
   * Create mock props with defaults
   */
  function createMockProps(overrides = {}) {
    return { id: 1, name: 'test', ...overrides };
  }

  /**
   * Setup test environment
   */
  function setupTest(options = {}) {
    const props = createMockProps(options.props);
    const wrapper = mount(MyComponent, { props });
    return { props, wrapper };
  }

  beforeEach(() => { /* ... */ });

  it('should work', () => {
    const { wrapper } = setupTest();
    // test code
  });
});
```

**Advantages:**
- Keeps helpers close to usage
- Easy to see what helpers are available
- No imports needed
- Clear scope

### Shared Helper Files

Create `test/helpers/*.ts` when helpers are used across multiple test files.

**Structure:**
```
packages/cli/
├── test/
│   ├── helpers/
│   │   ├── validation-test-helpers.ts    # Validation-related helpers
│   │   └── commander-test-setup.ts       # Commander setup utilities
│   ├── commands/
│   │   ├── validate.test.ts
│   │   └── state.test.ts
```

**When to use:**
- Helper needed in 2+ test files
- Complex domain logic (validation, extraction, etc.)
- Utilities that don't belong in inline helpers

**Examples from codebase:**
- `packages/cli/test/helpers/validation-test-helpers.ts` - Used across multiple validation tests
- `packages/extractors/test/helpers/sandboxed-extractor-helpers.ts` - Complex sandbox test utilities

### What NOT to Create

❌ **Cross-package test helpers** - Too much coupling
```typescript
// DON'T DO THIS
packages/test-utils/shared-helpers.ts  // Used by all packages
```

❌ **Generic "test-utils" dumping ground**
```typescript
// DON'T DO THIS
test/utils/index.ts  // Everything goes here
```

❌ **Over-abstracted helpers**
```typescript
// DON'T DO THIS - too generic
function createThing(type, options) {
  switch (type) {
    case 'config': return createConfig(options);
    case 'result': return createResult(options);
    // ... 10 more cases
  }
}
```

## Naming Conventions

Follow these established patterns:

| Pattern | Purpose | Examples |
|---------|---------|----------|
| `create*()` | Factory for objects | `createMockConfig()`, `createValidationResult()`, `createPRData()` |
| `setup*()` | Environment setup | `setupValidationTest()`, `setupPostMergeTest()`, `setupGitRepo()` |
| `expect*()` | Assertions | `expectValidationPassed()`, `expectCleanupBehavior()`, `expectErrorLogged()` |
| `run*()`/`execute*()` | Command execution | `runValidation()`, `executeCommand()`, `runPreCommit()` |
| `mock*()` | Mock configuration | `mockGitCommands()`, `mockSuccessfulValidation()` |
| `build*()` | Complex builders | `buildMergeScenario()`, `buildTestEnvironment()` |

## Documentation Requirements

**All helper functions MUST have:**

1. **JSDoc comment** explaining purpose
2. **@param tags** for all parameters
3. **@returns tag** if returning a value
4. **@example tag** for complex helpers

**Example:**
```typescript
/**
 * Create mock PR data with sensible defaults
 *
 * Generates a complete PR data object suitable for testing GitHub
 * API responses. All fields have reasonable defaults and can be
 * overridden via the overrides parameter.
 *
 * @param overrides - Partial PR data to override defaults
 * @returns Complete PR data object matching GitHub API schema
 *
 * @example
 * // Draft PR with custom number
 * const pr = createPRData({ number: 123, draft: true });
 *
 * @example
 * // PR with custom labels
 * const pr = createPRData({ labels: ['bug', 'urgent'] });
 */
function createPRData(overrides = {}) {
  return {
    number: 1,
    title: 'Test PR',
    draft: false,
    labels: [],
    ...overrides,
  };
}
```

## ESLint Requirements

### SonarJS Assertions Rule

ESLint enforces `sonarjs/assertions-in-tests` - each test must have **explicit** `expect()` calls. Helper functions with assertions don't count.

**❌ Will fail ESLint:**
```typescript
it('should validate', () => {
  const result = createResult();
  expectValidResult(result); // Helper has assertions but ESLint doesn't see them
});
```

**✅ Passes ESLint:**
```typescript
it('should validate', () => {
  const result = createResult();
  expect(result).toBeDefined();     // Explicit assertion
  expectValidResult(result);        // Helper adds more checks
});
```

**Common explicit assertions to add:**
```typescript
expect(result).toBeDefined();
expect(result).toBeTruthy();
expect(result).not.toBeNull();
expect(result).toMatchObject({ passed: true });
```

## DRY Enforcement with jscpd

### Duplication Targets

- **jscpd (CI enforced):** < 3% duplication
- **Current:** 1.74% (100 clones across 59 files)
- **SonarQube:** Tracks additional patterns beyond jscpd
- **CI:** Fails if new duplication detected above baseline

### When Duplication Check Fails

**Process:**
1. Review the duplicated code blocks in error output
2. Identify the pattern (mock setup, assertions, etc.)
3. Create appropriate helper function(s)
4. Refactor tests to use helpers
5. Verify tests still pass
6. Update baseline: `npx tsx tools/jscpd-update-baseline.ts`

**Example duplication output:**
```
❌ NEW code duplication detected! (3 new clones)

  📁 packages/cli/test/commands/validate.test.ts:42-54
     ↔ packages/cli/test/commands/run.test.ts:38-50
     (13 lines duplicated)
```

### Common Duplication Patterns

| Pattern | Solution | Helper Type |
|---------|----------|-------------|
| Repeated mock config objects | Extract to factory | `create*()` |
| Repeated mock setup calls | Extract to setup function | `setup*()` |
| Repeated assertion blocks | Extract to assertion helper | `expect*()` |
| Repeated try-catch patterns | Extract to execution helper | `execute*()` |
| Repeated test data | Extract to factory | `create*()` |

## Real-World Examples

### Example 1: Pre-commit Test Refactoring

**Before (duplicated 18 times):**
```typescript
it('should run validation on commit', async () => {
  const config = {
    preCommit: {
      branchSync: { autoSync: false, warnIfBehind: true },
      secretScanning: { enabled: true },
      validation: { enabled: true },
    },
  };
  vi.mocked(configLoader.loadConfig).mockResolvedValue(config);
  vi.mocked(git.getCurrentBranch).mockResolvedValue('feature-branch');
  vi.mocked(git.checkBranchBehind).mockResolvedValue(false);
  vi.mocked(validation.validate).mockResolvedValue({ passed: true });

  try {
    await preCommit();
  } catch (err) {
    expect((err as Error).message).toContain('process.exit(0)');
  }

  expect(validation.validate).toHaveBeenCalled();
});
```

**After (with helpers):**
```typescript
it('should run validation on commit', async () => {
  setupSuccessfulPreCommit();
  await runPreCommit(0);
  expect(validation.validate).toHaveBeenCalled();
});
```

**Impact:** 18 lines → 4 lines (78% reduction)

### Example 2: Schema Validation Test Refactoring

**Before (duplicated 30+ times):**
```typescript
it('should validate correct config', () => {
  const config = {
    validation: {
      phases: [
        {
          name: 'Testing',
          steps: [{ name: 'Unit Tests', command: 'npm test' }]
        }
      ]
    }
  };

  const result = safeValidateConfig(config);

  expect(result.success).toBe(true);
  expect(result.errors).toEqual([]);
});
```

**After (with helpers):**
```typescript
it('should validate correct config', () => {
  const config = createBaseConfig();
  expectValidConfig(config);
});
```

**Impact:** 15 lines → 3 lines (80% reduction)

### Example 3: Extractor Test Refactoring

**Before (duplicated 14 times):**
```typescript
it('should extract single error', async () => {
  const plugin = {
    name: 'test-extractor',
    extract: (output: string) => ({
      errors: [{ message: output }],
      totalErrors: 1,
      summary: '1 error',
      guidance: 'Fix the error',
      metadata: {
        detection: { extractor: 'test', confidence: 100, patterns: ['test'], reason: 'Test' },
        confidence: 100,
        completeness: 100,
        issues: [],
      },
    }),
  };

  const wrappedExtract = createSandboxedExtractor(plugin);
  const result = await wrappedExtract('error: test failed');

  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].message).toBe('error: test failed');
  expect(result.totalErrors).toBe(1);
});
```

**After (with helpers):**
```typescript
it('should extract single error', async () => {
  const plugin = createSingleErrorFromOutputPlugin();
  const wrappedExtract = createSandboxedExtractor(plugin);
  const result = await wrappedExtract('error: test failed');

  expect(result).toBeDefined();
  expectSingleError(result, 'error: test failed');
});
```

**Impact:** 25 lines → 7 lines (72% reduction)

## Summary

Following these patterns ensures:
- ✅ Low duplication (jscpd < 3%, SonarQube minimal)
- ✅ Maintainable tests (changes in one place)
- ✅ Readable tests (focus on what's being tested)
- ✅ Consistent codebase (same patterns everywhere)
- ✅ Fast refactoring (established helper patterns)

**Key takeaways:**
1. Create helpers when you see 3+ similar instances
2. Use the four standard patterns: `create*()`, `setup*()`, `expect*()`, `run*()`/`execute*()`
3. Keep helpers inline unless shared across files
4. Document all helpers with JSDoc
5. Add explicit `expect()` for ESLint
6. Update baseline after refactoring

**See actual implementations in:**
- `packages/cli/test/commands/pre-commit.test.ts` (25 helpers)
- `packages/cli/test/helpers/validation-test-helpers.ts` (shared helpers)
- `packages/extractors/test/helpers/sandboxed-extractor-helpers.ts` (complex helpers)
