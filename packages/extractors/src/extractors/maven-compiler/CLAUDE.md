# Maven Compiler Extractor - Claude Code Guidance

This file provides guidance to Claude Code when working on this extractor.

## What This Extractor Does

Parses Maven compiler plugin output to extract Java compilation errors with file, line, column, and error messages. Handles multi-line error context (symbol, location) that follows the main error line.

## Plugin Architecture

This extractor follows the **ExtractorPlugin** interface:

```typescript
{
  metadata: { name, version, author, description, repository, tags },
  hints: { required, anyOf, forbidden },
  priority: number,
  detect(output: string): DetectionResult,
  extract(output: string, command?: string): ErrorExtractorResult,
  samples: ExtractorSample[],
}
```

### Key Principles

1. **No File I/O** - Extractor receives `output: string` parameter only (safe for sandboxing)
2. **Hints for Performance** - Simple string.includes() checks filter candidates before expensive detect()
3. **Samples Required** - Real-world test data co-located for forking and testing
4. **Metadata is Source of Truth** - Registration name comes from `metadata.name`, not directory name

## Code Structure

### Files
- `index.ts` - Main plugin export with detect() and extract() functions
- `samples/` - Real-world Maven compiler output samples
- `index.test.ts` - Tests using samples (NOT YET MIGRATED - see Migration section below)
- `README.md` - Human-readable documentation
- `CLAUDE.md` - This file (LLM-specific guidance)

### Shared Utilities
- `../../maven-utils.ts` - `extractRelativePath()` function (shared by all Maven extractors)

## Detection Logic

### Two-Phase Detection

**Phase 1: Fast Hints (string.includes() only)**
```typescript
hints: {
  required: ['[ERROR]', '[INFO]'],        // Both must be present
  anyOf: ['COMPILATION ERROR', 'maven-compiler-plugin'],  // At least one
}
```

**Phase 2: Precise Detection (if hints match)**
```typescript
detect(output: string): DetectionResult {
  // Additive scoring based on patterns found
  // Returns confidence 0-100
}
```

### Confidence Scoring

- `[ERROR] COMPILATION ERROR` marker: **+30 points**
- `maven-compiler-plugin` reference: **+30 points**
- Error count summary (`[INFO] N errors`): **+20 points**
- File:[line,column] format: **+20 points**
- Java error patterns (cannot find symbol, etc.): **+10 points**

**Threshold:** 70 points = high confidence
**Range:** 40-69 = possible, <40 = not Maven compiler output

## Common Patterns & Gotchas

### Multi-line Error Context

Maven compiler errors span multiple lines:
```
[ERROR] /path/Foo.java:[42,25] cannot find symbol
  symbol:   method foo()     ← Context line (NO [ERROR] prefix)
  location: class Bar        ← Context line (NO [ERROR] prefix)
[ERROR] /path/Bar.java...    ← Next error (HAS [ERROR] prefix)
```

**Extraction logic:**
1. Match main error line with file:[line,col] pattern
2. Look ahead 1-5 lines for context (symbol:, location:)
3. Stop when hitting next Maven log line (starts with `[`)
4. Combine main message + context lines

### Path Extraction

**Input:** `/Users/jeff/workspace/project/src/main/java/com/example/Foo.java`

**Output:** `src/main/java/com/example/Foo.java`

**Logic:** Find first occurrence of `src/` and extract from there (Maven convention)

**Shared utility:** `extractRelativePath()` in `../../maven-utils.ts`

### Column Number Optional

Some errors don't have column numbers:
```
[ERROR] /path/File.java:[42] some error    ← No column
[ERROR] /path/File.java:[42,25] error      ← Has column
```

**Regex:** `:\[(\d+)(?:,(\d+))?\]` - column group is optional

### Deduplication

Maven sometimes reports the same error twice. Deduplicate using:
```
key = `${file}:${line}:${column}:${firstLineOfMessage}`
```

## Testing Requirements

**CRITICAL:** All changes MUST include tests with real Maven output.

### Test Data Requirements

1. **Real-world samples** - Use actual Maven compiler output (not hand-crafted)
2. **Co-located** - Store in `samples/` directory (travels with extractor when forked)
3. **Redacted** - Remove sensitive paths, usernames, company names

### Adding New Test Cases

```typescript
// Add to samples array in index.ts
{
  name: 'descriptive-name',
  description: 'What this sample demonstrates',
  inputFile: './samples/new-case.txt',  // Relative to extractor directory
  expected: {
    totalErrors: 2,
    errors: [{ file: 'Foo.java', line: 42 }],
  },
}
```

### Running Tests

```bash
# All maven-compiler tests
pnpm test maven-compiler

# Specific test
pnpm test maven-compiler -t "should extract basic errors"

# Watch mode (for development)
pnpm test:watch maven-compiler
```

## Common Modifications

### Adding New Error Pattern

1. **Add pattern** to `COMPILER_PATTERNS.compilerErrorPatterns` array
2. **Update scoring** in `detectMavenCompiler()` (if high-value pattern)
3. **Add sample** demonstrating the pattern to `samples/`
4. **Add test** in `index.test.ts`

### Improving Path Extraction

**DO NOT modify in this file** - modify shared utility:
```
packages/extractors/src/maven-utils.ts
```

This ensures all Maven extractors benefit from the improvement.

### Adjusting Detection Confidence

If false positives/negatives occur:
1. Review `hints` - are they too broad/narrow?
2. Review `detect()` scoring - do patterns need reweighting?
3. Add test case demonstrating the issue
4. Adjust hints or detection logic

## Migration Status

### ✅ Completed
- Created plugin directory structure
- Migrated code to `index.ts` with ExtractorPlugin interface
- Co-located sample data in `samples/`
- Created README.md and CLAUDE.md
- Added hints for fast filtering

### 🚧 TODO
- Migrate tests from `packages/extractors/test/maven-compiler-extractor.test.ts`
- Update extractor-registry.ts to import from new location
- Validate all tests pass with new structure

## Security Considerations

This extractor is **SAFE for sandboxed execution**:
- ✅ **No file I/O** - Only reads `output: string` parameter
- ✅ **No process execution** - No `child_process`, `exec`, `spawn`
- ✅ **No network access** - No `fetch`, `http`, `https`
- ✅ **No dangerous APIs** - No `eval`, `Function()`, `require()`
- ✅ **Deterministic** - Same input always produces same output

Can be safely loaded in:
- `isolated-vm` sandbox
- `worker_threads` with limited scope
- External plugins from untrusted sources

## Related Extractors

- **maven-checkstyle** - Shares `maven-utils.ts` utilities
- **maven-surefire** - Test failures (different format, shares utils)

## Questions or Issues?

- Review `README.md` for user-facing documentation
- Check `../../types.ts` for ExtractorPlugin interface
- See `../../extractor-registry.ts` for how extractors are registered
- Reference other extractors in `../` for patterns
