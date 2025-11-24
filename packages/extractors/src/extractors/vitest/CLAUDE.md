# Vitest/Jest Extractor - LLM Development Guide

This file provides guidance for AI assistants (Claude Code, Cursor, etc.) working on the Vitest/Jest error extractor.

## Architecture

**Plugin Structure**: `ExtractorPlugin` interface with co-located tests, samples, and documentation.

**Core Functions**:
- `detect(output)` - Pattern matching for Vitest/Jest test failures (90% confidence with multiple patterns)
- `extract(output)` - Parse test failures into structured format
- `generateGuidanceText(failureCount, expected, actual, hasTimeout)` - Generate context-aware actionable guidance

**Special Extraction Functions**:
- `extractRuntimeError(output)` - Unhandled rejections, ENOENT, etc.
- `extractCoverageThresholdError(output)` - Coverage threshold failures
- `extractVitestWorkerTimeoutError(output)` - Vitest worker thread timeouts

## Key Patterns

### Detection Logic
```typescript
// Multiple patterns increase confidence
const vitestMarkers = [
  /FAIL\s+\S+\.test\.(ts|js)/,    // FAIL test-file.test.ts
  /❯\s+\S+\.test\.(ts|js)/,        // ❯ test-file.test.ts
  /×\s+[^❯]+/,                     // × test name
  /⎯+\s*Unhandled/,                // Unhandled errors
];

// 2+ patterns → 90% confidence
// 1 pattern → 70% confidence
```

### Extraction Patterns

#### Format 1: FAIL Lines
```typescript
/(?:FAIL|❌|×)\s+([^\s]+\.test\.ts)\s*>\s*(.+)/
// Captures: file, test hierarchy
```

#### Format 2: File Headers
```typescript
/❯\s+([^\s]+\.test\.ts)\s+\(/      // File header
/(?:×)\s+(.+?)(?:\s+\d+ms)?$/      // Test failure
```

#### Location Extraction
```typescript
/❯\s*(.+\.test\.ts):(\d+):(\d+)/   // Vitest marker
/at\s+.+\(([^\s]+\.test\.ts):(\d+):(\d+)\)/  // Stack trace
```

## Testing Strategy

**Coverage**: 100% (all branches tested)

**Test Categories**:
1. Detection accuracy (multiple patterns, confidence levels)
2. Format handling (Format 1, Format 2, Jest compatibility)
3. Error limits (truncation to MAX_ERRORS_IN_ARRAY)
4. Guidance generation (single, multiple, timeout-specific)
5. Special errors (runtime, coverage, worker timeouts)
6. Edge cases (empty output, no failures, 15+ errors)

## Common Modifications

### Adding New Error Type
```typescript
// 1. Add extraction function
function extractNewErrorType(output: string): TestFailure | null {
  const match = /YOUR_PATTERN/.exec(output);
  if (!match) return null;

  return {
    file: 'appropriate-file.ts',
    location: '',
    testHierarchy: 'Error Type',
    errorMessage: 'Extracted message',
    sourceLine: ''
  };
}

// 2. Call in extract() function
const newError = extractNewErrorType(output);
if (newError) {
  failures.push(newError);
}
```

### Adjusting Detection Confidence
```typescript
// In detect() function
if (matchCount >= 2) {
  return { confidence: 90, ... };  // High confidence
}
if (matchCount === 1) {
  return { confidence: 70, ... };  // Medium confidence
}
```

### Enhancing Guidance
```typescript
// In generateGuidanceText()
if (specificCondition) {
  guidance += 'Specific actionable advice. ';
}
```

## Hints (Fast Filtering)

```typescript
hints: {
  required: [],  // No single required pattern
  anyOf: ['FAIL', 'test.ts', 'test.js', '❯', '×'],  // Any of these suggests Vitest/Jest
}
```

**Why these hints?** Multiple simple checks eliminate non-test output before expensive regex. Vitest/Jest output almost always contains at least one of these markers.

## Sample Test Cases

Plugin includes 3 built-in samples:
1. `single-test-failure` - Basic assertion error with FAIL marker
2. `multiple-test-failures` - Multiple failures across different files
3. `coverage-threshold-failure` - Coverage threshold not met

**Usage**: Validate plugin behavior during development/CI.

## Complexity Notes

**Main `extract()` function**: Cognitive complexity 29 (acceptable)
- **Why**: Coordinates multiple format detection, state tracking, and special error extraction
- **Original**: Was 97 before refactoring - reduced via helper functions
- **Trade-off**: Central parsing loop remains complex but maintainable

## Debugging Tips

1. **Detection not working?**
   - Check if output contains any hint patterns (`FAIL`, `test.ts`, `❯`, `×`)
   - Verify multiple patterns for high confidence (90%)

2. **Extraction returning empty?**
   - Verify format matches Format 1 or Format 2
   - Check file header extraction for Format 2 (`❯ test-file.test.ts (`)

3. **Missing special errors?**
   - Runtime: Look for `⎯⎯⎯ Unhandled Rejection ⎯⎯⎯`
   - Coverage: Look for `ERROR: Coverage for`
   - Worker timeout: Look for `[vitest-worker]: Timeout`

4. **Guidance incorrect?**
   - Single failure: Should mention specific location and expected/actual
   - Multiple failures: Should suggest fixing individually
   - Timeout: Should mention timeout-specific solutions

5. **Tests failing?**
   ```bash
   vv run npx vitest packages/extractors/src/extractors/vitest/index.test.ts
   ```

## Related Files

- `../../types.ts` - ExtractorPlugin interface, FormattedError types
- `../../result-schema.ts` - MAX_ERRORS_IN_ARRAY constant (10)
- `../../extractor-registry.ts` - Registration point

## Performance Notes

- **Detection**: O(n) four-pass check for marker patterns
- **Extraction**: O(n) single pass with state tracking
- **Special Errors**: O(n) three additional passes (runtime, coverage, worker timeout)
- **Hints**: O(n) simple `includes()` checks before detection
- **Token Usage**: ~150 tokens per error (file:line:col:test:message:source)

## Maintenance Considerations

**When Vitest/Jest updates**:
1. Check if new output formats appear
2. Add new format patterns to `parseFailureLine()`
3. Update detection patterns if markers change
4. Add tests for new format
5. Update samples if appropriate

**Common False Positives**:
- Build tool output containing "test.ts" strings
- Non-test error logs with "FAIL" keyword
- **Mitigation**: Multiple pattern requirement (90% confidence) reduces false positives
