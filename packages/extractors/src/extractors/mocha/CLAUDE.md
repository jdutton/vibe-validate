# Mocha Extractor - LLM Development Guide

This file provides guidance for AI assistants (Claude Code, Cursor, etc.) working on the Mocha error extractor.

## Architecture

**Plugin Structure**: `ExtractorPlugin` interface with co-located tests, samples, and documentation.

**Core Functions**:
- `detect(output)` - Pattern matching for Mocha test output (85% confidence)
- `extract(output)` - Parse test failures into structured format
- `extractFailures(output)` - Internal parser for test hierarchy and stack traces

## Key Patterns

### Detection Logic
```typescript
output.includes('failing') || output.includes('passing') → 85% confidence
```

### Extraction Patterns
```typescript
// Failure marker: "  1) Test name:"
/^ {2}(\d+)\)\s+(.*)$/gm

// Error type: "     AssertionError [ERR_ASSERTION]: message"
/^\s+([A-Za-z]*Error)(?:\s\[\w+\])?\s*:\s*(.+)/

// Stack trace: "      at Context.<anonymous> (file:///path:line:col)"
/at Context\.<anonymous> \((?:file:\/\/)?([^:)]+):(\d+)(?::(\d+))?\)/
```

## Testing Strategy

**Coverage**: 100% (all branches tested)

**Test Categories**:
1. Detection accuracy (Mocha vs non-Mocha output)
2. Error type handling (AssertionError, TypeError, ENOENT, Timeout)
3. Path formats (file://, absolute, relative)
4. Test hierarchy (nested describe blocks)
5. Edge cases (no failures, missing stack traces, malformed output)
6. Guidance generation (assertion, timeout, etc.)

## Common Modifications

### Adding New Error Type Guidance
```typescript
// In processTestFailures() from test-framework-utils.ts
// Add logic to detect specific error patterns
```

### Adjusting Confidence
```typescript
// In detect() return value
confidence: 85, // Mocha patterns are distinctive but not unique
```

## Hints (Fast Filtering)

```typescript
hints: {
  required: ['failing'],  // Must contain "failing"
  anyOf: ['passing'],     // May also contain "passing"
}
```

**Why these hints?** Eliminates non-Mocha output before expensive parsing.

## Test Hierarchy Parsing

Mocha uses indentation to show test nesting:
```
  1) Outer Suite           ← 2 spaces: failure marker
       Inner Suite         ← 5+ spaces: hierarchy level
         Deep Suite        ← 5+ spaces: hierarchy level
           should work:    ← 5+ spaces: test name
     Error: message        ← Error starts
```

**Parsing Strategy**:
1. Find `  N) ` failure marker (2 spaces)
2. Collect indented lines (5+ spaces) until blank line or error
3. Join parts with ` > ` separator

## Stack Trace Formats

### Format 1: File URL
```
at Context.<anonymous> (file:///path/to/test.js:42:15)
```

### Format 2: Absolute Path
```
at Context.<anonymous> (/Users/jeff/project/test.js:50:10)
```

### Format 3: Relative Path
```
at Context.<anonymous> (tests/unit/helpers.test.js:128:30)
```

## Sample Test Cases

Plugin includes 2 built-in samples:
1. `single-assertion-error` - Basic AssertionError with file location
2. `multiple-test-failures` - Three failures with different error types

**Usage**: Validate plugin behavior during development/CI.

## Debugging Tips

1. **Detection not working?** Check if output contains `failing` or `passing`
2. **Extraction returning empty?** Verify `  N) ` failure marker format (2 spaces)
3. **Hierarchy incorrect?** Check indentation (5+ spaces for nested levels)
4. **Stack trace missing?** Ensure `at Context.<anonymous>` pattern exists
5. **Tests failing?** Run `vv run npx vitest packages/extractors/src/extractors/mocha/index.test.ts`

## Related Files

- `../../types.ts` - ExtractorPlugin interface
- `../../utils/test-framework-utils.ts` - Shared test failure processing
- `../../result-schema.ts` - MAX_ERRORS_IN_ARRAY constant
- `../../extractor-registry.ts` - Registration point

## Performance Notes

- **Detection**: O(n) single pass with `includes()` checks
- **Extraction**: O(n) multi-pass for hierarchy and stack traces
- **Hints**: O(n) single `includes()` check before detection
- **Token Usage**: ~100 tokens per test failure (file:line:context:message)

## Known Limitations

1. **Timeout errors**: May not extract file location (depends on stack trace format)
2. **Custom error types**: Works but may not provide specific guidance
3. **Deeply nested suites**: Limited to reasonable nesting depth to avoid parsing issues
4. **Parallel mode**: May interleave output (not yet supported)
