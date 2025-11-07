# Schema Review: Validate and Run Output YAML

**Date**: 2025-11-02
**Reviewer**: Claude Code
**Purpose**: Review Zod schemas and actual YAML output for validation and run commands

---

## Executive Summary

### ✅ Validation Output
- **Schema**: Fully defined Zod schema (`ValidationResultSchema`)
- **Location**: `packages/core/src/result-schema.ts`
- **Status**: Well-structured, type-safe, validated

### ⚠️ Run Output
- **Schema**: TypeScript interface only (`RunResult`)
- **Location**: `packages/cli/src/commands/run.ts`
- **Status**: No Zod schema - potential inconsistency risk
- **Recommendation**: Add Zod schema for runtime validation

---

## 1. Validation Output Schema (`validate` command)

### Zod Schema Definition
**File**: `packages/core/src/result-schema.ts`

```typescript
export const ValidationResultSchema = z.object({
  passed: z.boolean(),
  timestamp: z.string(),
  treeHash: z.string(),
  phases: z.array(PhaseResultSchema).optional(),
  failedStep: z.string().optional(),
  fullLogFile: z.string().optional(),
  summary: z.string().optional(),
  isCachedResult: z.boolean().optional(), // v0.15.0+
});

// Note: v0.15.0 removed:
// - rerunCommand (use phases[].steps[].command)
// - failedStepOutput (use phases[].steps[].extraction)
// - failedTests (use phases[].steps[].extraction.errors)
```

### Actual YAML Output Example
```yaml
passed: true
timestamp: 2025-11-02T21:51:17.568Z
treeHash: b0d21362a332374f3237e70e18948e99a1dfa2a6
phases:
  - name: Pre-Qualification
    durationSecs: 5.5
    passed: true
    steps:
      - name: TypeScript Type Check
        passed: true
        durationSecs: 0.7
      - name: ESLint Code Quality
        passed: true
        durationSecs: 5.5
  - name: Testing
    durationSecs: 37.4
    passed: true
    steps:
      - name: Unit Tests with Coverage
        passed: true
        durationSecs: 37.4
```

### ✅ Strengths
1. **Full Zod validation**: Runtime type safety ensures consistent output
2. **JSON Schema generation**: Supports tooling and documentation
3. **Safe validation functions**: Both strict (`validateResult`) and safe (`safeValidateResult`) variants
4. **Clear type inference**: TypeScript types derived directly from schema

### ⚠️ Issues Found

#### Issue 1: Missing `failedTests` in step results
**Severity**: Medium
**Description**: The schema has `failedTests` at the top level, but steps can also have `failedTests` (seen in actual usage)

**Evidence**:
```typescript
// From packages/core/src/runner.ts:454
stepResult.failedTests = formatted.errors?.map(formatError) ?? [];
```

**Current schema** (StepResultSchema):
```typescript
export const StepResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  durationSecs: z.coerce.number(),
  output: z.string().optional(),
});
```

**Recommendation**:
```typescript
export const StepResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  durationSecs: z.coerce.number(),
  output: z.string().optional(),
  failedTests: z.array(z.string()).optional(), // ADD THIS
  extractionQuality: z.object({          // ADD THIS (for developerFeedback mode)
    detectedTool: z.string().optional(),
    confidence: z.string().optional(),
    score: z.number().optional(),
    warnings: z.number().optional(),
    errorsExtracted: z.number().optional(),
    actionable: z.boolean().optional(),
  }).optional(),
});
```

#### Issue 2: Timestamp not validated as ISO 8601
**Severity**: Low
**Description**: `timestamp` is `z.string()` but should validate ISO 8601 format

**Recommendation**:
```typescript
timestamp: z.string().datetime(), // Validates ISO 8601 format
```

---

## 2. Run Output Schema (`run` command)

### TypeScript Interface (No Zod Schema)
**File**: `packages/cli/src/commands/run.ts:19-37`

```typescript
interface RunResult {
  command: string;
  exitCode: number;
  extraction: ErrorExtractorResult;
  rawOutput?: string;
  suggestedDirectCommand?: string;
  [key: string]: unknown; // Allows additional fields from nested YAML
}
```

### Actual YAML Output Example
```yaml
---
command: echo 'test'
exitCode: 0
extraction:
  errors: []
  summary: test failed - see output
  totalCount: 1
  guidance: Review the output above and fix the errors
  cleanOutput: test
  metadata:
    confidence: 100
    completeness: 100
    issues: []
    detection:
      extractor: generic
      confidence: 50
      patterns:
        - no specific patterns
      reason: No specific tool detected, using generic extractor
rawOutput: |
  test
```

### ❌ Critical Issues

#### Issue 1: No Zod schema for validation
**Severity**: High
**Description**: `RunResult` is a TypeScript interface, not a Zod schema. No runtime validation occurs.

