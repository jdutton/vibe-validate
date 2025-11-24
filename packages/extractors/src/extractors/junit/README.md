# JUnit XML Error Extractor

Extracts and formats test failures from JUnit XML reports for LLM consumption.

## Features

- **High Confidence Detection (90%)** - Recognizes JUnit XML structure with test failures
- **Multi-Framework Support** - Works with Vitest, Jest, and other JUnit XML generators
- **Smart Guidance** - Provides error-type-specific fix suggestions
- **Token Efficient** - Limits output to 10 most critical failures
- **HTML Entity Decoding** - Properly handles encoded XML content

## Detection Patterns

- `<testsuite>` or `<testsuites>` - JUnit XML root elements
- `<failure>` - Test failure indicators (increases confidence to 90%)

## Supported Test Frameworks

Any framework that outputs JUnit XML format, including:
- **Vitest** - `--reporter=junit`
- **Jest** - `jest-junit` reporter
- **Mocha** - `mocha-junit-reporter`
- **Pytest** - `--junitxml` option
- **Gradle** - Built-in JUnit XML reports
- **Maven** - Surefire/Failsafe reports

## Error Type Detection

The extractor provides specialized guidance based on error patterns:

| Error Pattern | Guidance |
|--------------|----------|
| **AssertionError** | Review test assertions - expected values may not match actual results |
| **TypeError** (null/undefined) | Check for null/undefined values before property access |
| **ENOENT** (file not found) | Verify file paths and ensure required files exist |
| **Timeout** errors | Consider increasing test timeout or optimizing slow operations |

## Example Input

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="2" errors="0" time="0.006">
    <testsuite name="test/math.test.ts" tests="3" failures="2" errors="0" skipped="0" time="0.006">
        <testcase classname="test/math.test.ts" name="Math > should multiply" time="0.002">
            <failure message="expected 6 to be 8 // Object.is equality" type="AssertionError">
AssertionError: expected 6 to be 8 // Object.is equality
 ❯ test/math.test.ts:15:20
            </failure>
        </testcase>
        <testcase classname="test/math.test.ts" name="Math > should subtract" time="0.003">
            <failure message="expected -1 to be 0 // Object.is equality" type="AssertionError">
AssertionError: expected -1 to be 0 // Object.is equality
 ❯ test/math.test.ts:25:22
            </failure>
        </testcase>
    </testsuite>
</testsuites>
```

## Example Output

```yaml
errors:
  - file: test/math.test.ts
    line: 15
    message: expected 6 to be 8 // Object.is equality
    context: Math > should multiply
  - file: test/math.test.ts
    line: 25
    message: expected -1 to be 0 // Object.is equality
    context: Math > should subtract
summary: "2 test(s) failed"
totalErrors: 2
guidance: "Review test assertions - expected values may not match actual results"
errorSummary: |
  test/math.test.ts:15 - expected 6 to be 8 // Object.is equality
  test/math.test.ts:25 - expected -1 to be 0 // Object.is equality
```

## Location Extraction

The extractor intelligently parses location information from failure text:

- **Vitest format**: `❯ file:line:column` (preferred)
- **Fallback**: Uses `classname` attribute from `<testcase>` element
- **Line numbers**: Extracted from location pattern when available

## Test Hierarchy

Test names (from `name` attribute) are preserved in the `context` field, maintaining test suite hierarchy:

```
Suite > Nested > Deep > test name
```

HTML entities (`&gt;`, `&quot;`, `&amp;`, etc.) are automatically decoded.

## Priority

**90** - High confidence for XML with failures, slightly lower (85) for XML without failures

## Tags

`junit`, `xml`, `testing`, `vitest`, `jest`

## Usage Example

```bash
# Generate JUnit XML with Vitest
vitest --reporter=junit --outputFile=junit.xml

# Process with vibe-validate
vv run vitest --reporter=junit
```

## Configuration

No special configuration needed. The extractor automatically detects JUnit XML output.

To force JUnit extraction:

```yaml
# vibe-validate.config.yaml
steps:
  - name: test
    command: vitest --reporter=junit --outputFile=junit.xml
    extractor: junit  # Force JUnit extractor
```
