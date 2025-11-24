# TAP Extractor - Claude Code Guidance

## What This Extractor Does

Parses TAP (Test Anything Protocol) output to extract test failures. TAP is a simple text-based format used by tape, node-tap, and other frameworks.

## TAP Format

```
TAP version 13
# Comment (test name)
ok 1 passing test
not ok 2 failing test
  ---
    operator: equal
    at: file.js:10:5
  ...
```

## Key Patterns

- **Test names:** Lines starting with `#`
- **Failures:** Lines starting with `not ok N`
- **Diagnostics:** YAML blocks between `---` and `...`
- **Location:** Extracted from `at:` field in YAML

## Detection Strategy

Uses additive scoring:
- TAP version header: +30
- not ok markers: +20
- YAML blocks: +15
- Test comments: +10

Threshold: 60 points for high confidence

## Security

Safe for sandboxed execution (no file I/O, process execution, or network access).
