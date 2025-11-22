# TypeScript Extractor - LLM Development Guide

This file provides guidance for AI assistants (Claude Code, Cursor, etc.) working on the TypeScript error extractor.

## Architecture

**Plugin Structure**: `ExtractorPlugin` interface with co-located tests, samples, and documentation.

**Core Functions**:
- `detect(output)` - Pattern matching for TypeScript errors (95% confidence)
- `extract(output)` - Parse errors into structured format
- `getTypeScriptGuidance(errors)` - Generate actionable guidance

## Key Patterns

### Detection Logic
```typescript
/error TS\d+:/.test(output) → 95% confidence
```

### Extraction Patterns
```typescript
// Old format: file(line,col): error TSxxxx: message
/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s+(.+)$/gm

// New format: file:line:col - error TSxxxx: message
/^(.+?):(\d+):(\d+)\s+-\s*(error|warning)\s+(TS\d+):\s+(.+)$/gm
```

## Testing Strategy

**Coverage**: 100% (all branches tested)

**Test Categories**:
1. Detection accuracy (true positives, true negatives)
2. Format handling (old vs new tsc output)
3. Error limits (truncation to MAX_ERRORS_IN_ARRAY)
4. Guidance generation (error-code-specific)
5. Edge cases (empty output, spaces in paths, 15+ errors)

## Common Modifications

### Adding New Error Code Guidance
```typescript
// In getTypeScriptGuidance()
if (errorCodes.has('TS####')) {
  guidance.push('Your guidance here');
}
```

### Adjusting Confidence
```typescript
// In detect() return value
confidence: 95, // Increase if pattern is more distinctive
```

## Hints (Fast Filtering)

```typescript
hints: {
  required: ['error TS'],  // Must contain "error TS"
  anyOf: [],               // No secondary patterns needed
}
```

**Why these hints?** Single simple check eliminates non-TypeScript output before expensive regex.

## Sample Test Cases

Plugin includes 2 built-in samples:
1. `single-type-error` - Basic TS2322 type mismatch
2. `multiple-errors-with-warning` - TS2322 + TS2304 + TS6133

**Usage**: Validate plugin behavior during development/CI.

## Debugging Tips

1. **Detection not working?** Check if output contains `error TS\d+:` pattern
2. **Extraction returning empty?** Verify format matches old or new pattern
3. **Guidance missing?** Add error code to `getTypeScriptGuidance()`
4. **Tests failing?** Run `vv run npx vitest packages/extractors/src/extractors/typescript/index.test.ts`

## Related Files

- `../../types.ts` - ExtractorPlugin interface
- `../../result-schema.ts` - MAX_ERRORS_IN_ARRAY constant
- `../../extractor-registry.ts` - Registration point

## Performance Notes

- **Detection**: O(n) single pass with `/error TS\d+:/`
- **Extraction**: O(n) two-pass regex (new format, then old)
- **Hints**: O(n) single `includes()` check before detection
- **Token Usage**: ~75 tokens per error (file:line:col:code:message)
