# ESLint Extractor - LLM Development Guide

This file provides guidance for AI assistants (Claude Code, Cursor, etc.) working on the ESLint error extractor.

## Architecture

**Plugin Structure**: `ExtractorPlugin` interface with co-located tests, samples, and documentation.

**Core Functions**:
- `detect(output)` - Pattern matching for ESLint errors (85% confidence)
- `extract(output)` - Parse errors into structured format
- `deduplicateESLintErrors(errors)` - Prefer @typescript-eslint rules over base rules
- `getESLintGuidance(errors)` - Generate actionable guidance

## Key Patterns

### Detection Logic
```typescript
// Modern format: file:line:col: error/warning rule-name
/:\d+:\d+:\s+(error|warning)\s+.+\s+\S+$/.test(output) → 85% confidence

// Stylish format: indented line:col error/warning
/^\s+\d+:\d+\s+(error|warning)\s+/.test(output) → 85% confidence
```

### Extraction Patterns
```typescript
// Modern format: file:line:col: severity message rule-name
/^(.+?):(\d+):(\d+):\s+(error|warning)\s+(.+?)\s+(\S+)$/

// Stylish format: spaces + line:col + severity + message + rule
/^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(\S+)\s*$/
```

### Deduplication Logic
```typescript
// Group by file:line:column
const key = `${file}:${line}:${column}`;

// Prefer @typescript-eslint/* rules over base ESLint rules
if (locationErrors.length > 1) {
  return locationErrors.find(e => e.code?.startsWith('@typescript-eslint/')) || locationErrors[0];
}
```

## Testing Strategy

**Coverage**: 100% (all branches tested)

**Test Categories**:
1. Detection accuracy (modern format, stylish format, non-ESLint output)
2. Format handling (modern vs stylish)
3. Error limits (truncation to MAX_ERRORS_IN_ARRAY)
4. Guidance generation (rule-specific)
5. Deduplication (prefer @typescript-eslint rules)
6. Edge cases (empty output, spaces in paths, 15+ errors, scoped rules)

## Common Modifications

### Adding New Rule Guidance
```typescript
// In getESLintGuidance()
if (rules.has('rule-name')) {
  guidance.push('Your guidance here');
}
```

### Adjusting Confidence
```typescript
// In detect() return value
confidence: 85, // Lower than TypeScript (95) due to less distinctive pattern
```

### Adding Format Support
```typescript
// In extract() function, add new regex pattern
const newFormatMatch = /your-pattern-here/.exec(line);
if (newFormatMatch) {
  // Parse and push error
}
```

## Hints (Fast Filtering)

```typescript
hints: {
  required: [],                  // No single required keyword
  anyOf: ['error', 'warning'],   // Must contain either "error" or "warning"
}
```

**Why these hints?** ESLint output always contains "error" or "warning", allowing quick filtering before expensive regex.

## Sample Test Cases

Plugin includes 2 built-in samples:
1. `single-no-console-error` - Basic no-console violation
2. `multiple-errors-with-warning` - Mixed errors (no-console + @typescript-eslint/no-unused-vars + semi)

**Usage**: Validate plugin behavior during development/CI.

## Debugging Tips

1. **Detection not working?** Check if output contains `error` or `warning` keywords
2. **Extraction returning empty?** Verify format matches modern or stylish pattern
3. **Wrong file for stylish format?** Check if file path line is being captured correctly
4. **Guidance missing?** Add rule to `getESLintGuidance()`
5. **Tests failing?** Run `vv run npx vitest packages/extractors/src/extractors/eslint/index.test.ts`

## Related Files

- `../../types.ts` - ExtractorPlugin interface
- `../../result-schema.ts` - MAX_ERRORS_IN_ARRAY constant
- `../../extractor-registry.ts` - Registration point

## Performance Notes

- **Detection**: O(n) two regex tests on entire output
- **Extraction**: O(n) line-by-line parsing with two regex patterns
- **Deduplication**: O(n) grouping by location, O(m) selection (m = unique locations)
- **Hints**: O(n) two `includes()` checks before detection
- **Token Usage**: ~80 tokens per error (file:line:col:code:message)

## Special Considerations

### Stylish Format State Tracking
The stylish format requires tracking current file across lines:
```typescript
let currentFile = '';  // Track file for stylish format

// Detect file path line (no colons, contains / or \)
if (line && !line.includes(':') && (line.includes('/') || line.includes('\\'))) {
  currentFile = line.trim();
}
```

### Deduplication Rationale
ESLint and @typescript-eslint rules often overlap:
- `no-unused-vars` (base) vs `@typescript-eslint/no-unused-vars`
- `no-shadow` (base) vs `@typescript-eslint/no-shadow`

TypeScript-specific rules provide better guidance, so prefer them when multiple rules report same location.

### Rule Name Handling
Rule names may appear with or without brackets:
```typescript
const ruleName = match[6].replace(/[[\]]/g, ''); // Remove brackets if present
// Handles both: "no-console" and "[no-console]"
```
