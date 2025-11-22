# Jest Error Extractor

Extracts and formats Jest test framework errors for LLM consumption.

## Features

- **High Confidence Detection (90%)** - Recognizes Jest-specific markers (FAIL, ✕, ●)
- **Hierarchy Tracking** - Preserves describe/test nesting structure
- **Dual Format Support** - Handles both inline (✕) and detailed (●) failure formats
- **Token Efficient** - Limits output to 10 most critical failures

## Detection Patterns

- `FAIL` marker - Jest test file failure indicator
- `✕` marker - Inline test failure indicator
- `●` marker - Detailed test failure format
- Test/suite hierarchy tracking via indentation

## Supported Formats

### Inline Failure Format
```
 FAIL test/example.test.ts
  Example Suite
    Nested Suite
      ✕ should pass (15 ms)
```

### Detailed Failure Format
```
 FAIL test/example.test.ts
  ● Example Suite › Nested Suite › should pass

    Expected: 5
    Received: 3
```

### Multiple Files
```
 FAIL test/first.test.ts
  Suite One
    ✕ test A (5 ms)

 FAIL test/second.test.ts
  Suite Two
    ✕ test B (8 ms)
```

## Hierarchy Tracking

The extractor preserves Jest's test hierarchy:

```
 FAIL test/example.test.ts
  Outer Suite              ← Level 1
    Inner Suite            ← Level 2
      ✕ nested test        → "Outer Suite › Inner Suite › nested test"
    ✕ outer test          → "Outer Suite › outer test"
```

Indentation is used to determine nesting levels, and the hierarchy resets when a new test file is encountered.

## Example Output

```yaml
errors:
  - file: test/example.test.ts
    line: 0
    column: 0
    severity: error
    message: "Example Suite › should validate input: Test failed"
summary: "2 test failure(s)"
totalErrors: 2
guidance: "Fix each failing test individually. Check test setup, mocks, and assertions."
errorSummary: |
  ● Example Suite › should validate input
    Test failed
    Location: test/example.test.ts

  ● Another Suite › should handle errors
    Test failed
    Location: test/example.test.ts
```

## Guidance

Provides actionable guidance for failing tests:
- "Fix each failing test individually. Check test setup, mocks, and assertions."

This encourages developers to:
1. Isolate each test failure
2. Review test setup code (beforeEach, beforeAll)
3. Check mock configurations
4. Verify assertions match expected behavior

## Priority

**90** - High confidence detection based on distinctive Jest markers

## Tags

`jest`, `testing`, `test-runner`

## Edge Cases Handled

- **Multiple test files** - Hierarchy resets per file
- **Deeply nested suites** - Handles arbitrary nesting levels
- **Mixed pass/fail** - Extracts only failures (ignores ✓ markers)
- **Missing timing info** - Handles tests without (ms) suffix
- **Special characters** - Preserves quotes, apostrophes, dashes in names
- **Module prefixes** - Strips "node_modules" from FAIL lines
- **Partial markers** - Lower confidence (50%) when only ✕/✓ present

## Limitations

- **Line/column numbers**: Jest doesn't always provide precise locations in summary output (defaults to 0)
- **Error details**: Captures hierarchy and "Test failed" message; detailed assertion info requires parsing stack traces
- **Performance**: Tracks full hierarchy stack per file; O(n) complexity for n lines of output
