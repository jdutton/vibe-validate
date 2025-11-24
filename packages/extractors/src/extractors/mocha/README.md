# Mocha Error Extractor

Extracts and formats Mocha test framework errors for LLM consumption.

## Features

- **High Confidence Detection (85%)** - Recognizes `failing`/`passing` patterns
- **Test Hierarchy Preservation** - Maintains suite/test context
- **Multi-Error Type Support** - Handles AssertionError, TypeError, timeouts, etc.
- **Stack Trace Parsing** - Extracts file locations from various formats
- **Token Efficient** - Limits output to 10 most critical errors

## Detection Patterns

- `failing` - Mocha failure count (e.g., "3 failing")
- `passing` - Mocha passing count (e.g., "5 passing")

## Supported Error Types

### AssertionError
```
AssertionError [ERR_ASSERTION]: Expected 4 to equal 5
  at Context.<anonymous> (test.js:16:14)
```

### TypeError
```
TypeError: Cannot read properties of null (reading 'foo')
  at Context.<anonymous> (test.js:15:20)
```

### Timeout Errors
```
Error: Timeout of 100ms exceeded
  at listOnTimeout (node:internal/timers:608:17)
```

### File System Errors
```
Error: ENOENT: no such file or directory
  at Context.<anonymous> (test.js:20:10)
```

## Path Formats

Supports multiple path formats:
- `file:///path/to/test.js:42:15` - File URL format
- `/absolute/path/test.js:50:10` - Absolute path
- `tests/unit/helpers.test.js:128:30` - Relative path

## Test Hierarchy

Preserves nested describe/it structure:
```
1) Outer Suite
     Inner Suite
       Deep Suite
         should do something:
   Error: Test error
```

Extracted context: "Outer Suite > Inner Suite > Deep Suite > should do something"

## Example Output

```yaml
errors:
  - file: test.js
    line: 16
    message: Expected 4 to equal 5
    context: "Vibe-Validate Mocha Test Matrix > Failure Type 1: Assertion Errors > should match expected value"
    severity: error
summary: "1 test(s) failed"
totalErrors: 1
guidance: "Review test assertion logic"
```

## Priority

**85** - Distinctive patterns (failing/passing), checked mid-chain after more specific extractors

## Tags

`mocha`, `testing`, `javascript`
