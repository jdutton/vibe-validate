# Jest Extractor - LLM Development Guide

This file provides guidance for AI assistants (Claude Code, Cursor, etc.) working on the Jest error extractor.

## Architecture

**Plugin Structure**: `ExtractorPlugin` interface with co-located tests, samples, and documentation.

**Core Functions**:
- `detect(output)` - Pattern matching for Jest test failures (90% confidence)
- `extract(output)` - Parse failures into structured format with hierarchy tracking
- Helper functions for parsing different Jest output formats

## Key Patterns

### Detection Logic
```typescript
// High confidence (90%): FAIL marker or both test markers and detailed format
/^\s*FAIL\s+/.test(output) → 90% confidence
/[✕✓]/.test(output) && /^\s*●\s+/.test(output) → 90% confidence

// Medium confidence (50%): Only test markers present
/[✕✓]/.test(output) → 50% confidence
```

### Extraction Patterns
```typescript
// FAIL line: Extract file path
/^\s*FAIL\s+(?:[\w-]+\s+)?([\w/-]+\.test\.\w+)/

// Inline failure (✕): Extract test name
/^\s+✕\s+(.+?)(?:\s+\(\d+\s*ms\))?$/

// Detailed format (●): Extract full hierarchy
/^\s*●\s+(.+)$/

// Suite line: Extract suite name and indentation
/^\s+([A-Z][\w\s›-]+)$/
```

## State Machine Architecture

The extractor maintains state across lines:

1. **currentFile**: Tracks which test file we're parsing
2. **hierarchyStack**: Maintains describe/test nesting (e.g., ["Outer Suite", "Inner Suite"])
3. **Line-by-line processing**: Each line updates state or emits a failure

### State Transitions

```
Initial state: currentFile='', hierarchyStack=[]

Line: " FAIL test/example.test.ts"
  → Update currentFile, reset hierarchyStack

Line: "  Example Suite"
  → Push to hierarchyStack (if valid suite format)

Line: "    ✕ test name (10 ms)"
  → Emit failure: hierarchyStack.join(' › ') + ' › test name'

Line: " FAIL test/another.test.ts"
  → Update currentFile, reset hierarchyStack (new file)
```

## Hierarchy Tracking

**How indentation determines nesting**:

```typescript
// Example output:
//   Example Suite        (indent: 2)
//     Nested Suite       (indent: 4)
//       ✕ test           (indent: 6)

hierarchyStack = []
processLine("  Example Suite")  → push "Example Suite"
processLine("    Nested Suite") → push "Nested Suite"
processLine("      ✕ test")     → join: "Example Suite › Nested Suite › test"
```

**Popping from stack** (when indentation decreases):
```typescript
// If new indent <= current level * 2, pop stack
while (hierarchyStack.length > 0 && indent <= hierarchyStack.length * 2) {
  hierarchyStack.pop();
}
```

## Testing Strategy

**Coverage**: 100% (all branches tested)

**Test Categories**:
1. **Detection**: High confidence (FAIL + ●), medium confidence (only ✕), negative cases
2. **Single failures**: Inline format, detailed format, standalone tests
3. **Multiple failures**: Same file, multiple files, nested hierarchies
4. **Hierarchy tracking**: Deep nesting, hierarchy resets, indentation changes
5. **Edge cases**: Empty output, mixed pass/fail, special characters, 15+ errors
6. **Output limits**: MAX_ERRORS_IN_ARRAY truncation

## Common Modifications

### Adjusting Detection Patterns
```typescript
// In detect() function
const hasFailMarker = /^\s*FAIL\s+/.test(output);
const hasTestMarkers = /[✕✓]/.test(output);
const hasDetailedMarker = /^\s*●\s+/.test(output);

// Adjust confidence based on pattern combinations
if (hasFailMarker || (hasTestMarkers && hasDetailedMarker)) {
  return { confidence: 90, ... };
}
```