**Risks**:
- Invalid data could be written to git notes cache
- YAML output might be inconsistent
- No validation when reading cached results
- Schema drift between storage and retrieval

**Recommendation**: Create `RunResultSchema` in new file:

```typescript
// packages/cli/src/schemas/run-result-schema.ts

import { z } from 'zod';
import { ErrorExtractorResultSchema } from '@vibe-validate/extractors';

export const RunResultSchema = z.object({
  command: z.string(),
  exitCode: z.number(),
  extraction: ErrorExtractorResultSchema,
  rawOutput: z.string().optional(),
  suggestedDirectCommand: z.string().optional(),
}).passthrough(); // Allow additional fields from nested YAML

export type RunResult = z.infer<typeof RunResultSchema>;
```

#### Issue 2: `ErrorExtractorResult` also lacks Zod schema
**Severity**: High
**Description**: The nested `extraction` field references `ErrorExtractorResult` which is also just a TypeScript interface

**Current** (`packages/extractors/src/types.ts:80-98`):
```typescript
export interface ErrorExtractorResult {
  errors: FormattedError[];
  summary: string;
  totalCount: number;
  guidance?: string;
  cleanOutput: string;
  metadata?: ExtractionMetadata;
}
```

**Recommendation**: Create Zod schemas for the entire extractor type hierarchy:

```typescript
// packages/extractors/src/schemas.ts (NEW FILE)

import { z } from 'zod';

export const FormattedErrorSchema = z.object({
  file: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional(),
  message: z.string(),
  code: z.string().optional(),
  severity: z.enum(['error', 'warning']).optional(),
  context: z.string().optional(),
  guidance: z.string().optional(),
});

export const DetectionMetadataSchema = z.object({
  extractor: z.string(),
  confidence: z.number(),
  patterns: z.array(z.string()),
  reason: z.string(),
});

export const ExtractionMetadataSchema = z.object({
  detection: DetectionMetadataSchema.optional(),
  confidence: z.number(),
  completeness: z.number(),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()).optional(),
});

export const ErrorExtractorResultSchema = z.object({
  errors: z.array(FormattedErrorSchema),
  summary: z.string(),
  totalCount: z.number(),
  guidance: z.string().optional(),
  cleanOutput: z.string(),
  metadata: ExtractionMetadataSchema.optional(),
});

// Export inferred types
export type FormattedError = z.infer<typeof FormattedErrorSchema>;
export type DetectionMetadata = z.infer<typeof DetectionMetadataSchema>;
export type ExtractionMetadata = z.infer<typeof ExtractionMetadataSchema>;
export type ErrorExtractorResult = z.infer<typeof ErrorExtractorResultSchema>;
```

#### Issue 3: Index signature breaks type safety
**Severity**: Medium
**Description**: `[key: string]: unknown` allows any fields, defeating type checking

**Current**:
```typescript
interface RunResult {
  // ... defined fields
  [key: string]: unknown; // Allows ANYTHING
}
```

**Problem**: This completely bypasses TypeScript's type checking. Any field can be added.

**Better approach**: Use Zod's `.passthrough()` or `.catchall()`:
```typescript
export const RunResultSchema = z.object({
  command: z.string(),
  exitCode: z.number(),
  extraction: ErrorExtractorResultSchema,
  rawOutput: z.string().optional(),
  suggestedDirectCommand: z.string().optional(),
}).passthrough(); // Allows extra fields but still validates defined ones
```

---

## 3. Git Notes Storage Schema (`RunCacheNote`)

### TypeScript Interface
**File**: `packages/history/src/types.ts:169-197`

```typescript
export interface RunCacheNote {
  treeHash: string;
  command: string;
  workdir: string;
  timestamp: string;
  exitCode: number;
  duration: number;
  errors: Array<{
    file?: string;
    line?: number;
    message: string;
  }>;
  summary: string;
}
```

### ⚠️ Issue: No Zod schema for cache notes
**Severity**: High
**Description**: Cache notes written to git are not validated

**Recommendation**:
```typescript
// packages/history/src/schemas.ts (NEW FILE)

import { z } from 'zod';

export const RunCacheNoteSchema = z.object({
  treeHash: z.string(),
  command: z.string(),
  workdir: z.string(),
  timestamp: z.string().datetime(),
  exitCode: z.number(),
  duration: z.number(),
  errors: z.array(z.object({
    file: z.string().optional(),
    line: z.number().optional(),
    message: z.string(),
  })),
  summary: z.string(),
});

export type RunCacheNote = z.infer<typeof RunCacheNoteSchema>;
```

**Why this matters**:
- Git notes are persisted storage (like a database)
- Corrupted data could break cache reads
- No validation when reading from git notes
- Schema evolution without validation = breaking changes

---

## 4. Comparison & Inconsistencies

