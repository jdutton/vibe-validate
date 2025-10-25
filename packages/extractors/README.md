# @vibe-validate/extractors

LLM-optimized error extractors for validation output.

## Features

- **Intelligent Error Extraction**: Automatically detects tool type and applies appropriate extractor
- **Token-Efficient Output**: Limits errors to first 10, removes noise, focuses on actionable info
- **Actionable Guidance**: Provides tool-specific fixing suggestions
- **Zero Dependencies**: Pure TypeScript implementation

## Supported Extractors

### Test Frameworks
- **Vitest**: Dual format support (Format 1 & 2), assertion errors, test hierarchy
- **Jest**: Comprehensive error extraction, all failure types supported
- **Mocha**: Native Mocha output format, stack trace parsing
- **Jasmine**: Angular ecosystem support, Message:/Stack: section parsing
- **TAP (Test Anything Protocol)**: Covers Tape, node-tap, YAML diagnostics parsing
- **Ava**: Node.js community favorite, detailed block parsing with quality metadata
- **Playwright**: Modern E2E testing, numbered failure blocks, stack trace extraction
- **JUnit XML**: Universal test format for any framework with XML output

### Code Quality Tools
- **TypeScript (tsc)**: Parses `file(line,col): error TSxxxx: message` format
- **ESLint**: Parses `file:line:col - severity message [rule]` format
- **OpenAPI**: Filters validation errors from specification validators

### Fallback
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

Use direct extractors when:
- You know the exact tool being used
- You want explicit control over extraction
- You need tool-specific options

**Example: Using Jest extractor directly**

```typescript
import { extractJestErrors } from '@vibe-validate/extractors';
import { execSync } from 'child_process';

const jestOutput = execSync('npx jest --no-coverage').toString();
const result = extractJestErrors(jestOutput);

console.log(`Found ${result.errors.length} test failures`);
console.log(`Quality: ${result.metadata?.confidence}% confidence`);
result.errors.forEach(error => {
  console.log(`  ${error.file}:${error.line} - ${error.message}`);
});
```

**All available extractors:**

```typescript
import {
  // Test framework extractors
  extractVitestErrors,
  extractJestErrors,
  extractMochaErrors,
  extractJasmineErrors,
  extractTAPErrors,
  extractAvaErrors,
  extractPlaywrightErrors,
  extractJUnitErrors,

  // Code quality extractors
  extractTypeScriptErrors,
  extractESLintErrors,
  extractOpenAPIErrors,

  // Fallback
  extractGenericErrors
} from '@vibe-validate/extractors';
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
- Vitest: Output contains `❯` marker or `FAIL` keyword
- Jest: Output contains `FAIL` or `●` bullet pattern
- Mocha: Output contains Mocha's passing/failing summary format
- Jasmine: Output contains "Failures:" header
- TAP: Output contains "TAP version" or "not ok" format
- Ava: Output contains `✘ [fail]:` pattern
- Playwright: Output contains `✘` with `.spec.ts` references
- JUnit XML: Output starts with `<?xml` and contains `<testsuite>`
- OpenAPI: Step name contains "OpenAPI"
- Generic: Fallback for unknown types

### Type Definitions

```typescript
interface FormattedError {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  code?: string;
  severity?: 'error' | 'warning';
  context?: string;
  guidance?: string;
}

interface ExtractionMetadata {
  confidence: number;              // 0-100: Based on pattern match quality
  completeness: number;            // % of failures with file + line + message
  issues: string[];                // Problems encountered during extraction
  suggestions?: string[];          // For developerFeedback mode only
}

interface ErrorExtractorResult {
  errors: FormattedError[];        // First 10 errors (structured)
  summary: string;                 // Human-readable summary
  totalCount: number;              // Total error count
  guidance?: string;               // Actionable fixing guidance
  cleanOutput: string;             // Clean formatted output for YAML/JSON
  metadata?: ExtractionMetadata;   // Extraction quality metadata
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
