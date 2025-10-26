# Output Format Documentation

This document explains the various output formats that each extractor handles. Understanding these formats is crucial for maintaining and improving extraction quality.

## Vitest/Jest Extractor

The Vitest extractor (`vitest-extractor.ts`) handles test failure output from Vitest and Jest.

### Supported Output Formats

Vitest outputs test failures in **two different formats** depending on context:

#### Format 1: File Path in Failure Line (Legacy/Verbose)

Used by: Vitest verbose output, single file runs, older Vitest versions

```
FAIL  test/unit/config/environment.test.ts > EnvironmentConfig > should parse HTTP_PORT
AssertionError: expected 3000 to be 9999 // Object.is equality
❯ test/unit/config/environment.test.ts:57:30
  55|     const config = parseEnvironmentConfig();
  56|
  57|     expect(config.HTTP_PORT).toBe(9999);
    |                              ^
  58|   });
```

**Characteristics:**
- Failure marker: `FAIL`, `❌`, or `×`
- File path appears immediately after marker: `× file.test.ts > test hierarchy`
- Error message on separate line (may have `AssertionError:` prefix or `→` prefix)
- Location marker `❯` on separate line: `❯ file.test.ts:line:column`
- Source lines with line numbers: `57| code here`

**Regex patterns:**
```typescript
// Failure line with file path
/(?:FAIL|❌|×)\s+([^\s]+\.test\.ts)\s*>\s*(.+)/

// Location line
/❯\s*(.+\.test\.ts):(\d+):(\d+)/
```

#### Format 2: File Path in Header Line (Current Default)

Used by: `vitest run` (current), multi-file test runs

```
❯ tests/vitest/calculator.test.ts (9 tests | 7 failed) 22ms
  × Calculator (Vitest) > Addition > should add two small numbers correctly 3ms
    → expected 14 to be 13 // Object.is equality
  × Calculator (Vitest) > Division > should throw error when dividing by zero 1ms
    → expected [Function] to throw an error
  ✓ Calculator (Vitest) > Addition > should handle negative numbers 0ms
```

**Characteristics:**
- File header line: `❯ file.test.ts (N tests | M failed) duration`
- Failure markers (`×`) do NOT include file path, only test hierarchy
- Error messages prefixed with `→`
- All failures under a header belong to that file

**Regex patterns:**
```typescript
// File header (must have parentheses to distinguish from location lines)
/❯\s+([^\s]+\.test\.ts)\s+\(/

// Failure line WITHOUT file path
/(?:×)\s+(.+?)(?:\s+\d+ms)?$/

// Error message with → prefix
/→\s+(.+)/
```

### Extractor Implementation

The extractor handles both formats by:

1. **Tracking current file**: When a Format 2 header is detected (`❯ file.test.ts (...)`), store the file path
2. **Dual format matching**:
   - Try Format 1 first (file path in failure line)
   - If no match and `currentFile` exists, try Format 2 (use tracked file)
3. **Error message handling**: Support both `AssertionError:` prefix and `→` prefix

**Code structure:**
```typescript
let currentFile = '';  // Track file from Format 2 headers

// Detect Format 2 file header
const fileHeaderMatch = line.match(/❯\s+([^\s]+\.test\.ts)\s+\(/);
if (fileHeaderMatch) {
  currentFile = fileHeaderMatch[1];
  continue;
}

// Try Format 1 (file in failure line)
const format1Match = line.match(/(?:FAIL|❌|×)\s+([^\s]+\.test\.ts)\s*>\s*(.+)/);

// Try Format 2 (use tracked file)
const format2Match = !format1Match && line.match(/(?:×)\s+(.+?)(?:\s+\d+ms)?$/);

if (format1Match || (format2Match && currentFile)) {
  // Extract failure using appropriate format
}
```

### Known Edge Cases

1. **Snapshot failures**: Use `Snapshot \`name\` mismatched` pattern (no "Error:" prefix)
2. **Runtime errors**: Handled separately via "Unhandled Rejection" section
3. **Multi-line errors**: Captured up to 5 continuation lines (prevents verbose spy output from bloating)
4. **Location lines vs file headers**: Both use `❯`, distinguished by presence of parentheses:
   - Header: `❯ file.test.ts (9 tests | 7 failed)`
   - Location: `❯ file.test.ts:57:30`

### Testing

Existing samples in `test/samples/vitest/`:
- **Format 1**: `assertion-error-001.yaml`, `coverage-mode-001.yaml`, etc.
- **Format 2**: `verbose-spy-output-001.yaml` (has file path but uses `×` + `→` markers)

Test-bed in `packages/extractors-test-bed/`:
- Generates real Vitest output in Format 2 (current default)
- 20 intentional failures across 10 failure categories

## TypeScript Extractor

(Documentation TODO)

## ESLint Extractor

(Documentation TODO)

## OpenAPI Extractor

(Documentation TODO)

## Generic Extractor

(Documentation TODO)

---

## Contributing

When adding support for new output formats:

1. **Document the format** in this file with examples
2. **Add regex patterns** showing what to match
3. **Create sample files** in `test/samples/<tool>/` following the sample schema
4. **Test with real output** using the extractors-test-bed if applicable
5. **Update tests** to cover the new format

### Sample Format

All samples must follow `test/samples/sample-schema.json`:

```yaml
$schema: ../sample-schema.json

metadata:
  tool: vitest
  toolVersion: "3.2.4"
  category: assertion-failure
  difficulty: easy

input:
  raw: |
    # Actual tool output here

expected:
  detectionConfidence: 95
  failures:
    - tool: vitest
      type: test-failure
      summary: "Test name"
      message: "Error message"
      # ...

quality:
  score: null  # Auto-populated by tests

improvementHints:
  - "Parsing tips for this format"
```

This ensures consistent testing and quality tracking across all extractors.
