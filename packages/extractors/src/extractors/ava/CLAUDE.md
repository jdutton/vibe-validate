# Ava Extractor - Claude Code Guidance

This file provides guidance to Claude Code when working on this extractor.

## What This Extractor Does

Parses Ava test framework output to extract test failures with file, line, and error messages. Handles multi-line error context, test hierarchy (using ›), and various error types (assertions, timeouts, TypeErrors, etc.).

## Plugin Architecture

This extractor follows the **ExtractorPlugin** interface:

```typescript
{
  metadata: { name, version, author, description, repository, tags },
  hints: { required, anyOf, forbidden },
  priority: number,
  detect(output: string): DetectionResult,
  extract(output: string, command?: string): ErrorExtractorResult,
  samples: ExtractorSample[],
}
```

### Key Principles

1. **No File I/O** - Extractor receives `output: string` parameter only (safe for sandboxing)
2. **Hints for Performance** - Simple string.includes() checks filter candidates before expensive detect()
3. **Samples Required** - Real-world test data co-located for forking and testing
4. **Metadata is Source of Truth** - Registration name comes from `metadata.name`, not directory name

## Code Structure

### Files
- `index.ts` - Main plugin export with detect() and extract() functions
- `samples/` - Real-world Ava test output samples
- `index.test.ts` - Comprehensive test suite
- `README.md` - Human-readable documentation
- `CLAUDE.md` - This file (LLM-specific guidance)

## Detection Logic

### Two-Phase Detection

**Phase 1: Fast Hints (string.includes() only)**
```typescript
hints: {
  anyOf: ['✘', '[fail]', 'file://'],  // At least one must be present
}
```

**Phase 2: Precise Detection (if hints match)**
```typescript
detect(output: string): DetectionResult {
  // Additive scoring based on patterns found
  // Returns confidence 0-100
}
```

### Confidence Scoring

- `✘ [fail]:` marker: **+30 points**
- Test hierarchy with `›`: **+20 points**
- `file://` URL format: **+20 points**
- Timeout messages: **+10 points**

**Threshold:** 70 points = high confidence
**Range:** 40-69 = possible, <40 = not Ava output

## Common Patterns & Gotchas

### Two-Pass Extraction Strategy

Ava output has two representations of each failure:
1. **Summary line** (at top): `✘ [fail]: Test › name message`
2. **Detailed block** (below): Full error with file, line, context

**Extraction logic:**
1. Find detailed headers (lines with `›` that aren't summary lines)
2. For each header, parse the block below to extract file, line, message
3. Fallback to summary lines if no detailed headers found

### Test Hierarchy

Ava uses `›` to show nested test structure:
```
Extractors › Assertion Errors › should validate
```

**Preservation:** Store entire hierarchy in `context` field for LLM understanding

### File Location Formats

Ava uses multiple formats:

**Format 1: Regular path**
```
tests/ava/test.js:28
```

**Format 2: file:// URL**
```
› file://tests/ava/test.js:28:5
```

**Format 3: Absolute path in stack trace**
```
at file:///Users/jeff/project/tests/test.js:118:21
```

**Extraction strategy:**
1. Try regular path format first
2. Try file:// URL format
3. Search stack trace for file:// URLs
4. Skip node_modules and ava/lib files

### Multi-line Error Context

Ava errors span multiple lines:
```
Error thrown in test:

TypeError {
  message: 'Cannot read properties...',  ← Extract this
  code: 'ENOENT',                         ← Use for error type detection
}

TypeError: Cannot read properties...     ← Also extract (fallback)
    at file://path/to/file.js:42:10      ← Extract location from stack
```

**State machine:**
1. Detect `TypeError {` or `Error {` (enter error object state)
2. Extract `message:` property
3. Extract `code:` property (for type detection)
4. Detect `}` (exit error object state)
5. Look for `Error:` line as fallback
6. Search stack trace for location

### Code Snippets

Ava shows code snippets with line numbers:
```
  28:   t.is(result.errors.length, 5, 'should have 5 errors');
       ^
```

**Detection:** Lines starting with `\d+:` indicate code snippet
**Use:** Set `foundCodeSnippet = true` to enable assertion message extraction

### Assertion Messages

After code snippet, before `Difference` section:
```
  28:   t.is(1, 2, 'error message');

  error message          ← Extract this as message

  Difference...
```

**Conditions for extraction:**
- After code snippet
- Before `Difference` section
- Not a line number
- Not a file path
- Reasonable length (< 150 chars)

## Error Type Detection

Automatically detects error types from message content:

| Pattern | Error Type | Guidance |
|---------|-----------|----------|
| timeout, timed out | timeout | Increase timeout with t.timeout() |
| ENOENT, no such file | file-not-found | Verify file path |
| Cannot read properties, TypeError | type-error | Check for null/undefined |
| expected, should, Difference | assertion | Review assertion logic |
| cannot find module | import-error | Verify module path |

**Code detection:**
- `code: 'ENOENT'` → file-not-found
- `code: 'ERR_MODULE_NOT_FOUND'` → import-error

## Testing Requirements

**CRITICAL:** All changes MUST include tests with real Ava output.

### Test Data Requirements

1. **Real-world samples** - Use actual Ava test output (not hand-crafted)
2. **Co-located** - Store in `samples/` directory
3. **Comprehensive** - Cover all error types (assertions, timeouts, TypeErrors, etc.)

### Running Tests

```bash
# All ava tests
pnpm test ava

# Specific test
pnpm test ava -t "should extract assertion errors"

# Watch mode
pnpm test:watch ava
```

## Common Modifications

### Adding New Error Pattern

1. **Update `detectErrorType()`** with new pattern
2. **Add to `getErrorGuidance()`** with appropriate guidance
3. **Add sample** to `samples/` demonstrating the pattern
4. **Add test** in `index.test.ts`

### Improving Location Extraction

Location extraction is complex due to multiple formats. When improving:

1. **Test all formats** (regular path, file:// URL, absolute path)
2. **Verify stack trace filtering** (skip node_modules, ava/lib)
3. **Add test cases** for each new format

### Adjusting Detection Confidence

If false positives/negatives occur:
1. Review `hints` - are they too broad/narrow?
2. Review `detect()` scoring - do patterns need reweighting?
3. Add test case demonstrating the issue
4. Adjust hints or detection logic

## Security Considerations

This extractor is **SAFE for sandboxed execution**:
- ✅ **No file I/O** - Only reads `output: string` parameter
- ✅ **No process execution** - No `child_process`, `exec`, `spawn`
- ✅ **No network access** - No `fetch`, `http`, `https`
- ✅ **No dangerous APIs** - No `eval`, `Function()`, `require()`
- ✅ **Deterministic** - Same input always produces same output

## Questions or Issues?

- Review `README.md` for user-facing documentation
- Check `../../types.ts` for ExtractorPlugin interface
- See `../../extractor-registry.ts` for how extractors are registered
- Reference other extractors in `../` for patterns