### Field Naming Inconsistencies

| Field | Validation Output | Run Output | Cache Note | Issue |
|-------|------------------|------------|------------|-------|
| Duration | `durationSecs` (number) | N/A | `duration` (ms) | Different units! |
| Timestamp | `timestamp` (string) | N/A | `timestamp` (string) | Consistent ✓ |
| Exit Code | N/A | `exitCode` (number) | `exitCode` (number) | Consistent ✓ |
| Errors | `failedTests` (string[]) | `extraction.errors` (object[]) | `errors` (object[]) | Different structure |

### ⚠️ Duration Units Mismatch
**Severity**: Medium

- **ValidationResult**: `durationSecs` (seconds as number)
- **RunCacheNote**: `duration` (milliseconds as number)

**Recommendation**: Standardize on seconds with decimal precision:
```typescript
// Everywhere
duration: z.number().describe('Duration in seconds with decimal precision')
```

---

## 5. Recommendations Summary

### Priority 1 (High - Before v0.15.0 release)

1. **Add `RunResultSchema`** (Zod schema for run command output)
   - File: `packages/cli/src/schemas/run-result-schema.ts`
   - Validates output before writing to stdout
   - Validates cached results when reading from git notes

2. **Add `ErrorExtractorResultSchema`** (Zod schema for extractor output)
   - File: `packages/extractors/src/schemas.ts`
   - Validates all extractor outputs
   - Ensures consistent extraction API

3. **Add `RunCacheNoteSchema`** (Zod schema for git notes storage)
   - File: `packages/history/src/schemas.ts`
   - Validates before writing to git notes
   - Validates when reading from git notes

4. **Fix `StepResultSchema`** (add missing fields)
   - Add `failedTests: z.array(z.string()).optional()`
   - Add `extractionQuality` object (for developerFeedback mode)

### Priority 2 (Medium - Before v0.16.0)

5. **Standardize duration units**
   - Change `RunCacheNote.duration` from milliseconds to seconds
   - Use `durationSecs` everywhere
   - Migration: Read old notes, convert ms → seconds

6. **Validate timestamp format**
   - Change `z.string()` to `z.string().datetime()`
   - Ensures ISO 8601 compliance

### Priority 3 (Low - Future improvements)

7. **Generate JSON Schema files**
   - Like `validate-result.schema.json`, create:
     - `run-result.schema.json`
     - `error-extractor-result.schema.json`
     - `run-cache-note.schema.json`
   - Enables IDE autocomplete for YAML files

8. **Add schema validation tests**
   - Test schema validation with real-world data
   - Test schema validation with malformed data
   - Test backward compatibility

---

## 6. Example Implementation

### Step 1: Create extractors schema

```typescript
// packages/extractors/src/schemas.ts
import { z } from 'zod';

export const FormattedErrorSchema = z.object({
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  message: z.string(),
  code: z.string().optional(),
  severity: z.enum(['error', 'warning']).optional(),
  context: z.string().optional(),
  guidance: z.string().optional(),
});

export const ErrorExtractorResultSchema = z.object({
  errors: z.array(FormattedErrorSchema),
  summary: z.string(),
  totalCount: z.number().int().nonnegative(),
  guidance: z.string().optional(),
  cleanOutput: z.string(),
  metadata: z.object({
    confidence: z.number().min(0).max(100),
    completeness: z.number().min(0).max(100),
    issues: z.array(z.string()),
    detection: z.object({
      extractor: z.string(),
      confidence: z.number().min(0).max(100),
      patterns: z.array(z.string()),
      reason: z.string(),
    }).optional(),
    suggestions: z.array(z.string()).optional(),
  }).optional(),
});

export type FormattedError = z.infer<typeof FormattedErrorSchema>;
export type ErrorExtractorResult = z.infer<typeof ErrorExtractorResultSchema>;
```

### Step 2: Create run result schema

```typescript
// packages/cli/src/schemas/run-result-schema.ts
import { z } from 'zod';
import { ErrorExtractorResultSchema } from '@vibe-validate/extractors';

export const RunResultSchema = z.object({
  command: z.string().min(1),
  exitCode: z.number().int(),
  extraction: ErrorExtractorResultSchema,
  rawOutput: z.string().optional(),
  suggestedDirectCommand: z.string().optional(),
}).passthrough(); // Allow additional fields from nested YAML merging

export type RunResult = z.infer<typeof RunResultSchema>;

export function validateRunResult(data: unknown): RunResult {
  return RunResultSchema.parse(data);
}
```

### Step 3: Use validation in run command

