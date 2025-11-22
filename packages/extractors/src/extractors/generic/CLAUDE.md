# Generic Extractor - Claude Code Guidance

## What This Extractor Does

Fallback extractor for unknown formats. Filters output to extract error-related content using keyword detection.

## Design Philosophy

- **Last resort:** Only used when no specialized extractor matches
- **Keyword-based:** Looks for common error patterns (failed, error, panic, etc.)
- **Token efficient:** Limits to 20 most relevant lines
- **Multi-language:** Works with Python, Go, Rust, Ruby, Java, C/C++, JS/TS

## Detection Strategy

Always returns confidence of 10 (lowest priority) to ensure specialized extractors are tried first.

## Extraction Strategy

1. Scan for error keywords
2. Extract file:line patterns
3. Filter npm/package manager noise
4. Limit to 20 lines

## Important

Generic extractor does NOT populate the errors array - only errorSummary. This is intentional since it can't reliably parse structure from unknown formats.

## Security

Safe for sandboxed execution (no file I/O, process execution, or network access).
