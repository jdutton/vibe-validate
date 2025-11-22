# Playwright Error Extractor

Extracts and formats Playwright test framework errors for LLM consumption.

## Features

- **Very High Confidence Detection (90%)** - Recognizes `✘` and `›` patterns with `.spec.ts` files
- **Rich Error Context** - Preserves test hierarchy and error details
- **Smart Error Typing** - Categorizes assertions, timeouts, element not found, navigation errors
- **Path Normalization** - Handles both absolute and relative paths
- **Token Efficient** - Limits output to 10 most critical errors

## Detection Patterns

- `✘` - Playwright failure marker
- `›` - Playwright test hierarchy separator
- `.spec.ts` - Playwright test file extension
- `N) file.spec.ts:line:col › test name` - Numbered failure format

## Supported Error Types

### Assertion Errors
```
Error: expect(received).toBe(expected)
Expected: "foo"
Received: "bar"
```

### Timeout Errors
```
Test timeout of 30000ms exceeded.
```

### Element Not Found
```
Error: page.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('#nonexistent')
```

### Navigation Errors
```
Error: page.goto: net::ERR_FILE_NOT_FOUND
```

## Path Formats

Supports multiple path formats with automatic normalization:
- `tests/example.spec.ts:12:21` - Relative path (preferred)
- `/Users/jeff/project/tests/example.spec.ts:12:21` - Absolute path (normalized)
- `tests/deep/nested/test.spec.ts:45:23` - Nested directories

## Test Hierarchy

Preserves full test hierarchy with `›` separator:
```
1) tests/test.spec.ts:10:5 › Outer Describe › Inner Describe › test name
```

## Example Output

```yaml
errors:
  - file: tests/example.spec.ts
    line: 12
    column: 21
    message: |
      should fail
      expect(received).toBe(expected)
      Expected: "foo"
      Received: "bar"
    context: "should fail"
    guidance: "Check the assertion expectation and ensure the actual value matches. Review the test logic and the application state."
    severity: error
summary: "1 test(s) failed"
totalErrors: 1
guidance: "Review test failures and fix the underlying issues. Check assertions, selectors, and test logic."
```

## Priority

**90** - Very distinctive patterns (✘, ›, .spec.ts), checked early in detection chain

## Tags

`playwright`, `testing`, `javascript`, `e2e`
