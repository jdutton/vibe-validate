# TAP Extractor

Extracts test failures from TAP (Test Anything Protocol) output.

## Supported Formats

- TAP version 13
- tape test framework
- node-tap
- YAML diagnostic blocks

## Detection Patterns

This extractor looks for:
- `TAP version N` header (30 points)
- `not ok N` failure markers (20 points)
- YAML diagnostic blocks `---` (15 points)
- Test comment markers `#` (10 points)

**Detection threshold:** 60 points minimum for high confidence

## Example Output

### Input (TAP Failure)
```
TAP version 13
# Test › should validate
not ok 1 should have 5 errors
  ---
    operator: equal
    expected: 5
    actual: 1
    at: Test.<anonymous> (file:///tmp/test.js:28:5)
  ...
```

### Extracted
```yaml
totalErrors: 1
summary: "1 test(s) failed"
errors:
  - file: /tmp/test.js
    line: 28
    message: "should have 5 errors"
    context: "Test › should validate"
```

## Metadata

- **Name:** `tap`
- **Version:** `1.0.0`
- **Priority:** 78
- **Tags:** tap, test, tape, node-tap
