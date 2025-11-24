# Vitest/Jest Error Extractor

Extracts and formats Vitest and Jest test failures for LLM consumption.

## Features

- **High Confidence Detection (90%)** - Recognizes multiple Vitest/Jest failure patterns
- **Multi-Format Support** - Handles Format 1 (FAIL lines) and Format 2 (❯ markers)
- **Special Error Detection** - Runtime errors, coverage thresholds, worker timeouts
- **Smart Guidance** - Context-aware fix suggestions (single vs multiple failures, timeouts)
- **Token Efficient** - Limits output to 10 most critical errors

## Detection Patterns

- `FAIL\s+\S+\.test\.(ts|js)` - FAIL with test file
- `❯\s+\S+\.test\.(ts|js)` - Vitest location marker with test file
- `×\s+[^❯]+` - Test failure marker (Format 2)
- `⎯+\s*Unhandled` - Unhandled errors section

## Supported Output Formats

### Format 1: FAIL Lines
```
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > should parse HTTP_PORT
AssertionError: expected 3000 to be 9999 // Object.is equality
 ❯ test/unit/config/environment.test.ts:57:30
   57|     expect(config.HTTP_PORT).toBe(9999);
```

### Format 2: File Headers with × Markers
```
❯ test/unit/config/environment.test.ts (1)
  × should parse HTTP_PORT
AssertionError: expected 3000 to be 9999
 ❯ test/unit/config/environment.test.ts:57:30
```

### Special Error Types

#### Runtime Errors
```
⎯⎯⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯⎯⎯
Error: ENOENT: no such file or directory
 ❯ readFile file:///path/to/file.ts:10:5
```

#### Coverage Threshold Failures
```
ERROR: Coverage for functions (86.47%) does not meet global threshold (87%)
```

#### Vitest Worker Timeouts
```
⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
```

## Guidance Generation

### Single Test Failure
```
1 test(s) failed. Fix the assertion in the test file at the location shown. The test expected "9999" but got "3000". Run: npm test -- <test-file> to verify the fix.
```

### Multiple Test Failures
```
3 test(s) failed. Fix each failing test individually. Run: npm test -- <test-file> to test each file.
```

### Timeout Failures
```
1 test(s) failed. Test(s) timed out. Options: 1) Increase timeout with test.timeout() or testTimeout config, 2) Optimize test to run faster, 3) Mock slow operations (API calls, file I/O, child processes). Run: npm test -- <test-file> to verify the fix.
```

## Example Output

```yaml
errors:
  - file: test/unit/config/environment.test.ts
    line: 57
    column: 30
    message: AssertionError: expected 3000 to be 9999
summary: "3 test failure(s)"
totalErrors: 3
guidance: "Fix each failing test individually. Run: npm test -- <test-file> to test each file."
errorSummary: |
  [Test 1/3] test/unit/config/environment.test.ts:57:30

  Test: EnvironmentConfig > should parse HTTP_PORT
  Error: AssertionError: expected 3000 to be 9999

  57| expect(config.HTTP_PORT).toBe(9999);
```

## Priority

**85** - High confidence with multiple distinctive patterns, checked early in detection chain

## Tags

`vitest`, `jest`, `testing`, `test-failures`
