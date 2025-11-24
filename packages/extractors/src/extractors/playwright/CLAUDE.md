# Playwright Extractor - LLM Development Guide

This file provides guidance for AI assistants (Claude Code, Cursor, etc.) working on the Playwright error extractor.

## Architecture

**Plugin Structure**: `ExtractorPlugin` interface with co-located tests, samples, and documentation.

**Core Functions**:
- `detect(output)` - Pattern matching for Playwright test output (90% confidence)
- `extract(output)` - Parse test failures into structured format
- `detectErrorType(message, block)` - Categorize error types
- `generateGuidance(type, message)` - Provide actionable guidance
- `calculateQualityMetadata(errors, issues)` - Track extraction quality

## Key Patterns

### Detection Logic
```typescript
(output.includes('✘') && output.includes('.spec.ts')) → 90% confidence
OR /^\s+\d+\)\s+.+\.spec\.ts:\d+:\d+\s+›/.test(output) → 90% confidence
```

### Extraction Patterns
```typescript
// Numbered failure: "  1) tests/path/test.spec.ts:10:5 › test name"
/^\s+(\d+)\)\s+(.*\.spec\.ts):(\d+):(\d+)\s+›\s+(.+?)\s*$/

// Error message: "Error: message" followed by details
/Error:\s*(.+?)(?:\n\n|\n(?=\s+at\s))/s

// Stack trace: "at file.spec.ts:line:col"
/at\s+(.*\.spec\.ts):(\d+):(\d+)/
```

## Testing Strategy

**Coverage**: 100% (all branches tested)

**Test Categories**:
1. Detection accuracy (Playwright vs non-Playwright output)
2. Error type handling (assertion, timeout, element not found, navigation)
3. Path formats (absolute, relative, nested)
4. Test hierarchy (nested describe blocks with › separator)
5. Edge cases (no failures, missing stack traces, ANSI codes)
6. Guidance generation (error-specific advice)
7. Quality metadata (confidence, completeness, issues)

## Common Modifications

### Adding New Error Type
```typescript
// In detectErrorType()
if (message.includes('your-pattern')) {
  return 'your-error-type';
}

// In generateGuidance()
case 'your-error-type':
  return 'Your actionable guidance here';
```

### Adjusting Confidence
```typescript
// In detect() return value
confidence: 90, // Playwright patterns are very distinctive
```

## Hints (Fast Filtering)

```typescript
hints: {
  required: ['.spec.ts'],  // Must contain ".spec.ts"
  anyOf: ['✘', '›'],       // May contain ✘ or › separator
}
```

**Why these hints?** Eliminates non-Playwright output before expensive parsing.

## Error Type Classification

### Priority Order (check in this order)
1. **element-not-found** - `waiting for locator` + `timeout`
2. **navigation-error** - `net::ERR` or `page.goto:`
3. **timeout** - `timeout` or `exceeded`
4. **assertion-error** - `expect(`, `toBe`, `toContain`, etc.
5. **error** - Generic fallback

**Why this order?** More specific patterns first to avoid false positives.

## Path Normalization

Playwright emits both absolute and relative paths. Normalize to relative:
```typescript
// Keep relative paths: tests/example.spec.ts
// Convert absolute: /Users/.../tests/example.spec.ts → tests/example.spec.ts
// Fallback: Extract just filename if no tests/ found
```

## Sample Test Cases

Plugin includes 2 built-in samples:
1. `single-assertion-error` - Basic expect() failure with stack trace
2. `multiple-test-failures` - Three failures with different error messages

**Usage**: Validate plugin behavior during development/CI.

## Debugging Tips

1. **Detection not working?** Check if output contains `✘` or `.spec.ts`
2. **Extraction returning empty?** Verify `N) file.spec.ts:line:col › test` pattern
3. **Error type wrong?** Review `detectErrorType()` order (check specific before generic)
4. **Stack trace missing?** Will log as issue in metadata.issues
5. **Tests failing?** Run `vv run npx vitest packages/extractors/src/extractors/playwright/index.test.ts`

## Related Files

- `../../types.ts` - ExtractorPlugin interface
- `../../result-schema.ts` - MAX_ERRORS_IN_ARRAY constant
- `../../extractor-registry.ts` - Registration point

## Performance Notes

- **Detection**: O(n) single pass with `includes()` and regex test
- **Extraction**: O(n) multi-pass for error blocks and stack traces
- **Hints**: O(n) single `includes()` check before detection
- **Token Usage**: ~150 tokens per test failure (file:line:col:context:message:guidance)

## Known Limitations

1. **Parallel mode**: May interleave output (not yet supported)
2. **Custom fixtures**: Works but may not provide specific guidance
3. **Long error messages**: Included in full (may be verbose)
4. **ANSI codes**: Expected to be stripped by smart-extractor before reaching this plugin
