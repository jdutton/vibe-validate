# @vibe-validate/extractors

LLM-optimized error extractors for validation output.

## Features

- **Intelligent Error Extraction**: Automatically detects tool type and applies appropriate extractor
- **Token-Efficient Output**: Limits errors to first 10, removes noise, focuses on actionable info
- **Actionable Guidance**: Provides tool-specific fixing suggestions
- **Zero Dependencies**: Pure TypeScript implementation

## Supported Extractors

- **TypeScript (tsc)**: Parses `file(line,col): error TSxxxx: message` format
- **ESLint**: Parses `file:line:col - severity message [rule]` format
- **Vitest/Jest**: Extracts test hierarchy, assertion errors, expected vs actual
- **OpenAPI**: Filters validation errors from specification validators
- **Generic**: Fallback for unknown tools (removes npm noise)

## Installation

```bash
npm install @vibe-validate/extractors
```

## Usage

### Smart Extractor (Recommended)

Auto-detects tool type from step name:

```typescript
import { extractByStepName } from '@vibe-validate/extractors';

const result = extractByStepName('TypeScript Type Checking', tscOutput);

console.log(result.summary);      // "3 type error(s), 0 warning(s)"
console.log(result.guidance);     // "Type mismatch - check variable/parameter types"
console.log(result.cleanOutput);  // Clean, formatted error list
console.log(result.errors);       // Structured error array
```

### Direct Extractor Usage

For explicit control:

```typescript
import {
  extractTypeScriptErrors,
  extractESLintErrors,
  extractVitestErrors,
  formatOpenAPIErrors,
  formatGenericErrors
} from '@vibe-validate/extractors';

const result = extractTypeScriptErrors(tscOutput);
```

### Utilities

```typescript
import { stripAnsiCodes, extractErrorLines } from '@vibe-validate/extractors';

const clean = stripAnsiCodes(colorfulOutput);
const errorLines = extractErrorLines(verboseOutput);
```

## API

### `extractByStepName(stepName: string, output: string): ErrorExtractorResult`

Smart extractor with auto-detection.

**Detection rules:**
- TypeScript: Step name contains "TypeScript" or "typecheck"
- ESLint: Step name contains "ESLint" or "lint"
- Vitest/Jest: Step name contains "test" (but not "OpenAPI")
- OpenAPI: Step name contains "OpenAPI"
- Generic: Fallback for unknown types

### Type Definitions

```typescript
interface FormattedError {
  file: string;
  line?: number;
  column?: number;
  message: string;
  code?: string;
  severity?: 'error' | 'warning';
  context?: string;
}

interface ErrorExtractorResult {
  errors: FormattedError[];        // First 10 errors (structured)
  summary: string;                 // Human-readable summary
  totalCount: number;              // Total error count
  guidance?: string;               // Actionable fixing guidance
  cleanOutput: string;             // Clean formatted output for YAML/JSON
}
```

## Why LLM-Optimized?

1. **Token Efficiency**: Limits output to first 10 errors (most relevant)
2. **Noise Removal**: Strips ANSI codes, npm headers, stack traces
3. **Structured Data**: Provides parseable error objects with file:line:col
4. **Actionable Guidance**: Suggests specific fixes based on error codes
5. **Clean Embedding**: `cleanOutput` ready for YAML/JSON state files

## Design Philosophy

**Agent-First**: Designed for consumption by AI assistants (Claude Code, Cursor, etc.), not just humans.

**Deterministic**: Same input always produces same output (no timestamps, no randomness).

**Minimal**: Zero runtime dependencies, pure TypeScript.

## License

MIT
