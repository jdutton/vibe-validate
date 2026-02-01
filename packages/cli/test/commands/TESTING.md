# Testing Guide for Validate Command

This directory contains tests for the `vv validate` command and shared testing helpers.

## Files

### `validate.test.ts`
Main test suite for the validate command (1,186 lines, 34 tests).

**Test Coverage:**
- Command registration
- Config file handling (missing, invalid)
- Successful and failed validation
- Verbosity detection
- Error handling
- `--check` flag
- `--yaml` flag
- Cached validation results
- Flaky validation detection
- Worktree stability

### `validate-test-helpers.ts`
Reusable helpers to reduce duplication and improve maintainability.

**Available Helpers:**

```typescript
// YAML Output Assertions
expectYamlOutput({
  stream?: 'stdout' | 'stderr',
  passed?: boolean,
  treeHash?: string,
  failedStep?: string,
  containsStrings?: string[]
})

// Console Output Assertions
expectConsoleLog(message: string)
expectConsoleError(message: string)
expectNoConsoleError(message: string)
expectConsoleWarn(message: string)
expectNoConsoleWarn(message: string)

// Mock Data Factories
createFlakyHistoryNote() // Returns history note with 3 runs (pass, fail, pass)
```

## Usage Examples

### YAML Output Testing

**Before:**
```typescript
expect(process.stdout.write).toHaveBeenCalledWith('---\n');
expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('passed: true'));
expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('treeHash:'));
```

**After:**
```typescript
expectYamlOutput({ passed: true, treeHash: 'abc123def456' });
```

### Console Output Testing

**Before:**
```typescript
expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Validation passed'));
expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('No configuration'));
```

**After:**
```typescript
expectConsoleLog('Validation passed');
expectNoConsoleError('No configuration');
```

### Flaky Validation Testing

**Before:**
```typescript
const mockHistoryNote = {
  treeHash: 'abc123def456',
  runs: [
    { /* run 1 - passed */ },
    { /* run 2 - failed */ },
    { /* run 3 - passed */ },
  ]
};
```

**After:**
```typescript
const mockHistoryNote = createFlakyHistoryNote();
```

## Best Practices

### 1. Use Helpers for Common Patterns
If you find yourself writing the same assertion pattern 3+ times, consider adding it to `validate-test-helpers.ts`.

### 2. Keep Tests Focused
Each test should verify one specific behavior. Use descriptive test names that explain what's being tested.

### 3. Use Descriptive Mock Names
Prefix mock variables with `mock` or `setup` to make their purpose clear:
- `mockHistoryNote` - Mock data
- `setupMockConfig()` - Setup function

### 4. Clean Up After Tests
The `beforeEach`/`afterEach` hooks handle most cleanup, but if you create spies, restore them:
```typescript
const spy = vi.spyOn(console, 'warn');
// ... test code ...
spy.mockRestore();
```

### 5. Test Error Cases
Don't just test the happy path. Test:
- Missing files
- Invalid configs
- Failed validations
- Edge cases (empty history, flaky runs, etc.)

## Adding New Tests

1. **Find the appropriate `describe` block** or create a new one
2. **Write a descriptive test name** using `it('should ...')`
3. **Setup test state** using existing helpers
4. **Execute the command** using `env.program.parseAsync()`
5. **Assert expected behavior** using helpers from `validate-test-helpers.ts`
6. **Clean up** (usually automatic via hooks)

Example:
```typescript
it('should do something specific', async () => {
  setupMockConfig(createMockConfig());
  setupSuccessfulValidation();
  validateCommand(env.program);

  await env.program.parseAsync(['validate'], { from: 'user' });

  expectConsoleLog('Expected message');
});
```

## Running Tests

```bash
# Run all validate tests
pnpm --filter @vibe-validate/cli test validate.test.ts

# Run with watch mode
pnpm --filter @vibe-validate/cli test validate.test.ts --watch

# Run specific test
pnpm --filter @vibe-validate/cli test validate.test.ts -t "should exit with code 0"
```

## Future Improvements

Potential areas for enhancing test maintainability:

1. **More assertion helpers** for common patterns
2. **Scenario-based setup helpers** for common test configurations
3. **Shared fixtures** for complex test data
4. **Test data builders** for flexible mock creation

See the analysis in the main README for detailed recommendations.
