# JUnit Extractor - LLM Development Guide

This file provides guidance for AI assistants (Claude Code, Cursor, etc.) working on the JUnit XML error extractor.

## Architecture

**Plugin Structure**: `ExtractorPlugin` interface with co-located tests, samples, and documentation.

**Core Functions**:
- `detect(output)` - Pattern matching for JUnit XML (90% confidence with failures, 85% without)
- `extract(output)` - Parse XML and extract test failures into structured format
- `getJUnitGuidance(failures)` - Generate actionable guidance based on error types

**Helper Functions**:
- `extractXmlAttribute(tag, attrName)` - Parse XML attributes from tag strings
- `extractFailures(xml)` - Extract all `<failure>` elements from XML
- `decodeHtmlEntities(text)` - Convert HTML entities to characters

## Key Patterns

### Detection Logic
```typescript
// High confidence if failures present
output.includes('<testsuite') && output.includes('<failure') → 90% confidence

// Medium confidence if just JUnit structure
output.includes('<testsuite') → 85% confidence
```

### Extraction Pattern
```typescript
// Find all <testcase> elements with failures
/<testcase[^>]*>([\s\S]*?)<\/testcase>/g

// Extract location from failure text (Vitest format)
/❯\s+([\w/.-]+):(\d+)(?::\d+)?/
```

### XML Parsing Strategy
**Simple regex-based parsing** - No heavy XML parser dependencies. This is intentional to:
- Minimize bundle size
- Avoid SAX/DOM parser complexity
- Handle malformed XML gracefully
- Parse only what we need (testcase, failure elements)

## Testing Strategy

**Coverage**: 100% (all branches tested)

**Test Categories**:
1. **Detection accuracy** - True positives (XML with/without failures), true negatives (non-XML)
2. **Extraction completeness** - Single failure, multiple failures, all passing tests
3. **Error type detection** - AssertionError, TypeError, ENOENT, timeout
4. **Location parsing** - file:line, file:line:column formats, missing location
5. **Test hierarchy** - Context preservation, HTML entity decoding
6. **Edge cases** - Empty XML, invalid XML, passing tests, error limits (10 max)
7. **Guidance generation** - Error-type-specific advice
8. **Sample validation** - Verify plugin samples produce expected results

## Common Modifications

### Adding New Error Type Guidance
```typescript
// In getJUnitGuidance()
if (messages.some((m) => m.includes('your-pattern'))) {
  guidance.push('Your guidance here');
}
```

### Adjusting Confidence
```typescript
// In detect() return values
if (output.includes('<failure')) {
  return {
    confidence: 90,  // High confidence for failures
    patterns: ['<testsuite>', '<failure>'],
    reason: 'JUnit XML format with test failures detected',
  };
}
```

### Supporting New XML Attributes
```typescript
// In extractFailures()
const newAttribute = extractXmlAttribute(testcaseTag, 'your-attribute');
```

## Hints (Fast Filtering)

```typescript
hints: {
  required: ['<testsuite'],  // Must contain "<testsuite"
  anyOf: [],                  // No secondary patterns needed
}
```

**Why these hints?** Single simple check eliminates non-XML output before expensive regex parsing.

## Sample Test Cases

Plugin includes 2 built-in samples:
1. `single-test-failure` - Basic JUnit XML with one failure
2. `multiple-test-failures` - JUnit XML with multiple failures

**Usage**: Validate plugin behavior during development/CI.

## Location Extraction Logic

**Priority order**:
1. Extract from failure text: `❯ file:line:column` (Vitest format)
2. Fallback to `classname` attribute from `<testcase>` element
3. Default to `unknown:0` if nothing found

**Why this order?** Vitest failure text provides more precise file/line than classname (which may be suite name).

## HTML Entity Decoding

**Entities decoded**:
- `&gt;` → `>`
- `&lt;` → `<`
- `&quot;` → `"`
- `&apos;` → `'`
- `&amp;` → `&` (MUST be last to avoid double-decoding)

**Applied to**:
- Test names (context field)
- Error messages

## Error Limits

**MAX_ERRORS_IN_ARRAY = 10** (from `result-schema.ts`)

**Why limit?** Token efficiency for LLMs. Most test failures share common root causes - showing 10 is enough to identify patterns.

**Implementation**:
```typescript
const limitedErrors = errors.slice(0, MAX_ERRORS_IN_ARRAY);
```

## Guidance Generation Patterns

| Pattern | Guidance |
|---------|----------|
| `AssertionError` type or "expected" in message | Review test assertions |
| `TypeError` or "cannot read properties" | Check for null/undefined |
| "enoent" or "no such file" | Verify file paths |
| "timed out" or "timeout" | Increase timeout or optimize |

## Debugging Tips

1. **Detection not working?** Check if output contains `<testsuite` or `<testsuites`
2. **Extraction returning empty?** Verify `<failure>` elements exist in XML
3. **Location not parsing?** Check if failure text has `❯ file:line:column` format
4. **HTML entities showing?** Ensure `decodeHtmlEntities()` is called on message/context
5. **Tests failing?** Run `vv run npx vitest packages/extractors/src/extractors/junit/index.test.ts`

## Related Files

- `../../types.ts` - ExtractorPlugin interface definition
- `../../result-schema.ts` - MAX_ERRORS_IN_ARRAY constant (10)
- `../../extractor-registry.ts` - Registration point (not modified yet)

## Performance Notes

- **Detection**: O(n) two `includes()` checks (testsuite, failure)
- **Extraction**: O(n) regex parsing of `<testcase>` elements
- **Hints**: O(n) single `includes('<testsuite')` check before detection
- **Token Usage**: ~50-75 tokens per error (file:line:message:context)

## Known Edge Cases

1. **Missing location marker** - Falls back to classname attribute or "unknown"
2. **Invalid XML** - Returns error result with guidance to check format
3. **No failures** - Returns 0 errors (not an error condition)
4. **HTML entities in paths** - Currently NOT decoded in file paths (only messages/context)
5. **Multiple testsuites** - Parses all testsuites in single XML document

## Multi-Framework Compatibility

Works with any JUnit XML generator:
- Vitest (location marker: `❯`)
- Jest (via jest-junit)
- Mocha (via mocha-junit-reporter)
- Pytest (--junitxml)
- Gradle/Maven (Surefire/Failsafe)

**Common difference**: Location extraction. Some frameworks don't include precise file:line in failure text, so we fall back to classname attribute.

## Future Enhancements

Potential improvements (NOT implemented yet):
- Support for `<error>` elements (distinct from `<failure>`)
- Stack trace parsing for deeper context
- Skipped test reporting
- Test duration analysis
- Suite-level error aggregation