### Adding New Output Format
```typescript
// Add new matcher function
function matchNewFormat(line: string): string | null {
  const match = /your-regex-here/.exec(line);
  return match ? match[1] : null;
}

// Update processLine() to check new format
const newFormatResult = matchNewFormat(line);
if (newFormatResult) {
  // Handle new format
}
```

### Adjusting Confidence
```typescript
// In detect() return value
confidence: 90, // Increase if pattern is more distinctive
               // Decrease if prone to false positives
```

## Hints (Fast Filtering)

```typescript
hints: {
  required: [],                   // No single required pattern
  anyOf: ['FAIL', '✕', '●'],     // At least one Jest marker
}
```

**Why these hints?** Fast substring checks eliminate non-Jest output before expensive regex operations.

## Sample Test Cases

Plugin includes 3 built-in samples:
1. `single-test-failure` - Basic inline (✕) failure
2. `multiple-failures-with-hierarchy` - Nested describe blocks
3. `detailed-format` - Detailed (●) error format

**Usage**: Validate plugin behavior during development/CI.

## Debugging Tips

1. **Detection not working?**
   - Check if output contains FAIL, ✕, or ● markers
   - Verify multiline detection (patterns may need `m` flag)

2. **Hierarchy incorrect?**
   - Add console.log to track hierarchyStack changes
   - Verify indentation matching logic (`/^(\s*)/`)
   - Check if suite detection regex is too broad/narrow

3. **Missing failures?**
   - Verify currentFile is set before processing tests
   - Check if matchInlineFailure() or matchDetailedTest() regex matches your input
   - Test line-by-line with processLine()

4. **Tests failing?**
   ```bash
   vv run npx vitest packages/extractors/src/extractors/jest/index.test.ts
   ```

## Performance Notes

- **Detection**: O(n) three regex tests (FAIL, test markers, detailed marker)
- **Extraction**: O(n) single pass with line-by-line processing
- **Hierarchy tracking**: O(d) stack operations per line (d = max depth)
- **Hints**: O(n) three `includes()` checks before detection
- **Token Usage**: ~50 tokens per error (hierarchy + message + location)

## Related Files

- `../../types.ts` - ExtractorPlugin interface, DetectionResult, ErrorExtractorResult
- `../../result-schema.ts` - MAX_ERRORS_IN_ARRAY constant (token limit)
- `../../extractor-registry.ts` - Registration point (DO NOT MODIFY per user instruction)

## Edge Cases Handled

| Edge Case | Handling Strategy |
|-----------|------------------|
| Multiple files | Reset hierarchyStack on each FAIL line |
| No file context | Ignore failures before FAIL line |
| Mixed pass/fail | Only extract ✕ markers (ignore ✓) |
| Deeply nested | Indentation-based stack adjustments |
| Special chars | Preserve all characters in test/suite names |
| Module prefixes | Regex strips optional prefix from FAIL line |
| Missing timing | Regex makes `(\d+ ms)` optional |
| 15+ errors | Truncate to MAX_ERRORS_IN_ARRAY but preserve totalErrors count |

## Known Limitations

1. **Line/column precision**: Jest summary output doesn't provide exact locations
   - Sets line/column to undefined when not available (schema compliant)
   - Detailed stack traces would require additional parsing

2. **Error message details**: Captures "Test failed" generic message
   - Full assertion details (Expected/Received) require parsing subsequent lines
   - Would increase complexity and token usage

3. **Indentation assumptions**: Assumes 2-space indents per nesting level
   - Works for standard Jest output
   - May break with non-standard formatters

## Future Enhancements (If Needed)

1. **Parse stack traces**: Extract actual line/column from "at file:line:col" lines
2. **Capture assertion details**: Parse "Expected"/"Received" blocks
3. **Error categorization**: Group by error type (timeout, assertion, exception)
4. **Snapshot failures**: Special handling for snapshot mismatch messages
5. **Coverage warnings**: Extract coverage threshold failures

**Note**: Only add complexity if users explicitly request richer error details. Current implementation prioritizes token efficiency (75 tokens/error vs 200+ with full details).
