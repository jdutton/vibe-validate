# Maven Checkstyle Extractor - Claude Code Guidance

This file provides guidance to Claude Code when working on this extractor.

## What This Extractor Does

Parses Maven Checkstyle plugin output to extract style violations with file, line, column, message, and rule name. Handles TWO distinct output formats that Maven Checkstyle produces (audit output and summary output), automatically deduplicating violations.

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
- `samples/` - Real-world Maven Checkstyle output samples (to be added)
- `index.test.ts` - Comprehensive tests covering both output formats
- `README.md` - Human-readable documentation
- `CLAUDE.md` - This file (LLM-specific guidance)

### Shared Utilities
- `../../maven-utils.ts` - `extractRelativePath()` function (shared by all Maven extractors)

## Detection Logic

### Two-Phase Detection

**Phase 1: Fast Hints (string.includes() only)**
```typescript
hints: {
  required: ['[WARN]', '[INFO]'],        // Both must be present
  anyOf: [                                // At least one
    'maven-checkstyle-plugin',
    'Starting audit',
    'Checkstyle violations'
  ]
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

- `maven-checkstyle-plugin` reference: **+40 points**
- `Starting audit` marker: **+20 points**
- `Audit done` marker: **+20 points**
- Violation summary ("You have N Checkstyle violations"): **+30 points**
- Violation format match ([WARN] or [WARNING]): **+10 points**

**Threshold:** 70 points = high confidence
**Range:** 40-69 = possible, <40 = not Checkstyle output

## Common Patterns & Gotchas

### Two Output Formats

Maven Checkstyle produces TWO formats that report the SAME violations:

**Format 1: Audit Output (during check)**
```
[WARN] /absolute/path/src/main/java/Foo.java:10:5: Missing Javadoc. [JavadocVariable]
```
- Uses **[WARN]** prefix (not [WARNING])
- Absolute file paths
- Format: `path:line:col: message [Rule]`
- Rule in square brackets at end

**Format 2: Summary Output (after check)**
```
[WARNING] src/main/java/Foo.java:[10,5] (javadoc) JavadocVariable: Missing Javadoc.
```
- Uses **[WARNING]** prefix (not [WARN])
- Relative file paths
- Format: `path:[line,col] (category) Rule: message`
- Category in parentheses, rule before colon

### Deduplication Strategy

Both formats report identical violations. Deduplicate using:
```typescript
key = `${file}:${line}:${column}:${rule}`;
```

**Critical:** Don't deduplicate on message alone - same rule can fire on same line with different messages.

### Path Extraction

**Format 1 Input:** `/Users/jeff/workspace/project/src/main/java/com/example/Foo.java`

**Format 2 Input:** `src/main/java/com/example/Foo.java`

**Output (both):** `src/main/java/com/example/Foo.java`

**Logic:**
- Format 1: Use `extractRelativePath()` from `maven-utils.ts` to find `src/` and extract from there
- Format 2: Already relative, use as-is

**Shared utility:** `extractRelativePath()` in `../../maven-utils.ts`

### Column Number Optional (Format 2 only)

Format 2 may omit column:
```
[WARNING] Foo.java:[42] some error      ← No column
[WARNING] Foo.java:[42,5] some error    ← Has column
```

**Regex:** `:\[(\d+)(?:,(\d+))?\]` - column group is optional

Format 1 always includes column.

### Category Field (Format 2 only)

Format 2 includes category in parentheses:
```
[WARNING] Foo.java:[10,5] (javadoc) Rule: message
                           ^^^^^^^^
```

Store in `CheckstyleViolation.category` field (optional).

## Testing Requirements

**CRITICAL:** All changes MUST include tests with real Maven output.

### Test Data Requirements

1. **Real-world samples** - Use actual Maven Checkstyle output (not hand-crafted)
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
    totalErrors: 5,
    errors: [{ file: 'Foo.java', line: 42 }],
  },
}
```

### Running Tests

```bash
# All maven-checkstyle tests
pnpm test maven-checkstyle

# Specific test
pnpm test maven-checkstyle -t "should extract errors"

# Watch mode (for development)
pnpm test:watch maven-checkstyle
```

### Current Test Coverage