```typescript
// packages/cli/src/commands/run.ts
import { validateRunResult, RunResultSchema } from '../schemas/run-result-schema.js';

// Before writing to stdout
const result = {
  command: commandString,
  exitCode: code,
  extraction: extracted,
  rawOutput: outputTruncated,
};

// Validate before output
const validatedResult = validateRunResult(result);
process.stdout.write('---\n');
process.stdout.write(yaml.stringify(validatedResult));

// When reading from cache
const cachedResult = await tryGetCachedResult(commandString);
if (cachedResult) {
  // Validate cached data
  const validatedCache = validateRunResult(cachedResult);
  // Use validated data...
}
```

---

## 7. Testing Plan

### Unit Tests

```typescript
// packages/cli/test/schemas/run-result-schema.test.ts
import { describe, it, expect } from 'vitest';
import { RunResultSchema } from '../../src/schemas/run-result-schema.js';

describe('RunResultSchema', () => {
  it('should validate valid run result', () => {
    const validResult = {
      command: 'npm test',
      exitCode: 0,
      extraction: {
        errors: [],
        summary: 'All tests passed',
        totalCount: 0,
        guidance: '',
        cleanOutput: '',
      },
    };

    expect(() => RunResultSchema.parse(validResult)).not.toThrow();
  });

  it('should reject invalid exit code', () => {
    const invalidResult = {
      command: 'npm test',
      exitCode: 'zero', // Should be number
      extraction: {
        errors: [],
        summary: 'All tests passed',
        totalCount: 0,
        cleanOutput: '',
      },
    };

    expect(() => RunResultSchema.parse(invalidResult)).toThrow();
  });

  it('should allow passthrough fields from nested YAML', () => {
    const resultWithExtra = {
      command: 'npm test',
      exitCode: 0,
      extraction: { /* ... */ },
      phases: [], // Extra field from nested validate YAML
      treeHash: 'abc123', // Extra field
    };

    const result = RunResultSchema.parse(resultWithExtra);
    expect(result.phases).toBeDefined();
    expect(result.treeHash).toBe('abc123');
  });
});
```

---

## 8. Breaking Changes Required

### For v0.15.0 (if implementing now)

**Option A: Non-breaking (recommended)**
- Add schemas alongside existing interfaces
- Validate on write, but accept unvalidated on read
- Log warnings for schema violations
- Full enforcement in v0.16.0

**Option B: Breaking (more correct)**
- Add schemas and enforce immediately
- May fail to read old cache notes
- Requires cache invalidation

**Recommendation**: Use Option A for gradual migration

---

## Appendix: Full Type Hierarchies

### Validation Output Type Tree
```
ValidationResult
├── passed: boolean
├── timestamp: string
├── treeHash: string
├── phases?: PhaseResult[]
│   └── PhaseResult
│       ├── name: string
│       ├── durationSecs: number
│       ├── passed: boolean
│       ├── steps: StepResult[]
│       │   └── StepResult
│       │       ├── name: string
│       │       ├── passed: boolean
│       │       ├── durationSecs: number
│       │       ├── output?: string
│       │       └── extraction?: ErrorExtractorResult (v0.15.0+)
│       │           ├── summary: string
│       │           ├── totalErrors: number
│       │           ├── errors: FormattedError[]
│       │           └── guidance?: string
│       └── output?: string
├── failedStep?: string
├── fullLogFile?: string
├── summary?: string
└── isCachedResult?: boolean (v0.15.0+)

// v0.15.0 removed: rerunCommand, failedStepOutput, failedTests
```

### Run Output Type Tree
```
RunResult
├── command: string
├── exitCode: number
├── extraction: ErrorExtractorResult (NO SCHEMA)
│   └── ErrorExtractorResult
│       ├── errors: FormattedError[] (NO SCHEMA)
│       │   └── FormattedError
│       │       ├── file?: string
│       │       ├── line?: number
│       │       ├── column?: number
│       │       ├── message: string
│       │       ├── code?: string
│       │       ├── severity?: 'error' | 'warning'
│       │       ├── context?: string
│       │       └── guidance?: string
│       ├── summary: string
│       ├── totalCount: number
│       ├── guidance?: string
│       ├── cleanOutput: string
│       └── metadata?: ExtractionMetadata (NO SCHEMA)
│           └── ExtractionMetadata
│               ├── detection?: DetectionMetadata
│               ├── confidence: number
│               ├── completeness: number
│               ├── issues: string[]
│               └── suggestions?: string[]
├── rawOutput?: string
├── suggestedDirectCommand?: string
└── [key: string]: unknown (TYPE SAFETY HOLE)
```

---

## Conclusion

The **validation output** has a solid Zod schema foundation but is missing a few fields that are actually used in practice (`failedTests` in steps, `extractionQuality`).

The **run output** lacks any Zod schemas, relying entirely on TypeScript interfaces. This creates several risks:
- No runtime validation
- Inconsistent YAML output
- Cache corruption risk
- Schema drift

**Recommended action**: Create Zod schemas for run output and extractors package before v0.15.0 release to ensure type safety and data integrity.
