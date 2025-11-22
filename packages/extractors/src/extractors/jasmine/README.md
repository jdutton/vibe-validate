# Jasmine Error Extractor

Extracts and formats Jasmine test framework errors for LLM consumption.

## Features

- **High Confidence Detection (85%)** - Recognizes `spec`/`Failures:` patterns
- **Structured Output Parsing** - Parses `Message:` and `Stack:` sections
- **Multi-Error Type Support** - Handles assertions, TypeErrors, timeouts, etc.
- **Stack Trace Parsing** - Extracts file locations from UserContext frames
- **Token Efficient** - Limits output to 10 most critical errors

## Detection Patterns

- `spec` - Jasmine spec count (e.g., "3 specs, 1 failure")
- `Failures:` - Jasmine failures section header

## Supported Output Format

### Standard Jasmine Output
```
Started
F

Failures:
1) Test Suite > Test Name
  Message:
    Expected 4 to equal 5.
  Stack:
        at <Jasmine>
        at UserContext.<anonymous> (test.js:16:14)
        at <Jasmine>

1 spec, 1 failure
```

## Supported Error Types

### Assertion Errors
```
Message:
  Expected 'number' to equal 'string'.
```

### TypeErrors
```
Message:
  TypeError: Cannot read properties of null (reading 'foo')
```

### Timeout Errors
```
Message:
  Error: Timeout - Async function did not complete within 100ms
```

### File System Errors
```
Message:
  Error: ENOENT: no such file or directory
```

## Path Formats

Supports multiple path formats:
- `/absolute/path/test.js:42:15` - Absolute path
- `tests/unit/helpers.test.js:128:30` - Relative path

## Test Hierarchy

Preserves full test hierarchy in context:
```
1) Vibe-Validate Jasmine Test Matrix Failure Type 10: Nested Describe Blocks Level 2 Level 3 should work at deep nesting
```

Extracted context includes full suite and test name chain.

## Example Output

```yaml
errors:
  - file: /private/tmp/jasmine-comprehensive.test.js
    line: 9
    message: Expected 4 to equal 5.
    context: "Vibe-Validate Jasmine Test Matrix Failure Type 1: Assertion Errors should match expected value"
    severity: error
summary: "1 test(s) failed"
totalErrors: 1
guidance: "Review test assertion logic"
```

## Priority

**85** - Distinctive patterns (spec/Failures:), checked mid-chain

## Tags

`jasmine`, `testing`, `javascript`
