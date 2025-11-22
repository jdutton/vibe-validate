# Jasmine Extractor - LLM Development Guide

This file provides guidance for AI assistants (Claude Code, Cursor, etc.) working on the Jasmine error extractor.

## Architecture

**Plugin Structure**: `ExtractorPlugin` interface with co-located tests, samples, and documentation.

**Core Functions**:
- `detect(output)` - Pattern matching for Jasmine test output (85% confidence)
- `extract(output)` - Parse test failures into structured format
- `extractFailures(output)` - Internal parser for Message:/Stack: sections

## Key Patterns

### Detection Logic
```typescript
output.includes('spec') || output.includes('Failures:') → 85% confidence
```

### Extraction Patterns
```typescript
// Failure marker: "1) Test name"
/^(\d+)\)\s+(.+)$/

// Message section: "  Message:" followed by indented text
nextLine.trim() === 'Message:' → collect until 'Stack:' or empty

// Stack section: "  Stack:" followed by stack frames
nextLine.trim() === 'Stack:' → parse UserContext.<anonymous> frames

// UserContext stack: "at UserContext.<anonymous> (file:line:col)"
/UserContext\.<anonymous> \(([^:)]+):(\d+)(?::(\d+))?\)/
```

## Testing Strategy

**Coverage**: 100% (all branches tested)

**Test Categories**:
1. Detection accuracy (Jasmine vs non-Jasmine output)
2. Error type handling (assertion, TypeError, ENOENT, timeout)
3. Path formats (absolute, relative)
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
confidence: 85, // Jasmine patterns are distinctive but not unique
```

## Hints (Fast Filtering)

```typescript
hints: {
  required: ['spec'],     // Must contain "spec"
  anyOf: ['Failures:'],   // May also contain "Failures:"
}
```

**Why these hints?** Eliminates non-Jasmine output before expensive parsing.

## Output Structure Parsing

Jasmine uses a structured format:
```
1) Test Suite > Test Name    ← Failure marker with test name
  Message:                   ← Message section header
    Expected 4 to equal 5.   ← Indented message content
  Stack:                     ← Stack section header
        at <Jasmine>         ← Internal Jasmine frames
        at UserContext...    ← User test code (extract this!)
        at <Jasmine>         ← More internal frames

2) Next Test...
```

**Parsing Strategy**:
1. Find `N) Test name` failure marker
2. Look for `Message:` section → collect indented lines
3. Look for `Stack:` section → parse `UserContext.<anonymous>` frames
4. Extract error type from message prefix (e.g., "TypeError:")

## Stack Trace Formats

### Format 1: Absolute Path
```
at UserContext.<anonymous> (/Users/jeff/project/test.js:50:10)
```

### Format 2: Relative Path
```
at UserContext.<anonymous> (tests/unit/helpers.test.js:128:30)
```

### Format 3: Generic Object Pattern (fallback)
```
at Object.someFunction (test.js:42:15)
```

## Sample Test Cases

Plugin includes 2 built-in samples:
1. `single-assertion-error` - Basic assertion failure with stack trace
2. `multiple-test-failures` - Three failures with different error types

**Usage**: Validate plugin behavior during development/CI.

## Debugging Tips

1. **Detection not working?** Check if output contains `spec` or `Failures:`
2. **Extraction returning empty?** Verify `N) Test name` failure marker exists
3. **Message missing?** Ensure `Message:` section is present with indented text
4. **Stack trace missing?** Check for `Stack:` section with `UserContext.<anonymous>`
5. **Tests failing?** Run `vv run npx vitest packages/extractors/src/extractors/jasmine/index.test.ts`

## Related Files

- `../../types.ts` - ExtractorPlugin interface
- `../../utils/test-framework-utils.ts` - Shared test failure processing
- `../../result-schema.ts` - MAX_ERRORS_IN_ARRAY constant
- `../../extractor-registry.ts` - Registration point

## Performance Notes

- **Detection**: O(n) single pass with `includes()` checks
- **Extraction**: O(n) multi-pass for Message: and Stack: sections
- **Hints**: O(n) single `includes()` check before detection
- **Token Usage**: ~100 tokens per test failure (file:line:context:message)

## Known Limitations

1. **Timeout errors**: May not extract file location (depends on stack trace format)
2. **Custom matchers**: Works but may not provide specific guidance
3. **Parallel mode**: May interleave output (not yet supported)
4. **Multi-line messages**: Collected correctly but may be verbose in output
