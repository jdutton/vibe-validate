# Maven Surefire/Failsafe Extractor - Claude Code Guidance

This file provides guidance to Claude Code when working on this extractor.

## What This Extractor Does

Parses Maven Surefire and Failsafe plugin output to extract test failures with test class, test method, exception type, error message, and stack traces. Supports JUnit 4, JUnit 5, AssertJ, and TestNG test frameworks.

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
- `samples/` - Real-world Maven test output samples (NOT YET CREATED)
- `index.test.ts` - Tests using inline samples and external files
- `README.md` - Human-readable documentation
- `CLAUDE.md` - This file (LLM-specific guidance)

### No Shared Utilities

Unlike maven-compiler, this extractor does NOT use `maven-utils.ts` because:
- Test failures don't typically include absolute paths
- File names are extracted from stack traces (already relative: `FooTest.java`)
- If absolute paths are encountered, they're kept as-is (rare edge case)

## Detection Logic

### Two-Phase Detection

**Phase 1: Fast Hints (string.includes() only)**
```typescript
hints: {
  required: ['[ERROR]', 'Tests run:'],        // Both must be present
  anyOf: ['FAILURE!', 'ERROR!', 'maven-surefire-plugin', 'maven-failsafe-plugin'],
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

- Maven test plugin reference (surefire/failsafe): **+40 points**
- Test summary (`Tests run: N, Failures: N, Errors: N`): **+40 points**
- Test failure markers (`<<< FAILURE!`, `<<< ERROR!`): **+20 points**
- Test failure section headers: **+15 points**
- JUnit assertion errors: **+10 points**

**Threshold:** 70 points = high confidence
**Range:** 40-69 = possible, <40 = not Maven test output

## Common Patterns & Gotchas

### Multi-line Test Failures

Maven test failures are reported in this format:
```
[ERROR] com.example.FooTest.testBar -- Time elapsed: 0.123 s <<< FAILURE!
java.lang.AssertionError: Expected 5 but was 3
  at com.example.FooTest.testBar(FooTest.java:42)
  at java.base/java.lang.reflect.Method.invoke(Method.java:565)
```

**Parsing logic:**
1. Match error header: `[ERROR] Class.method -- ... <<< FAILURE!`
2. Next line is exception type and message: `java.lang.AssertionError: ...`
3. Following lines are stack trace: `at package.Class.method(File.java:line)`
4. Extract file/line from first stack frame that ends with `.java`
5. Stop collecting stack trace after 3 lines (limit depth)

### State Machine for Parsing

The extractor uses a state machine:
- `currentFailure`: Tracks the test being parsed
- `inStackTrace`: Boolean flag for stack trace parsing mode

**State transitions:**
1. **Header match** → Save previous failure, start new failure
2. **Exception match** → Set exception type/message, enter stack trace mode
3. **Stack trace match** → Collect frames (max 3), extract file/line from first
4. **Empty line** → Exit stack trace mode
5. **Next header** → Save current failure, start new failure

### Short Format Support

Some Maven output uses abbreviated format:
```
[ERROR] com.example.Test.testFoo:42 Expected foo but was bar
```

**Parsing:** Separate regex pattern for this format, creates failure immediately (no state machine)

### File Path Extraction

**From stack traces:**
```
at com.example.FooTest.testBar(FooTest.java:42)
→ file: FooTest.java, line: 42
```

**Fallback (no stack trace):**
```
testClass: com.example.FooTest
→ file: com/example/FooTest.java (convert dots to slashes)
```

### Exception Type Detection

Common exception types:
- `AssertionError` - Generic JUnit assertion
- `AssertionFailedError` - JUnit 5 assertion
- `NullPointerException` - Null reference
- `IllegalArgumentException` - Invalid argument
- Custom exceptions from application code

**Regex:** `^([\w.]+(?:Error|Exception|AssertionError|AssertionFailedError)):\s*(.*)$`

This matches both simple and fully-qualified exception types.

## Testing Requirements

**CRITICAL:** All changes MUST include tests with real Maven output.

### Test Data Requirements

1. **Real-world samples** - Use actual Maven test output (not hand-crafted)
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
    errors: [{ file: 'Test.java', line: 42 }],
  },
}
```

### Running Tests

```bash
# All maven-surefire tests
pnpm test maven-surefire

# Specific test
pnpm test maven-surefire -t "should extract NullPointerException"

# Watch mode (for development)
pnpm test:watch maven-surefire
```

## Common Modifications

### Adding New Test Framework

1. **Add detection patterns** to scoring logic
2. **Update regex patterns** if format differs
3. **Add sample** demonstrating the framework to `samples/`
4. **Add test** in `index.test.ts`
5. **Update tags** in metadata (e.g., add 'testng')

### Improving Stack Trace Parsing

**Current behavior:** Collects max 3 stack frames, extracts file/line from first `.java` file

**To change:**
1. Modify `SUREFIRE_PATTERNS.stackTraceLine` regex if format differs
2. Adjust stack depth limit (currently 3) in extraction logic
3. Update file extraction logic if needed (e.g., support Kotlin `.kt` files)

### Adjusting Detection Confidence

If false positives/negatives occur:
1. Review `hints` - are they too broad/narrow?
2. Review `detect()` scoring - do patterns need reweighting?
3. Add test case demonstrating the issue
4. Adjust hints or detection logic

## Edge Cases & Limitations

### Multi-line Assertion Messages

AssertJ produces multi-line messages:
```
java.lang.AssertionError:

Expecting actual:
  "Hello World"
to contain:
  "Goodbye"
```

**Current behavior:** Only captures first line of message (the exception type line)

**Improvement opportunity:** Collect all lines between exception and stack trace

### Parameterized Tests

JUnit 5 parameterized tests show multiple failures for same test method:
```
[ERROR] testFoo[1] -- <<< FAILURE!
[ERROR] testFoo[2] -- <<< FAILURE!
```

**Current behavior:** Treats as separate failures (correct)

**No change needed:** Each parameterized execution is a distinct failure

### Nested Test Classes

JUnit 5 nested test classes:
```
[ERROR] OuterTest$InnerTest.testFoo -- <<< FAILURE!
```

**Current behavior:** Treats `OuterTest$InnerTest` as test class name (correct)

**No change needed:** Dollar sign is valid in Java class names

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

- **maven-compiler** - Java compilation errors (shares similar Maven log format)
- **maven-checkstyle** - Checkstyle violations (shares similar Maven log format)

## Questions or Issues?

- Review `README.md` for user-facing documentation
- Check `../../types.ts` for ExtractorPlugin interface
- See `../../extractor-registry.ts` for how extractors are registered
- Reference other extractors in `../` for patterns
