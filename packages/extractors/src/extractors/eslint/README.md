# ESLint Error Extractor

Extracts and formats ESLint linting errors for LLM consumption.

## Features

- **Good Confidence Detection (85%)** - Recognizes ESLint error/warning patterns
- **Dual Format Support** - Handles both modern and stylish output formats
- **Smart Deduplication** - Prefers @typescript-eslint rules over base ESLint rules
- **Rule-Specific Guidance** - Provides actionable fix suggestions
- **Token Efficient** - Limits output to 10 most critical errors

## Detection Patterns

- `file:line:col: error/warning rule-name` - Modern format
- Indented `line:col error/warning` - Stylish format

## Supported Formats

### Modern Format
```
src/index.ts:10:5: error Unexpected console statement no-console
src/config.ts:25:12: warning 'unusedVar' is defined but never used @typescript-eslint/no-unused-vars
```

### Stylish Format
```
src/index.ts
  10:5  error  Unexpected console statement  no-console
  25:12  warning  'unusedVar' is defined but never used  @typescript-eslint/no-unused-vars
```

## Rule-Specific Guidance

| Rule | Guidance |
|------|----------|
| **@typescript-eslint/no-unused-vars** | Remove or prefix unused variables with underscore |
| **no-console** | Replace console.log with logger |
| **Others** | Fix ESLint errors - run with --fix to auto-fix some issues |

## Deduplication Strategy

When multiple rules report errors at the same location:
1. Prefer `@typescript-eslint/*` rules over base ESLint rules
2. Take first rule if no TypeScript ESLint rule found

**Example**: Both `no-unused-vars` and `@typescript-eslint/no-unused-vars` at same location → Keep only `@typescript-eslint/no-unused-vars`

## Example Output

```yaml
errors:
  - file: src/index.ts
    line: 10
    column: 5
    severity: error
    code: no-console
    message: Unexpected console statement (no-console)
summary: "2 ESLint error(s), 1 warning(s)"
totalErrors: 2
guidance: "Replace console.log with logger. Remove or prefix unused variables with underscore"
```

## Priority

**85** - Distinctive patterns but less unique than TypeScript errors, checked after high-confidence extractors

## Tags

`eslint`, `linter`, `javascript`, `typescript`
