# Generic Extractor

Fallback extractor for unknown validation output formats.

## Purpose

This extractor is used when no specialized extractor matches the output. It intelligently filters error-related content using keyword detection.

## Detection

Always returns lowest confidence (10) - used as last resort fallback.

## Features

- Extracts lines with error keywords (failed, error, exception, panic, etc.)
- Filters npm/package manager noise
- Limits output to 20 most relevant lines
- Supports multiple languages (Python, Go, Rust, Ruby, Java, C/C++, JS/TS)

## Example

### Input
```
FAILED tests/test_foo.py::test_divide - ZeroDivisionError
FAILED tests/test_bar.py::test_validate - AssertionError
2 failed, 3 passed
```

### Extracted
```yaml
summary: "Command failed - see output"
totalErrors: 0
errorSummary: |
  FAILED tests/test_foo.py::test_divide - ZeroDivisionError
  FAILED tests/test_bar.py::test_validate - AssertionError
  2 failed, 3 passed
```

## Metadata

- **Name:** `generic`
- **Version:** `1.0.0`
- **Priority:** 10 (lowest)
- **Tags:** generic, fallback