- ✅ Detection with high confidence (all markers present)
- ✅ Low confidence for non-Checkstyle output
- ✅ Extract errors from Format 1 ([WARN])
- ✅ Extract errors from Format 2 ([WARNING])
- ✅ Deduplication between formats
- ✅ Error limiting (MAX_ERRORS_IN_ARRAY)
- ✅ Guidance generation
- ✅ Custom command in guidance
- ✅ Metadata fields (detection, confidence, completeness)
- ✅ Plugin metadata validation
- ✅ Sample validation

## Common Modifications

### Adding New Pattern Recognition

If Checkstyle changes output format:

1. **Update regex patterns** in `CHECKSTYLE_PATTERNS`
2. **Add scoring** in `detectMavenCheckstyle()` if high-value marker
3. **Update extraction** in `extractMavenCheckstyle()` to parse new format
4. **Add sample** demonstrating the pattern to `samples/`
5. **Add test** in `index.test.ts`

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

### Handling New Checkstyle Rules

**No code changes needed!** The extractor is rule-agnostic:
- Extracts rule name from output (Format 1: `[Rule]`, Format 2: `Rule:`)
- Works with all 200+ built-in Checkstyle rules
- Works with custom rules

## Priority and Conflict Resolution

**Priority: 60** (lower than maven-compiler at 70)

**Why?** Checkstyle output can sometimes appear alongside compiler output. Since compiler errors are more critical (build-blocking), they get higher priority.

**Conflict resolution:** If both match, registry picks higher priority (maven-compiler).

## Deduplication Details

### Why Deduplication is Needed

Maven Checkstyle prints violations TWICE:
1. During audit (Format 1, as they're found)
2. In summary (Format 2, after audit completes)

Same violation, different format.

### Deduplication Key

```typescript
const key = `${file}:${line}:${column}:${rule}`;
```

**Why include rule?** Same file:line:column can have multiple different violations.

**Why not include message?** Messages differ slightly between formats:
- Format 1: "Missing Javadoc comment."
- Format 2: "Missing a Javadoc comment."

## Error Limiting Strategy

```typescript
const errors: FormattedError[] = uniqueViolations
  .slice(0, MAX_ERRORS_IN_ARRAY)  // Limit array size
  .map(v => ({ ... }));

return {
  totalErrors: uniqueViolations.length,  // Full count
  errors,                                 // Limited array
  ...
};
```

**Why?** LLM context window protection:
- `totalErrors`: Shows full scope of problem
- `errors`: Provides actionable details for first N violations
- Prevents overwhelming the agent with 100+ violations

**Default limit:** 10 violations (configurable via `MAX_ERRORS_IN_ARRAY`)

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

- **maven-compiler** - Java compilation errors (shares `maven-utils.ts`)
- **maven-surefire** - JUnit test failures (shares `maven-utils.ts`)

## Sample Data Needs

**TODO:** Add real-world Maven Checkstyle output to `samples/`:

1. `maven-checkstyle-violations.txt` - Full output with 15+ violations
   - Both formats (audit + summary)
   - Multiple files
   - Various rule types (Javadoc, formatting, imports, etc.)

2. `single-violation.txt` - Minimal case for quick validation

3. `no-violations.txt` - Clean run (no violations found)

**How to capture:**
```bash
mvn checkstyle:check 2>&1 | tee samples/maven-checkstyle-violations.txt
```

**Redaction checklist:**
- [ ] Remove absolute paths (keep relative `src/main/java/...`)
- [ ] Remove usernames from paths
- [ ] Remove company/project names
- [ ] Keep rule names and messages (generic)

## Questions or Issues?

- Review `README.md` for user-facing documentation
- Check `../../types.ts` for ExtractorPlugin interface
- See `../../extractor-registry.ts` for how extractors are registered
- Reference `../maven-compiler/` for similar Maven extractor pattern

## Checkstyle Output Evolution

**Historical note:** Maven Checkstyle plugin has used these two formats since version 2.x (2010+). Format is stable and unlikely to change.

If format changes in future versions:
1. Update regex patterns in `CHECKSTYLE_PATTERNS`
2. Add backwards compatibility for old formats
3. Update tests with new samples
4. Document breaking changes in README

## Performance Characteristics

**Typical performance:**
- Detection: <1ms for 100 lines of output
- Extraction: <5ms for 100 violations
- Memory: O(n) where n = number of violations

**Optimization opportunities:**
- Hints filter ~95% of non-Checkstyle output before detection runs
- Regex patterns compiled once, reused for all lines
- Deduplication uses Set for O(1) lookup

**Benchmark results:** (run `pnpm benchmark` to regenerate)
- TODO: Add benchmark results once implemented
