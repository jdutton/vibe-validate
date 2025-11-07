# Extractor Test Guidelines

## Data Integrity Helpers

All extractor tests **MUST** use the shared test helpers to validate data integrity invariants.

### Critical Invariant

**`totalCount` MUST always equal `errors.length`**

This ensures consistency across all extractors and prevents data integrity bugs.

### Usage

Import the helpers:
```typescript
import { expectValidExtractorResult, expectValidExtractorResultWithCount } from './test-helpers.js';
```

#### Option 1: Validate Result (any error count)
```typescript
it('should extract errors from output', () => {
  const result = extractVitestErrors(output);

  // Validates all invariants including totalCount === errors.length
  expectValidExtractorResult(result);

  // Then assert specific behavior
  expect(result.errors[0].file).toBe('test.ts');
});
```

#### Option 2: Validate Result + Assert Count
```typescript
it('should extract 3 errors', () => {
  const result = extractVitestErrors(output);

  // Validates invariants AND asserts exactly 3 errors
  expectValidExtractorResultWithCount(result, 3);

  // Then assert specific details
  expect(result.errors[0].message).toContain('AssertionError');
});
```

### What Gets Validated

The helper checks:
- ✅ `totalCount === errors.length` (CRITICAL)
- ✅ `errors` is an array
- ✅ Each error has `message` (string, non-empty)
- ✅ Optional fields (`file`, `line`, `column`) are correct types
- ✅ `summary`, `guidance`, `errorSummary` are strings
- ✅ Consistency: if `totalCount > 0`, `errorSummary` has content

### Example: Full Test

```typescript
describe('MyExtractor', () => {
  it('should handle parse failures', () => {
    const output = `
FAIL  test.ts > should work
Error: Expected true to be false
 ❯ test.ts:42:10
    `.trim();

    const result = extractMyErrors(output);

    // Always validate invariants first
    expectValidExtractorResultWithCount(result, 1);

    // Then assert specific expectations
    expect(result.errors[0]).toEqual({
      file: 'test.ts',
      line: 42,
      column: 10,
      message: expect.stringContaining('Expected true to be false')
    });

    expect(result.summary).toBe('1 test failure(s)');
    expect(result.errorSummary).toContain('FAIL  test.ts');
  });

  it('should handle no errors', () => {
    const output = 'All tests passed!';
    const result = extractMyErrors(output);

    // Validates totalCount === 0 AND errors.length === 0
    expectValidExtractorResultWithCount(result, 0);

    expect(result.summary).toContain('passed');
  });
});
```

## Migration Guide

### Before (Manual Checks)
```typescript
const result = extractVitestErrors(output);

expect(result.errors).toHaveLength(1);  // Manual check
expect(result.totalCount).toBe(1);      // Manual check (can drift!)
```

### After (With Helper)
```typescript
const result = extractVitestErrors(output);

expectValidExtractorResultWithCount(result, 1);  // Enforces invariant
```

## Why This Matters

**Real Bug Example:**

The generic extractor had a bug where:
- `errors: []` (empty array)
- `totalCount: 1` (incorrect)

This caused inconsistent behavior in the run cache and validation history. The helper catches this automatically.

## Action Items

- [ ] Add `expectValidExtractorResult()` to all existing extractor tests
- [ ] Use `expectValidExtractorResultWithCount()` when asserting specific counts
- [ ] Remove manual `totalCount` checks (redundant with helper)
