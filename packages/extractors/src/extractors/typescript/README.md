# TypeScript Error Extractor

Extracts and formats TypeScript compiler (tsc) errors for LLM consumption.

## Features

- **High Confidence Detection (95%)** - Recognizes `error TS####` pattern
- **Dual Format Support** - Handles both old and new tsc output formats
- **Smart Guidance** - Provides error-code-specific fix suggestions
- **Token Efficient** - Limits output to 10 most critical errors

## Detection Patterns

- `error TS\d+:` - TypeScript error code pattern (e.g., TS2322, TS2304)

## Supported Formats

### Old Format (tsc < 5.0)
```
src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
```

### New Format (tsc >= 5.0)
```
src/index.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.
```

## Error Code Guidance

| Error Code | Guidance |
|------------|----------|
| **TS2322** | Type mismatch - check variable/parameter types |
| **TS2304** | Cannot find name - check imports and type definitions |
| **TS2345** | Argument type mismatch - check function signatures |
| **Others** | Fix TypeScript type errors in listed files |

## Example Output

```yaml
errors:
  - file: src/index.ts
    line: 10
    column: 5
    severity: error
    code: TS2322
    message: Type 'string' is not assignable to type 'number'.
summary: "2 type error(s), 0 warning(s)"
totalErrors: 2
guidance: "Type mismatch - check variable/parameter types"
```

## Priority

**95** - Very distinctive error codes (TS####), checked early in detection chain

## Tags

`typescript`, `compiler`, `type-checking`
